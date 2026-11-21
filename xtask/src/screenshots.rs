//! The manual's screenshots and animations (RULES.md D60), made by this
//! program, never by hand: a demo database made of
//! `xtask/screenshots/demo.sql`, of made-up data and a demo user alone;
//! the built application driven under tauri-driver, the smoke test's
//! harness, in each theme at one window size; and each scene written to
//! `doc/images/`: PNG screenshots of the window, compressed losslessly,
//! short GIF animations, and the ER diagram as Studio's own SVG export.
//! A scene that fails is told and the rest go on; the run fails if any
//! did. It runs where tauri-driver runs: Linux, under a display server.

use std::path::{Path, PathBuf};
use std::time::Duration;

use turborel::db::{Database, OpenOptions};

use crate::command::{root, say};
use crate::error::{Error, Result, fail};
use crate::images::{Pixels, crop, decode, write_gif, write_png};
use crate::webdriver::{BACKSPACE, CONTROL, DOWN, Driver, ESCAPE, Session, TAB, config};

/// The window's size in every image, in pixels.
const WINDOW: (u32, u32) = (1280, 800);
/// The demo database's owner, the user every image shows.
const DEMO_USER: &str = "DEMO";
/// The saved connection of the demo database, as the explorer names it.
const DEMO_NAME: &str = "Demo shop";
/// The ports of each theme's tauri-driver and its WebDriver.
const THEMES: [(&str, (u16, u16)); 2] = [("light", (4464, 4465)), ("dark", (4474, 4475))];
/// The query the window, its plan and its completion show.
const QUERY: &str = "SELECT C.NAME, COUNT(*) AS ORDERS, SUM(O.TOTAL) AS TOTAL FROM CUSTOMERS C JOIN ORDERS O ON O.CUSTOMER_ID = C.ID GROUP BY C.NAME ORDER BY TOTAL DESC";
/// How long a scene's drawing is let settle before it is taken.
const SETTLE: Duration = Duration::from_millis(700);

/// The page's helpers, defined once a scene needs them: a row of the
/// catalog by its label, and a context menu opened on an element.
const HELPERS: &str = r"
window.studioRow = (label) => [...document.querySelectorAll('[role=tree][aria-label=Catalog] [role=treeitem]')]
  .find((e) => [...e.querySelectorAll('span')].some((s) => s.textContent === label));
window.studioMenu = (element) => {
  const r = element.getBoundingClientRect();
  element.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + r.height / 2}));
};
";

/// The page's script that takes its call to save a text file, keeping the
/// text in `window.studioSaved`: what it replaced to take it.
const TAKE_SAVE: &str = r"
const internals = window.__TAURI_INTERNALS__;
const call = internals.invoke.bind(internals);
window.studioSaved = null;
const taken = (cmd, args, options) => (cmd === 'save_text_file' ? ((window.studioSaved = args.text), Promise.resolve(null)) : call(cmd, args, options));
try { internals.invoke = taken; } catch (e) {}
if (internals.invoke === taken) { return 'the call'; }
try { Object.defineProperty(internals, 'invoke', { value: taken, writable: true, configurable: true }); } catch (e) {}
if (internals.invoke === taken) { return 'the call, defined'; }
const held = new Proxy(internals, { get: (target, name) => (name === 'invoke' ? taken : target[name]) });
try { window.__TAURI_INTERNALS__ = held; } catch (e) {}
try { Object.defineProperty(window, '__TAURI_INTERNALS__', { value: held, configurable: true }); } catch (e) {}
return window.__TAURI_INTERNALS__ === held ? 'the object' : 'nothing';
";

/// Makes the demo database in `dir`, of the seed's statements, owned by `DEMO_USER`.
fn demo_database(dir: &Path) -> Result<()> {
    let failed = |e: turborel::error::SqlError| Error(format!("the demo database: {e}"));
    let seed = std::fs::read_to_string(root().join("xtask").join("screenshots").join("demo.sql"))
        .map_err(|e| Error(format!("xtask/screenshots/demo.sql: {e}")))?;
    let db = Database::new();
    let fs = db.file_system().map_err(failed)?;
    db.open_files(&fs, dir, &OpenOptions::default()).map_err(failed)?;
    db.create_user(DEMO_USER, b"").map_err(failed)?;
    let session = db.session(DEMO_USER);
    let mut statement = String::new();
    for line in seed.lines().filter(|l| !l.trim_start().starts_with("--")) {
        statement.push_str(line);
        statement.push('\n');
        if line.trim_end().ends_with(';') {
            let sql = statement.trim().trim_end_matches(';');
            // A <schema> is the database's to make, a statement of a schema the session's.
            let ran = if sql.starts_with("CREATE SCHEMA") { db.schema(sql).map(drop) } else { session.run(sql).map(drop) };
            ran.map_err(|e| Error(format!("the demo database, at {sql}: {e}")))?;
            session.commit().map_err(failed)?;
            statement.clear();
        }
    }
    db.close().map_err(failed)
}

