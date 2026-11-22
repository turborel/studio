//! The manual's screenshots and animations (RULES.md D60), made by this
//! program, never by hand: a demo database made of
//! `xtask/screenshots/demo.sql`, of made-up data and demo users alone,
//! and, where `TURBOREL_TEST_SERVER` names a server, a demo server of the
//! same statements; a model of the scenes' own for the assistant, and a
//! viewer of their own for Live Sessions; the built application driven
//! under tauri-driver, the smoke test's harness, in each theme at one
//! window size; and each scene written to `doc/images/`: PNG screenshots
//! of the window or a part of it, compressed losslessly, short GIF
//! animations of a part, and the ER diagram as Studio's own SVG export.
//! A scene that fails is told and the rest go on; the run fails if any
//! did. It runs where tauri-driver runs, under a display server: Linux.

mod admin;
mod analyzer;
mod assistant;
mod connections;
mod desktop;
mod editing;
mod explorer;
mod live;
mod modeling;
mod results;
mod scene;
#[cfg(unix)]
mod server;
mod worksheets;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use turborel::db::{Database, OpenOptions};
use turborel_studio_core::assistant::mock::MockModel;

use crate::command::{root, say};
use crate::error::{Error, Result, fail};
use crate::images::write_png;
use crate::screenshots::connections::{DEMO_NAME, SERVER_NAME};
use crate::screenshots::scene::Scene;
use crate::webdriver::{Driver, config};

/// The window's size in every image, in pixels.
const WINDOW: (u32, u32) = (1280, 800);
/// The demo database's owner, the user every image shows.
const DEMO_USER: &str = "DEMO";
/// The demo's other users, made with no password, beside its owner.
const OTHER_USERS: [&str; 2] = ["ANN", "BEN"];
/// The ports of each theme's tauri-driver and its WebDriver.
const THEMES: [(&str, (u16, u16)); 2] = [("light", (4464, 4465)), ("dark", (4474, 4475))];

/// The demo's statements, each on lines of its own ended by a semicolon.
fn statements() -> Result<Vec<String>> {
    let seed = std::fs::read_to_string(root().join("xtask").join("screenshots").join("demo.sql"))
        .map_err(|e| Error(format!("xtask/screenshots/demo.sql: {e}")))?;
    let mut out = Vec::new();
    let mut statement = String::new();
    for line in seed.lines().filter(|l| !l.trim_start().starts_with("--")) {
        statement.push_str(line);
        statement.push('\n');
        if line.trim_end().ends_with(';') {
            out.push(statement.trim().trim_end_matches(';').to_owned());
            statement.clear();
        }
    }
    Ok(out)
}

/// Makes the demo database in `dir`, of the seed's statements, owned by `DEMO_USER`.
fn demo_database(dir: &Path) -> Result<()> {
    let failed = |e: turborel::error::SqlError| Error(format!("the demo database: {e}"));
    let db = Database::new();
    let fs = db.file_system().map_err(failed)?;
    db.open_files(&fs, dir, &OpenOptions::default()).map_err(failed)?;
    for user in std::iter::once(DEMO_USER).chain(OTHER_USERS) {
        db.create_user(user, b"").map_err(failed)?;
    }
    let session = db.session(DEMO_USER);
    for sql in statements()? {
        // A <schema> is the database's to make, a statement of a schema the session's.
        let ran = if sql.starts_with("CREATE SCHEMA") { db.schema(&sql).map(drop) } else { session.run(&sql).map(drop) };
        ran.map_err(|e| Error(format!("the demo database, at {sql}: {e}")))?;
        session.commit().map_err(failed)?;
    }
    db.close().map_err(failed)
}

/// A saved connection of `id` and `name`, of `spec` and `embedded`.
fn saved(id: &str, name: &str, spec: &serde_json::Value, embedded: Option<serde_json::Value>) -> serde_json::Value {
    let mut connection = serde_json::json!({
        "id": id, "name": name, "folder": [], "spec": spec, "environment": "development",
        "colour": null, "readOnly": false, "pinned": false, "favourites": []
    });
    if let (Some(embedded), Some(object)) = (embedded, connection.as_object_mut()) {
        object.insert("embedded".to_owned(), embedded);
    }
    connection
}

