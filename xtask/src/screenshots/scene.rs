//! What every scene of the screenshots (RULES.md D60) is made with: the
//! window driven as a person drives it, by its own controls, its
//! commands run through the command palette, and what it shows written as
//! a PNG of the window or of a part of it, parts stacked, or frames of a
//! part as a GIF.

use std::path::Path;
use std::time::{Duration, Instant};

use crate::error::{Result, fail};
use crate::images::{Pixels, corner, crop, decode, stack, write_gif, write_png};
use crate::webdriver::{BACKSPACE, CONTROL, DRAWN_WITHIN, ESCAPE, Session};

/// How long a scene's drawing is let settle before it is taken.
pub const SETTLE: Duration = Duration::from_millis(700);
/// The pixels around a part of the window an image of it keeps.
const MARGIN: u32 = 12;
/// The key WebDriver presses as Shift.
pub const SHIFT: &str = "\u{E008}";
/// The key WebDriver presses as Return.
pub const ENTER: &str = "\u{E007}";
/// The key WebDriver presses as the arrow down.
pub const DOWN: &str = "\u{E015}";
/// The key WebDriver presses as F10, which with Shift opens a cell's menu.
pub const F10: &str = "\u{E03A}";

/// The page's helpers, defined once a scene needs them: a row of the
/// catalog by its label, a context menu opened on an element, and an
/// element marked for the driver by its selector and the text it holds.
const HELPERS: &str = r#"
window.studioRow = (label) => [...document.querySelectorAll('[role=tree][aria-label=Catalog] [role=treeitem]')]
  .find((e) => [...e.querySelectorAll('span')].some((s) => s.textContent === label));
window.studioMenu = (element) => {
  const r = element.getBoundingClientRect();
  element.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + r.height / 2}));
};
window.studioMark = (selector, text, id) => {
  document.getElementById(id)?.removeAttribute('id');
  const exact = text.startsWith('=');
  const e = [...document.querySelectorAll(selector)].find((e) => e.offsetParent !== null && (text === '' || (exact ? e.textContent.trim() === text.slice(1) : e.textContent.includes(text))));
  if (e) { e.id = id; }
  return e !== undefined;
};
window.studioField = (label, kind) => {
  const shown = (e) => e && e.offsetParent !== null;
  const byLabel = [...document.querySelectorAll('label')].filter(shown).find((l) => (l.querySelector('span')?.textContent ?? l.textContent).trim().startsWith(label));
  const inLabel = byLabel?.querySelector(kind) ?? (byLabel?.control?.matches(kind) ? byLabel.control : null);
  return inLabel ?? [...document.querySelectorAll(kind)].filter(shown).find((e) => e.getAttribute('aria-label') === label) ?? null;
};
window.studioGrid = () => [...document.querySelectorAll('.result-grid')].find((e) => e.offsetParent !== null);
window.studioCell = (column, row) => window.studioGrid()?.querySelector('[id="glide-cell-' + column + '-' + row + '"]');
window.studioRect = (selector) => {
  const shown = [...document.querySelectorAll(selector)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
  if (shown.length === 0) { return null; }
  const left = Math.min(...shown.map((r) => r.left)), top = Math.min(...shown.map((r) => r.top));
  const right = Math.max(...shown.map((r) => r.right)), bottom = Math.max(...shown.map((r) => r.bottom));
  const d = window.devicePixelRatio;
  return [left * d, top * d, (right - left) * d, (bottom - top) * d].map(Math.round);
};
"#;

/// What a scene makes its images with.
pub struct Scene<'s> {
    /// The window's session.
    pub session: &'s Session<'s>,
    /// The theme, `light` or `dark`, each image's name ends with.
    pub theme: &'s str,
    /// The folder the images are written to.
    pub out: &'s Path,
    /// The application's folder of settings, which a scene may write.
    pub config: &'s Path,
    /// The address of the scenes' own model, the assistant's.
    pub model: &'s str,
    /// The invitation link the presenter made, for the scene of a link.
    pub link: &'s std::sync::Mutex<Option<String>>,
    /// The demo server, if one runs.
    #[cfg(unix)]
    pub server: Option<&'s crate::screenshots::server::DemoServer>,
}