/// Writes the app data of `home`: the settings of `theme`, and the demo
/// database saved as a connection, its folder `demo`.
fn app_data(home: &Path, theme: &str, demo: &Path) -> Result<()> {
    let dir = config(home);
    std::fs::create_dir_all(&dir).map_err(|e| Error(format!("{}: {e}", dir.display())))?;
    let settings = serde_json::json!({"format": 1, "theme": theme});
    // Live Sessions on, under the demo's own name, as a presenter's are.
    let live = serde_json::json!({"format": 1, "enabled": true, "name": "Demo presenter"});
    let connections = serde_json::json!({
        "format": 1,
        "connections": [{
            "id": "0d3e40c5a1b2c3d4e5f60718293a4b5c",
            "name": DEMO_NAME,
            "folder": [],
            "spec": {},
            "environment": "development",
            "colour": null,
            "readOnly": false,
            "pinned": false,
            "favourites": [],
            "embedded": {"directory": demo.display().to_string(), "keys": null, "checksumKey": null, "pluginDirectories": null, "user": null}
        }],
        "recent": []
    });
    for (name, json) in [("settings.json", settings), ("connections.json", connections), ("live-sessions.json", live)] {
        std::fs::write(dir.join(name), json.to_string()).map_err(|e| Error(format!("{name}: {e}")))?;
    }
    Ok(())
}

/// What a scene makes: its images, written to `out`.
struct Scene<'s> {
    session: &'s Session<'s>,
    theme: &'s str,
    out: &'s Path,
}

impl Scene<'_> {
    /// The window as it is now.
    fn shot(&self) -> Result<Pixels> {
        std::thread::sleep(SETTLE);
        decode(&self.session.screenshot()?)
    }

    /// Writes the window as it is now as `name`, of this theme.
    fn save(&self, name: &str) -> Result<()> {
        write_png(&self.shot()?, &self.out.join(format!("{name}-{}.png", self.theme)))
    }

    /// The rectangle, in the screenshot's pixels, of the element `selector` finds.
    fn rect(&self, selector: &str) -> Result<(u32, u32, u32, u32)> {
        let script = format!(
            "const r = document.querySelector('{selector}').getBoundingClientRect(); const d = window.devicePixelRatio; return [r.left * d, r.top * d, r.width * d, r.height * d].map(Math.round);"
        );
        let got = self.session.script(&script)?;
        let n = |i: usize| got.get(i).and_then(serde_json::Value::as_u64).and_then(|v| u32::try_from(v).ok()).unwrap_or(0);
        Ok((n(0), n(1), n(2), n(3)))
    }

    /// The worksheet, its editor focused and emptied: the scenes' one
    /// worksheet, opened by the first.
    fn worksheet(&self) -> Result<()> {
        if !self.session.found(".worksheet-body .cm-content")? {
            self.session.click("[role=\"toolbar\"][aria-label=\"Toolbar\"] button[aria-label=\"New Worksheet\"]")?;
            self.session.wait_for(".worksheet-body .cm-content")?;
        }
        self.focus_editor()?;
        self.session.press(&[CONTROL], &["a"])?;
        self.session.press(&[], &[BACKSPACE])
    }

    /// Clicks the worksheet's toolbar button `name`: the completion list,
    /// if one is open, closed first.
    fn tool(&self, name: &str) -> Result<()> {
        self.session.press(&[], &[ESCAPE])?;
        self.session.click(&format!("[role=\"toolbar\"][aria-label=\"Worksheet\"] button[aria-label=\"{name}\"]"))
    }

    /// Clicks, as a person does, the element `selector` finds whose text
    /// holds `text`, once the window draws it: marked for the driver to find.
    fn click_text(&self, selector: &str, text: &str) -> Result<()> {
        let script = format!(
            "document.getElementById('studio-target')?.removeAttribute('id'); const e = [...document.querySelectorAll('{selector}')].find((e) => e.textContent.includes('{text}')); if (e) {{ e.id = 'studio-target'; }} return e !== undefined;"
        );
        let start = std::time::Instant::now();
        while !self.session.script(&script)?.as_bool().unwrap_or(false) {
            if start.elapsed() > crate::webdriver::DRAWN_WITHIN {
                return fail(format!("the window drew no {selector} of {text}"));
            }
            std::thread::sleep(SETTLE);
        }
        self.session.click("#studio-target")
    }

    /// A new worksheet, its editor focused, apart from the one the other scenes share.
    fn new_worksheet(&self) -> Result<()> {
        let before = self.session.script("return document.querySelectorAll('.worksheet-body .cm-content').length")?;
        self.session.click("[role=\"toolbar\"][aria-label=\"Toolbar\"] button[aria-label=\"New Worksheet\"]")?;
        std::thread::sleep(SETTLE);
        let after = self.session.script("return document.querySelectorAll('.worksheet-body .cm-content').length")?;
        if after == before {
            self.session.wait_for(".worksheet-body .cm-content")?;
        }
        self.focus_editor()
    }

    /// Focuses the editor of the worksheet shown, marked for the driver
    /// to type into: of several worksheets, the one drawn.
    fn focus_editor(&self) -> Result<()> {
        self.session.script(
            "document.getElementById('studio-editor')?.removeAttribute('id'); const e = [...document.querySelectorAll('.worksheet-body .cm-content')].find((e) => e.offsetParent !== null); if (!e) throw new Error('no worksheet is shown'); e.id = 'studio-editor';",
        )?;
        self.session.click("#studio-editor")
    }

    /// Types `text` into the worksheet's editor.
    fn write(&self, text: &str) -> Result<()> {
        self.session.type_into("#studio-editor", text)
    }
}

