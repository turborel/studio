//! The menu bar (RULES.md D30): the platform's own, its items Studio's
//! commands by name, each told to the webview as the event `studio:menu`,
//! which runs the command as its key or the command palette would. The
//! platform's own items, as Copy and Paste, are the platform's.

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

/// The event a menu item is told as.
pub const MENU_EVENT: &str = "studio:menu";

/// A menu's item: a command's name and its label, or a separator, `None`.
pub type Item = Option<(&'static str, &'static str)>;

/// The menus, each its title and its items.
pub const MENUS: [(&str, &[Item]); 6] = [
    (
        "File",
        &[
            Some(("connection.new", "New Connection…")),
            Some(("worksheet.new", "New Worksheet")),
            Some(("file.open", "Open File…")),
            Some(("worksheet.save", "Save")),
            Some(("worksheet.saveAs", "Save As…")),
            Some(("worksheet.reopen", "Reopen Closed Worksheet")),
            None,
            Some(("history.open", "History…")),
            None,
            Some(("settings.open", "Settings…")),
        ],
    ),
    (
        "Worksheet",
        &[
            Some(("worksheet.run", "Run Statement")),
            Some(("worksheet.runScript", "Run Script")),
            Some(("worksheet.runOnFolder", "Run Script on a Folder's Connections…")),
            Some(("worksheet.explain", "Explain")),
            Some(("worksheet.explainAnalyze", "Explain Analyze")),
            None,
            Some(("worksheet.format", "Format")),
            Some(("worksheet.comment", "Toggle Comment")),
            Some(("worksheet.upperCase", "Upper Case")),
            Some(("worksheet.lowerCase", "Lower Case")),
            Some(("worksheet.find", "Find and Replace…")),
            None,
            Some(("worksheet.bookmark", "Toggle Bookmark")),
            Some(("worksheet.nextBookmark", "Next Bookmark")),
            Some(("worksheet.previousBookmark", "Previous Bookmark")),
            Some(("worksheet.definition", "Go to Definition")),
            Some(("worksheet.describe", "Describe")),
            None,
            Some(("worksheet.split", "Split Editor")),
            Some(("worksheet.outline", "Outline")),
            Some(("worksheet.favourite", "Add to Favourite Queries…")),
            Some(("worksheet.autocommit", "Autocommit")),
            None,
            Some(("worksheet.pin", "Pin Tab")),
            Some(("worksheet.close", "Close Worksheet")),
            Some(("worksheet.closeOthers", "Close Other Worksheets")),
        ],
    ),
    (
        "Connection",
        &[
            Some(("connection.disconnect", "Disconnect")),
            Some(("connection.reconnect", "Reconnect")),
            None,
            Some(("statement.cancel", "Cancel Statement")),
            Some(("transaction.commit", "Commit")),
            Some(("transaction.rollback", "Rollback")),
        ],
    ),
    (
        "View",
        &[
            Some(("palette.open", "Command Palette…")),
            None,
            Some(("theme.system", "Theme: System")),
            Some(("theme.light", "Theme: Light")),
            Some(("theme.dark", "Theme: Dark")),
            None,
            Some(("zoom.in", "Zoom In")),
            Some(("zoom.out", "Zoom Out")),
            Some(("zoom.reset", "Actual Size")),
            None,
            Some(("layout.reset", "Reset Layout")),
        ],
    ),
    ("Window", &[]),
    ("Help", &[Some(("help.about", "About Turborel Studio")), Some(("help.shortcuts", "Keyboard Shortcuts"))]),
];

/// The menu bar of `app`.
///
/// # Errors
///
/// Tauri's, if an item cannot be made.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    #[cfg(target_os = "macos")]
    menu.append(&Submenu::with_items(
        app,
        "Turborel Studio",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?)?;
    for (title, items) in MENUS {
        let submenu = Submenu::new(app, title, true)?;
        for item in items {
            match item {
                Some((id, label)) => submenu.append(&MenuItem::with_id(app, *id, *label, true, None::<&str>)?)?,
                None => submenu.append(&PredefinedMenuItem::separator(app)?)?,
            }
        }
        platform_items(app, title, &submenu)?;
        menu.append(&submenu)?;
        if title == "File" {
            menu.append(&edit(app)?)?;
        }
    }
    Ok(menu)
}

/// The platform's own items of the menu `title`: Edit's, which the webview
/// needs for the clipboard's keys, and Window's.
fn platform_items<R: Runtime>(app: &AppHandle<R>, title: &str, submenu: &Submenu<R>) -> tauri::Result<()> {
    if title == "File" {
        submenu.append(&PredefinedMenuItem::separator(app)?)?;
        submenu.append(&PredefinedMenuItem::close_window(app, None)?)?;
    }
    if title == "Window" {
        submenu.append(&PredefinedMenuItem::minimize(app, None)?)?;
        submenu.append(&PredefinedMenuItem::fullscreen(app, None)?)?;
    }
    Ok(())
}

/// The Edit menu, the platform's clipboard items.
fn edit<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )
}

/// Tells the webview a menu item of Studio's was chosen; the platform's
/// own items are the platform's.
pub fn chosen<R: Runtime>(app: &AppHandle<R>, event: &MenuEvent) {
    let id = event.id().as_ref();
    if is_command(id) {
        // A window closing as the item is chosen needs it no more.
        let _ = app.emit(MENU_EVENT, id);
    }
}

/// Whether `id` is one of Studio's commands of the menus.
pub fn is_command(id: &str) -> bool {
    MENUS.iter().flat_map(|(_, items)| items.iter().flatten()).any(|(command, _)| *command == id)
}