impl<'s> Scene<'s> {
    /// The window as it is now.
    pub fn shot(&self) -> Result<Pixels> {
        std::thread::sleep(SETTLE);
        decode(&self.session.screenshot()?)
    }

    /// The path of the image `name` of this theme, of the kind `kind`.
    pub fn path(&self, name: &str, kind: &str) -> std::path::PathBuf {
        self.out.join(format!("{name}-{}.{kind}", self.theme))
    }

    /// Writes the window as it is now as `name`.
    pub fn save(&self, name: &str) -> Result<()> {
        write_png(&self.shot()?, &self.path(name, "png"))
    }

    /// Writes the part of the window `selector` finds, a margin around
    /// it, as `name`.
    pub fn save_part(&self, name: &str, selector: &str) -> Result<()> {
        let area = self.area(selector)?;
        write_png(&crop(&self.shot()?, area), &self.path(name, "png"))
    }

    /// Writes `parts`, each the window's part a selector found as it was
    /// taken, one below another, as `name`.
    pub fn save_stacked(&self, name: &str, parts: &[Pixels]) -> Result<()> {
        let background = parts.first().map_or([0, 0, 0, 255], corner);
        write_png(&stack(parts, MARGIN, background), &self.path(name, "png"))
    }

    /// The part of the window `selector` finds, as it is now, a margin
    /// around it.
    pub fn part(&self, selector: &str) -> Result<Pixels> {
        let area = self.area(selector)?;
        Ok(crop(&self.shot()?, area))
    }

    /// The rectangle, in the screenshot's pixels, around every element
    /// `selector` finds that is shown.
    pub fn rect(&self, selector: &str) -> Result<(u32, u32, u32, u32)> {
        self.session.wait_for(selector)?;
        self.helpers()?;
        let got = self.session.script(&format!("return window.studioRect({});", quoted(selector)))?;
        if got.is_null() {
            return fail(format!("no {selector} is shown"));
        }
        let n = |i: usize| got.get(i).and_then(serde_json::Value::as_u64).and_then(|v| u32::try_from(v).ok()).unwrap_or(0);
        Ok((n(0), n(1), n(2), n(3)))
    }

    /// `rect` of `selector`, a margin around it.
    pub fn area(&self, selector: &str) -> Result<(u32, u32, u32, u32)> {
        let (x, y, w, h) = self.rect(selector)?;
        let (left, top) = (x.saturating_sub(MARGIN), y.saturating_sub(MARGIN));
        Ok((
            left,
            top,
            w.saturating_add(x.saturating_sub(left)).saturating_add(MARGIN),
            h.saturating_add(y.saturating_sub(top)).saturating_add(MARGIN),
        ))
    }

    /// Defines the page's helpers, as a page drawn anew has none.
    pub fn helpers(&self) -> Result<()> {
        self.session.script(HELPERS).map(drop)
    }

    /// Runs the command `title` through the command palette, as a person
    /// who knows its name does.
    pub fn command(&self, title: &str) -> Result<()> {
        self.escape()?;
        self.session.click("[role=\"toolbar\"][aria-label=\"Toolbar\"] button[aria-label=\"Command Palette\"]")?;
        let input = "[role=\"combobox\"][aria-label=\"Command\"]";
        self.session.wait_for(input)?;
        self.session.type_into(input, title)?;
        // An option is written "Category: Title"; the one of this title alone.
        let script = format!(
            "document.getElementById('studio-target')?.removeAttribute('id'); const e = [...document.querySelectorAll('#palette-list [role=option]')].find((e) => e.textContent.trim().endsWith(': ' + {0})); if (e) {{ e.id = 'studio-target'; }} return e !== undefined;",
            quoted(title)
        );
        let start = Instant::now();
        while !self.session.script(&script)?.as_bool().unwrap_or(false) {
            if start.elapsed() > DRAWN_WITHIN {
                return fail(format!("the palette offered no {title}"));
            }
            std::thread::sleep(SETTLE);
        }
        self.session.click("#studio-target")
    }

    /// Presses Escape: a menu, a list or a dialog open is closed.
    pub fn escape(&self) -> Result<()> {
        self.session.press(&[], &[ESCAPE])
    }