/// Writes the app data of `home`: the settings of `theme`; the demo
/// database, of the folder `demo`, saved as a connection, and the demo
/// server, of the socket `socket`, if one runs; Live Sessions on, under
/// the demo presenter's name, a column masked and each session recorded;
/// and the assistant on, of the scenes' model at `model`.
fn app_data(home: &Path, theme: &str, demo: &Path, (socket, model): (Option<&Path>, &str)) -> Result<PathBuf> {
    let dir = config(home);
    std::fs::create_dir_all(&dir).map_err(|e| Error(format!("{}: {e}", dir.display())))?;
    let settings = serde_json::json!({"format": 1, "theme": theme});
    let live = serde_json::json!({
        "format": 1, "enabled": true, "name": "Demo presenter", "maskedColumns": ["TOTAL"],
        "connectivity": {"direct": true, "port": 0, "advertise": ["127.0.0.1"]},
        "records": {"allowed": true, "byDefault": true, "sealed": false}
    });
    let embedded = serde_json::json!({"directory": demo.display().to_string(), "keys": null, "checksumKey": null, "pluginDirectories": null, "user": null});
    let mut connections = vec![saved("0d3e40c5a1b2c3d4e5f60718293a4b5c", DEMO_NAME, &serde_json::json!({}), Some(embedded))];
    if let Some(socket) = socket {
        let spec = serde_json::json!({"host": socket.display().to_string(), "user": DEMO_USER});
        connections.push(saved("5e1f2a3b4c5d6e7f8091a2b3c4d5e6f7", SERVER_NAME, &spec, None));
    }
    let connections = serde_json::json!({"format": 1, "connections": connections, "recent": []});
    for (name, json) in [("settings.json", settings), ("connections.json", connections), ("live-sessions.json", live)] {
        std::fs::write(dir.join(name), json.to_string()).map_err(|e| Error(format!("{name}: {e}")))?;
    }
    assistant::write_settings(&dir, model)?;
    Ok(dir)
}

/// A scene, by its name.
type Act = fn(&Scene<'_>) -> Result<()>;

/// A group of scenes, taken in one window, begun afresh for each group
/// so none inherits another group's state.
type Group = &'static [(&'static str, Act)];

/// The window, connections, the explorer and worksheets: connecting
/// first, as the window opens.
const CONNECTIONS: Group = &[
    ("connecting", connections::connect_scene),
    ("about", connections::about_scene),
    ("window", worksheets::window_scene),
    ("completion", worksheets::completion_scene),
    ("plan viewer", worksheets::plan_scene),
    ("context menu", worksheets::menu_scene),
    ("guard rails", worksheets::guard_scene),
    ("connection dialog", connections::connection_dialog_scene),
    ("embedded dialogs", connections::embedded_dialogs_scene),
    ("in memory", connections::in_memory_scene),
    ("tree", connections::tree_scene),
    ("filter", connections::filter_scene),
    ("details", connections::details_scene),
    ("script as", connections::script_as_scene),
    ("snippet and format", worksheets::snippet_format_scene),
    ("analyze a change", worksheets::analyze_change_scene),
    ("keys", worksheets::keys_scene),
    ("history", worksheets::history_scene),
];

/// Results.
const RESULTS: Group = &[
    ("grid", results::grid_scene),
    ("record view", results::record_scene),
    ("selection's sums", results::aggregates_scene),
    ("copy as", results::copy_scene),
    ("viewers", results::viewers_scene),
    ("spatial", results::spatial_scene),
    ("graph", results::graph_scene),
    ("result compare", results::compare_scene),
];

/// The analyzer and modeling.
const ANALYSIS: Group = &[
    ("plan warnings", analyzer::warnings_scene),
    ("analyzer", analyzer::analyzer_scene),
    ("report", analyzer::report_scene),
    ("plan compare", analyzer::plan_compare_scene),
    ("ER diagram", modeling::diagram_scene),
    ("query builder", modeling::builder_scene),
    ("schema compare", modeling::schema_compare_scene),
    ("import DDL", modeling::import_ddl_scene),
];