/// The window: the demo shop open, its catalog shown, a query and its rows.
fn window_scene(scene: &Scene<'_>) -> Result<()> {
    scene.worksheet()?;
    scene.write(QUERY)?;
    scene.tool("Run Statement")?;
    scene.session.wait_for("[role=\"grid\"], .result-grid, canvas")?;
    scene.save("window")
}

/// Completion: a table's name begun, the list offered, the arrows moving
/// through it and Tab taking one; an animation of the editor alone.
fn completion_scene(scene: &Scene<'_>) -> Result<()> {
    scene.worksheet()?;
    let area = scene.rect(".worksheet-body")?;
    let area = (area.0, area.1, area.2, area.3.min(260));
    let mut frames = Vec::new();
    let mut frame = |hundredths: u16| -> Result<()> {
        frames.push((crop(&scene.shot()?, area), hundredths));
        Ok(())
    };
    for word in ["SELECT ", "NAME ", "FROM ", "C", "U"] {
        scene.write(word)?;
        frame(40)?;
    }
    scene.session.wait_for(".cm-tooltip-autocomplete")?;
    frame(120)?;
    scene.session.press(&[], &[DOWN])?;
    frame(80)?;
    scene.session.press(&[], &[DOWN])?;
    frame(80)?;
    scene.session.press(&[], &[TAB])?;
    frame(250)?;
    write_gif(&frames, &scene.out.join(format!("completion-{}.gif", scene.theme)))
}

/// The plan viewer: the query explained and analyzed.
fn plan_scene(scene: &Scene<'_>) -> Result<()> {
    scene.worksheet()?;
    scene.write(QUERY)?;
    scene.tool("Explain Analyze")?;
    scene.session.wait_for("[aria-label=\"Summary of the plan\"]")?;
    scene.save("plan-viewer")
}

/// A context menu: a table's, in the explorer.
fn menu_scene(scene: &Scene<'_>) -> Result<()> {
    scene.session.script(HELPERS)?;
    scene.session.script("window.studioRow('DEMO')?.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))")?;
    std::thread::sleep(SETTLE);
    scene.session.script("window.studioRow('Tables')?.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))")?;
    std::thread::sleep(SETTLE);
    scene.session.script("const r = window.studioRow('ORDERS'); if (!r) throw new Error('no ORDERS row'); window.studioMenu(r);")?;
    scene.session.wait_for("[role=\"menu\"] [role=\"menuitem\"]")?;
    scene.save("context-menu")?;
    scene.session.press(&[], &[ESCAPE])
}

/// The guard rails: a DROP asked about before it runs.
fn guard_scene(scene: &Scene<'_>) -> Result<()> {
    scene.new_worksheet()?;
    scene.write("DROP TABLE ORDER_LINES CASCADE")?;
    scene.tool("Run Statement")?;
    scene.session.wait_for("[role=\"dialog\"]")?;
    scene.save("guard-drop")?;
    scene.session.press(&[], &[ESCAPE])
}