    /// Waits until an element `selector` finds, shown, holds `text`, and
    /// marks it `studio-target` for the driver.
    pub fn wait_text(&self, selector: &str, text: &str) -> Result<()> {
        let script = format!("return window.studioMark({}, {}, 'studio-target');", quoted(selector), quoted(text));
        let start = Instant::now();
        loop {
            if self.session.script("return typeof window.studioMark")?.as_str() != Some("function") {
                self.helpers()?;
            }
            if self.session.script(&script)?.as_bool().unwrap_or(false) {
                return Ok(());
            }
            if start.elapsed() > DRAWN_WITHIN {
                let shown = self.session.script("return document.body.innerText.slice(0, 600)").map(|v| v.to_string()).unwrap_or_default();
                return fail(format!("the window drew no {selector} of {text}; it showed: {shown}"));
            }
            std::thread::sleep(SETTLE);
        }
    }

    /// Clicks, as a person does, the element `selector` finds whose text
    /// holds `text`, once the window draws it.
    pub fn click_text(&self, selector: &str, text: &str) -> Result<()> {
        self.wait_text(selector, text)?;
        self.session.click("#studio-target")
    }

    /// Clicks the button of `label`, its accessible name, wherever it is shown.
    pub fn button(&self, label: &str) -> Result<()> {
        let by_label = format!("button[aria-label={}]", quoted(label));
        if self.session.found(&by_label)? {
            return self.session.click(&by_label);
        }
        self.click_text("button", label)
    }

    /// Types `text` into the shown field of the label `label`, emptied first.
    pub fn fill(&self, label: &str, text: &str) -> Result<()> {
        let script = format!(
            "document.getElementById('studio-field')?.removeAttribute('id'); const e = window.studioField({0}, 'input, textarea'); if (e) {{ e.id = 'studio-field'; e.focus(); e.select?.(); }} return e !== undefined && e !== null;",
            quoted(label)
        );
        self.until(&script, &format!("the window drew no field {label}"))?;
        self.session.press(&[CONTROL], &["a"])?;
        self.session.press(&[], &[BACKSPACE])?;
        self.session.type_into("#studio-field", text)
    }

    /// Chooses the option of `value`, its value or the text it shows, in
    /// the shown select of the label `label`, as a person does, the page
    /// told of the change.
    pub fn choose(&self, label: &str, value: &str) -> Result<()> {
        let script = format!(
            "const e = window.studioField({0}, 'select'); if (!e) return false; const o = [...e.options].find((o) => o.value === {1}) ?? [...e.options].find((o) => o.text.includes({1})); if (!o) return false; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(e, o.value); e.dispatchEvent(new Event('change', {{bubbles: true}})); return true;",
            quoted(label),
            quoted(value)
        );
        self.until(&script, &format!("the window drew no choice {label} of {value}"))
    }

    /// Clicks the shown check box of the label `label`, as a person does.
    pub fn tick(&self, label: &str) -> Result<()> {
        let script = format!("const e = window.studioField({0}, 'input'); if (!e) return false; e.click(); return true;", quoted(label));
        self.until(&script, &format!("the window drew no check box {label}"))
    }

    /// Runs `script` until it returns true, or fails as `failed` says.
    pub fn until(&self, script: &str, failed: &str) -> Result<()> {
        self.helpers()?;
        let start = Instant::now();
        while !self.session.script(script)?.as_bool().unwrap_or(false) {
            if start.elapsed() > DRAWN_WITHIN {
                return fail(failed.to_owned());
            }
            std::thread::sleep(SETTLE);
        }
        Ok(())
    }