/// The assistant, a conversation through its scenes.
const ASSISTANT: Group = &[
    ("assistant settings", assistant::settings_scene),
    ("assistant question", assistant::question_scene),
    ("assistant approval", assistant::approval_scene),
    ("assistant blocked", assistant::blocked_scene),
    ("assistant log", assistant::log_scene),
];

/// Administration: users, and the monitor where a demo server may run.
#[cfg(unix)]
const ADMINISTRATION: Group = &[("users", admin::users_scene), ("monitor", admin::monitor_scene)];
/// Administration: users.
#[cfg(not(unix))]
const ADMINISTRATION: Group = &[("users", admin::users_scene)];

/// Live Sessions, a session through its scenes.
const LIVE: Group = &[
    ("Live Sessions", live::present_scene),
    ("live suggestion", live::suggestion_scene),
    ("live settings", live::settings_scene),
    ("live records", live::records_scene),
];

/// Editing data, last, as it changes the demo database.
const EDITING: Group = &[
    ("table dialogs", editing::table_dialogs_scene),
    ("compare rows", editing::compare_rows_scene),
    ("generate script", editing::generate_scene),
    ("edit rows", editing::edit_rows_scene),
    ("import", editing::import_scene),
    ("run SQL file", editing::sql_file_scene),
];

/// Every group of scenes, in the order they are taken.
const GROUPS: [Group; 7] = [CONNECTIONS, RESULTS, ANALYSIS, ASSISTANT, ADMINISTRATION, LIVE, EDITING];

/// Takes `act`, named `name`: its failure told at once, the window as the
/// scene left it pictured in `homes`, and whatever it left open closed.
fn take(scene: &Scene<'_>, (name, act): (&str, Act), homes: &Path) -> Option<String> {
    say(&format!("==> screenshots: {name}, {}", scene.theme));
    let Err(e) = act(scene) else { return None };
    // The window as the scene left it, and the display, as a platform's
    // dialog shows on it; then whatever it left open closed.
    let named = format!("failed-{}-{}", name.replace([' ', '\''], "-"), scene.theme);
    if let Ok(shown) = scene.shot() {
        let _ = write_png(&shown, &homes.join(format!("{named}.png"))); // A failure's picture helps alone.
    }
    desktop::capture_display(&homes.join(format!("{named}-display.png")));
    let _ = scene.escape();
    let failed = format!("{name}, {}: {e}", scene.theme);
    say(&format!("screenshots: failed: {failed}")); // Told at once, as a later panic would lose it.
    Some(failed)
}

/// What every theme's scenes share: the application, the folders, the
/// model's address and the demo server.
struct Run<'r> {
    application: &'r Path,
    homes: &'r Path,
    out: &'r Path,
    model: &'r str,
    #[cfg(unix)]
    server: Option<&'r server::DemoServer>,
}

impl Run<'_> {
    /// A scene of `session`, of `theme`, its settings in `config`, its
    /// invitation's link kept in `link`.
    fn scene<'s>(
        &'s self,
        session: &'s crate::webdriver::Session<'s>,
        (theme, config): (&'s str, &'s Path),
        link: &'s Mutex<Option<String>>,
    ) -> Scene<'s> {
        Scene {
            session,
            theme,
            out: self.out,
            config,
            model: self.model,
            link,
            #[cfg(unix)]
            server: self.server,
        }
    }
}