/// The ER diagram: the schema's model, and, of the light theme, its SVG,
/// as Studio's own Export as SVG writes it, taken from the page's call.
fn diagram_scene(scene: &Scene<'_>) -> Result<()> {
    scene.session.script(HELPERS)?;
    scene.session.script("window.studioRow('DEMO')?.click()")?;
    scene.session.wait_for("[aria-label=\"Schema actions\"]")?;
    scene.click_text("[aria-label=\"Schema actions\"] button", "Open Model")?;
    // The model opens in a tab of its own, which is shown.
    scene.click_text(".dock-tab", "DEMO")?;
    scene.session.wait_for(".react-flow__node")?;
    scene.save("er-diagram")?;
    if scene.theme != "light" {
        return Ok(());
    }
    // The page's call of the backend taken, as it is made: by the call
    // itself, or by the object that holds it, whichever the page lets be
    // replaced; the save dialog never opened.
    let how = scene.session.script(TAKE_SAVE)?;
    scene.session.click("button[aria-label=\"Export as SVG…\"]")?;
    let mut svg = serde_json::Value::Null;
    for _ in 0..10 {
        std::thread::sleep(SETTLE);
        svg = scene.session.script("return window.studioSaved")?;
        if svg.is_string() {
            break;
        }
    }
    let Some(svg) = svg.as_str() else { return fail(format!("the diagram was not exported, its call taken by {how}")) };
    std::fs::write(scene.out.join("er-diagram.svg"), svg).map_err(|e| Error(format!("er-diagram.svg: {e}")))
}

/// Live Sessions: a session presented, its panel shown.
fn live_scene(scene: &Scene<'_>) -> Result<()> {
    scene.session.click("[role=\"toolbar\"][aria-label=\"Toolbar\"] button[aria-label=\"Present\"]")?;
    scene.session.wait_for("[role=\"region\"][aria-label=\"Live Session\"] [aria-label=\"Participants\"]")?;
    scene.save("live-session")
}

/// A scene, by its name.
type Act = fn(&Scene<'_>) -> Result<()>;

/// Every scene, in the order they are taken.
const SCENES: [(&str, Act); 7] = [
    ("window", window_scene),
    ("completion", completion_scene),
    ("plan viewer", plan_scene),
    ("context menu", menu_scene),
    ("guard rails", guard_scene),
    ("ER diagram", diagram_scene),
    ("Live Sessions", live_scene),
];

/// Takes every scene of `theme`, of the application at `application`, of
/// a demo database of its own, so none is opened after another left it:
/// the names of those that failed, and why.
fn theme_scenes(application: &Path, (theme, ports): (&str, (u16, u16)), (homes, out): (&Path, &Path)) -> Result<Vec<String>> {
    let home = homes.join(theme);
    let demo = homes.join(format!("demo-database-{theme}"));
    std::fs::create_dir_all(&demo).map_err(|e| Error(format!("{}: {e}", demo.display())))?;
    say(&format!("==> screenshots: the demo database, {theme}"));
    demo_database(&demo)?;
    app_data(&home, theme, &demo)?;
    let driver = Driver::start(&home, ports)?;
    let session = driver.session(application)?;
    session.size(WINDOW)?;
    session.wait_for("[role=\"toolbar\"]")?;
    session.click(&format!("button[aria-label=\"Connect to {DEMO_NAME}\"]"))?;
    session.wait_for("[role=\"tree\"][aria-label=\"Catalog\"] [role=\"treeitem\"]")?;
    let scene = Scene { session: &session, theme, out };
    let mut failed = Vec::new();
    for (name, act) in SCENES {
        say(&format!("==> screenshots: {name}, {theme}"));
        if let Err(e) = act(&scene) {
            let _ = scene.session.press(&[], &[ESCAPE]); // Whatever it left open is closed.
            if let Ok(shown) = scene.shot() {
                let _ = write_png(&shown, &homes.join(format!("failed-{}-{theme}.png", name.replace(' ', "-")))); // A failure's picture helps alone.
            }
            failed.push(format!("{name}, {theme}: {e}"));
        }
    }
    Ok(failed)
}

/// Makes every image of the manual of the application at `application`.
pub fn screenshots(application: Option<&str>) -> Result<()> {
    let Some(application) = application else { return fail("usage: cargo xtask screenshots <the built application>") };
    let application = std::fs::canonicalize(application).map_err(|e| Error(format!("{application}: {e}")))?;
    let homes: PathBuf = root().join("target").join("screenshots");
    let _ = std::fs::remove_dir_all(&homes); // One of a run before is replaced.
    let out = root().join("doc").join("images");
    std::fs::create_dir_all(&out).map_err(|e| Error(format!("{}: {e}", out.display())))?;
    let mut failed = Vec::new();
    for theme in THEMES {
        failed.extend(theme_scenes(&application, theme, (&homes, &out))?);
    }
    if failed.is_empty() {
        say(&format!("screenshots: every scene written to {}", out.display()));
        Ok(())
    } else {
        fail(format!("scenes failed: {}", failed.join("; ")))
    }
}