    /// The worksheet, its editor focused and emptied: the scenes' one
    /// worksheet, opened by the first.
    pub fn worksheet(&self) -> Result<()> {
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
    pub fn tool(&self, name: &str) -> Result<()> {
        self.escape()?;
        // The worksheet's toolbar is drawn again as the scene before leaves it.
        let button = format!("[role=\"toolbar\"][aria-label=\"Worksheet\"] button[aria-label=\"{name}\"]");
        self.session.wait_for(&button)?;
        self.session.click(&button)
    }

    /// A new worksheet, its editor focused, apart from the one the other scenes share.
    pub fn new_worksheet(&self) -> Result<()> {
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
    pub fn focus_editor(&self) -> Result<()> {
        let script = "document.getElementById('studio-editor')?.removeAttribute('id'); const e = [...document.querySelectorAll('.worksheet-body .cm-content')].find((e) => e.offsetParent !== null); if (e) { e.id = 'studio-editor'; e.focus(); } return e !== undefined;";
        // The window may still be laying out the worksheet the last scene left.
        let start = Instant::now();
        while !self.session.script(script)?.as_bool().unwrap_or(false) {
            if start.elapsed() > DRAWN_WITHIN {
                return fail("no worksheet is shown");
            }
            std::thread::sleep(SETTLE);
        }
        // Focused by the page already; a click, where one lands, puts the cursor too.
        let _ = self.session.click("#studio-editor");
        Ok(())
    }

    /// The worksheet emptied and `sql` written in it, then run by the
    /// worksheet's button `tool`.
    pub fn run(&self, sql: &str, tool: &str) -> Result<()> {
        self.worksheet()?;
        self.write(sql)?;
        self.tool(tool)
    }

    /// Waits until the catalog draws a row of `label`.
    pub fn wait_row(&self, label: &str) -> Result<()> {
        self.helpers()?;
        let start = Instant::now();
        while !self.session.script(&format!("return window.studioRow({}) !== undefined", quoted(label)))?.as_bool().unwrap_or(false) {
            if start.elapsed() > DRAWN_WITHIN {
                return fail(format!("the catalog drew no row {label}"));
            }
            std::thread::sleep(SETTLE);
        }
        Ok(())
    }

    /// Opens the catalog's rows of `path` in turn, each by a double click
    /// unless the row below it is drawn already.
    pub fn open_rows(&self, path: &[&str]) -> Result<()> {
        for pair in path.windows(2) {
            let (row, below) = (pair.first().copied().unwrap_or_default(), pair.get(1).copied().unwrap_or_default());
            self.wait_row(row)?;
            let shown =
                self.session.script(&format!("return window.studioRow({}) !== undefined", quoted(below)))?.as_bool().unwrap_or(false);
            if !shown {
                self.session
                    .script(&format!("window.studioRow({})?.dispatchEvent(new MouseEvent('dblclick', {{bubbles: true}}))", quoted(row)))?;
            }
            self.wait_row(below)?;
        }
        Ok(())
    }

    /// Selects the catalog's row `label`, as a click does.
    pub fn select_row(&self, label: &str) -> Result<()> {
        self.wait_row(label)?;
        self.session.script(&format!("window.studioRow({})?.click()", quoted(label))).map(drop)
    }

    /// Opens the context menu of the catalog's row `label`, and clicks
    /// its items `items` in turn, a submenu's after its own.
    pub fn row_menu(&self, label: &str, items: &[&str]) -> Result<()> {
        self.wait_row(label)?;
        self.session.script(&format!("window.studioMenu(window.studioRow({}));", quoted(label)))?;
        self.menu_items(items)
    }

    /// Clicks the open menu's items `items` in turn.
    pub fn menu_items(&self, items: &[&str]) -> Result<()> {
        for item in items {
            self.click_text("[role=\"menu\"] [role=\"menuitem\"]", item)?;
        }
        Ok(())
    }

    /// Selects the cell of the shown result's grid at `column`, counted
    /// from 1, the row numbers' column 0, and `row`, counted from 0.
    pub fn cell(&self, column: u32, row: u32) -> Result<()> {
        self.helpers()?;
        let script = format!("const c = window.studioCell({column}, {row}); if (c) {{ c.focus(); }} return c !== undefined && c !== null;");
        let start = Instant::now();
        while !self.session.script(&script)?.as_bool().unwrap_or(false) {
            if start.elapsed() > DRAWN_WITHIN {
                return fail(format!("the grid drew no cell {column}, {row}"));
            }
            std::thread::sleep(SETTLE);
        }
        Ok(())
    }

    /// Runs `sql` in the worksheet by `tool`, and waits for its grid.
    pub fn result(&self, sql: &str, tool: &str) -> Result<()> {
        self.run(sql, tool)?;
        self.helpers()?;
        let start = Instant::now();
        while !self
            .session
            .script("return window.studioCell(1, 0) !== undefined && window.studioCell(1, 0) !== null;")?
            .as_bool()
            .unwrap_or(false)
        {
            if start.elapsed() > DRAWN_WITHIN {
                return fail(format!("no rows of {sql}"));
            }
            std::thread::sleep(SETTLE);
        }
        Ok(())
    }

    /// Clicks the shown element `selector` finds whose text is `text`, all of it.
    pub fn click_exact(&self, selector: &str, text: &str) -> Result<()> {
        self.click_text(selector, &format!("={text}"))
    }

    /// Clicks the first shown element `selector` finds.
    pub fn click_shown(&self, selector: &str) -> Result<()> {
        self.click_text(selector, "")
    }

    /// Types `text` into the worksheet's editor.
    pub fn write(&self, text: &str) -> Result<()> {
        self.session.type_into("#studio-editor", text)
    }

    /// A film of the window, frames added as it changes, of its part
    /// `area` if it is known as the film begins.
    pub fn film(&self, area: Option<(u32, u32, u32, u32)>) -> Film<'_, 's> {
        Film { scene: self, area, frames: Vec::new() }
    }
}

/// Names `file` in the platform's file dialog of the title `title` open
/// now, as a person does: the dialog found by its title, the path typed,
/// in the location bar of a dialog that opens a file or folder, and
/// Return, by `xdotool` of the display the window is on.
///
/// # Errors
///
/// xdotool cannot be run, or finds no such dialog.
pub fn name_in_dialog(title: &str, file: &Path, opens: bool) -> Result<()> {
    let typed = |args: &[&str]| -> Result<()> {
        let done = std::process::Command::new("timeout")
            .arg("30")
            .arg("xdotool")
            .args(args)
            .status()
            .map_err(|e| crate::error::Error(format!("cannot run xdotool: {e}")))?;
        if done.success() { Ok(()) } else { fail(format!("xdotool {} failed", args.join(" "))) }
    };
    let path = file.display().to_string();
    // A virtual display has no window manager to activate a window: the
    // dialog is given the keyboard's focus instead.
    typed(&["search", "--sync", "--onlyvisible", "--name", title, "windowfocus", "--sync"])?;
    std::thread::sleep(SETTLE);
    if opens {
        typed(&["key", "ctrl+l"])?;
    }
    typed(&["key", "ctrl+a"])?;
    typed(&["type", "--delay", "20", &path])?;
    typed(&["key", "Return"])
}

/// The demo's file `name`, of `xtask/screenshots/`, copied where a
/// person keeps such a file, so a dialog that shows its path shows a short
/// one: the system's temporary folder's `demo-shop`.
///
/// # Errors
///
/// The file cannot be copied.
pub fn demo_file(name: &str) -> Result<std::path::PathBuf> {
    let dir = std::env::temp_dir().join("demo-shop");
    std::fs::create_dir_all(&dir).map_err(|e| crate::error::Error(format!("{}: {e}", dir.display())))?;
    let to = dir.join(name);
    std::fs::copy(crate::command::root().join("xtask").join("screenshots").join(name), &to)
        .map_err(|e| crate::error::Error(format!("xtask/screenshots/{name}: {e}")))?;
    Ok(to)
}

/// `text` as a JavaScript string's literal.
pub fn quoted(text: &str) -> String {
    serde_json::Value::String(text.to_owned()).to_string()
}

/// Frames of the window, made a GIF of a part of it.
pub struct Film<'f, 's> {
    scene: &'f Scene<'s>,
    area: Option<(u32, u32, u32, u32)>,
    frames: Vec<(Pixels, u16)>,
}

impl Film<'_, '_> {
    /// Adds the window as it is now, shown for `hundredths` of a second.
    pub fn frame(&mut self, hundredths: u16) -> Result<()> {
        let frame = self.scene.shot()?;
        self.frames.push((frame, hundredths));
        Ok(())
    }

    /// Writes the frames, each its part `area` or the one the film was
    /// begun with, as the animation `name` of the scene's theme.
    pub fn write(&self, name: &str, area: Option<(u32, u32, u32, u32)>) -> Result<()> {
        let frames: Vec<(Pixels, u16)> = match area.or(self.area) {
            Some(area) => self.frames.iter().map(|(f, h)| (crop(f, area), *h)).collect(),
            None => self.frames.clone(),
        };
        write_gif(&frames, &self.scene.path(name, "gif"))
    }
}
