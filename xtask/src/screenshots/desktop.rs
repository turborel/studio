//! What the screenshots' scenes (RULES.md D60) do outside the window's
//! page: a file named in the platform's dialog, by keys `xdotool` types;
//! the display pictured, by ImageMagick's `import`; and the demo's files
//! put where a person keeps such files.

use std::path::Path;

use crate::error::{Result, fail};
use crate::screenshots::scene::SETTLE;

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
    // A completion the location offers may take the first Return.
    for _ in 0..3 {
        typed(&["key", "Return"])?;
        std::thread::sleep(SETTLE);
        if typed(&["search", "--onlyvisible", "--name", title]).is_err() {
            return Ok(());
        }
    }
    fail(format!("the dialog {title} took not the path {path}"))
}

/// The whole display, as the X server shows it, written to `path` by
/// ImageMagick's `import`, where it runs: of a scene that failed in a
/// platform's dialog, which the window's own screenshot shows not.
pub fn capture_display(path: &Path) {
    let _ = std::process::Command::new("timeout").args(["20", "import", "-window", "root"]).arg(path).status(); // A picture that helps alone.
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