/// Takes every scene of `theme`, of a demo database of its own, so none is
/// opened after another left it; then the scene of a link, of a window
/// begun by the presenter's invitation's link alone: the names of those
/// that failed, and why.
fn theme_scenes(run: &Run<'_>, (theme, ports): (&str, (u16, u16))) -> Result<Vec<String>> {
    let home = run.homes.join(theme);
    let demo = run.homes.join(format!("demo-database-{theme}"));
    std::fs::create_dir_all(&demo).map_err(|e| Error(format!("{}: {e}", demo.display())))?;
    say(&format!("==> screenshots: the demo database, {theme}"));
    demo_database(&demo)?;
    #[cfg(unix)]
    let socket = run.server.map(|s| s.socket.as_path());
    #[cfg(not(unix))]
    let socket = None;
    let config = app_data(&home, theme, &demo, (socket, run.model))?;
    let driver = Driver::start(&home, ports)?;
    let link = Mutex::new(None);
    let mut failed = Vec::new();
    for group in GROUPS {
        let session = driver.session(run.application, &[])?;
        session.size(WINDOW)?;
        let scene = run.scene(&session, (theme, &config), &link);
        // The dock as at first, whatever the group before left it as.
        if group.first().is_some_and(|(name, _)| *name != "connecting") {
            connections::connected(&scene)
                .and_then(|()| scene.reset_layout())
                .unwrap_or_else(|e| failed.push(format!("a group's start, {theme}: {e}")));
        }
        for (at, &(name, act)) in group.iter().enumerate() {
            // A scene begins of the demo shop's connection alone, its
            // catalog read, nothing left open by the scene before.
            if (at, name) != (0, "connecting") {
                let ready = connections::connected(&scene).and_then(|()| scene.known_state());
                if let Err(e) = ready {
                    failed.push(format!("{name}, {theme}: its window was not ready: {e}"));
                    continue;
                }
            }
            failed.extend(take(&scene, (name, act), run.homes));
        }
        // The window ends of no database open, so the next opens none to recover.
        if let Err(e) = scene.disconnect_all() {
            failed.push(format!("the end of a group, {theme}: {e}"));
        }
    }
    drop(driver); // The window ends, so the link's is the one shown.
    let Some(link) = link.lock().ok().and_then(|l| l.clone()) else { return Ok(failed) };
    say(&format!("==> screenshots: join from a link, {theme}"));
    if let Err(e) = live::link_window(run.application, &home, &link, &run.out.join(format!("live-join-{theme}.png"))) {
        say(&format!("screenshots: failed: join from a link, {theme}: {e}"));
        failed.push(format!("join from a link, {theme}: {e}"));
    }
    Ok(failed)
}

/// The demo server, of the demo's statements, if `TURBOREL_TEST_SERVER`
/// names one; told and left out if it cannot start.
#[cfg(unix)]
fn demo_server(homes: &Path) -> Option<server::DemoServer> {
    let spec = std::env::var(server::SERVER_VARIABLE).ok().filter(|s| !s.is_empty())?;
    say("==> screenshots: the demo server");
    let started = server::DemoServer::start(&spec, &homes.join("server"), (DEMO_USER, &OTHER_USERS)).and_then(|server| {
        server.seed(DEMO_USER, &statements()?)?;
        Ok(server)
    });
    started.map_err(|e| say(&format!("screenshots: the demo server: {e}"))).ok()
}

/// Makes every image of the manual of the application at `application`.
pub fn screenshots(application: Option<&str>) -> Result<()> {
    let Some(application) = application else { return fail("usage: cargo xtask screenshots <the built application>") };
    let application = std::fs::canonicalize(application).map_err(|e| Error(format!("{application}: {e}")))?;
    let homes: PathBuf = root().join("target").join("screenshots");
    let _ = std::fs::remove_dir_all(&homes); // One of a run before is replaced.
    std::fs::create_dir_all(&homes).map_err(|e| Error(format!("{}: {e}", homes.display())))?;
    let out = root().join("doc").join("images");
    std::fs::create_dir_all(&out).map_err(|e| Error(format!("{}: {e}", out.display())))?;
    #[cfg(unix)]
    let server = demo_server(&homes);
    let mut failed = Vec::new();
    for theme in THEMES {
        // Each theme's model, its answers given afresh.
        let model = MockModel::start(assistant::answers());
        let run = Run {
            application: &application,
            homes: &homes,
            out: &out,
            model: &model.url,
            #[cfg(unix)]
            server: server.as_ref(),
        };
        failed.extend(theme_scenes(&run, theme)?);
    }
    #[cfg(unix)]
    if let Some(server) = server {
        server.stop();
    }
    if failed.is_empty() {
        say(&format!("screenshots: every scene written to {}", out.display()));
        Ok(())
    } else {
        fail(format!("scenes failed: {}", failed.join("; ")))
    }
}
