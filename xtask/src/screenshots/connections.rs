//! The scenes of installing, the window, connections and the explorer
//! (RULES.md D60): the About dialog; connecting and the catalog filling;
//! the connection dialog and its TLS; the dialogs of an embedded
//! database; a database in memory, unsaved; the status bar of each kind
//! of connection; the tree, its filter, the details, the definition and
//! the dependencies; and a table scripted as a SELECT to a worksheet.

use crate::error::{Result, fail};
use crate::screenshots::scene::{SAVED_ROWS, SETTLE, Scene, quoted};
use crate::webdriver::{BACKSPACE, CONTROL};

/// The saved connection of the demo database, as the explorer names it.
pub const DEMO_NAME: &str = "Demo shop";
/// The saved connection of the demo server, as the explorer names it.
pub const SERVER_NAME: &str = "Demo server";
/// The explorer.
const EXPLORER: &str = "[role=\"region\"][aria-label=\"Object Explorer\"]";
/// The dialog open, of which there is one at a time.
pub const DIALOG: &str = "[role=\"dialog\"]";

/// Connecting: the demo shop's saved connection double-clicked, its
/// catalog filling, a schema and its tables opened; an animation of the
/// explorer.
pub fn connect_scene(scene: &Scene<'_>) -> Result<()> {
    scene.until(&format!("return document.querySelector({}) !== null;", quoted(SAVED_ROWS)), "no connection is saved")?;
    let (x, y, w, h) = scene.area(EXPLORER)?;
    let mut film = scene.film(Some((x, y, w, h.min(560))));
    film.frame(120)?;
    scene.connect_saved(DEMO_NAME)?;
    scene.session.wait_for("[role=\"tree\"][aria-label=\"Catalog\"] [role=\"treeitem\"]")?;
    film.frame(80)?;
    scene.open_rows(&["DEMO", "Tables"])?;
    film.frame(80)?;
    scene.open_rows(&["Tables", "ORDERS"])?;
    film.frame(80)?;
    scene.open_rows(&["ORDERS", "CUSTOMER_ID"])?;
    film.frame(300)?;
    film.write("connecting", None)
}

/// Connects to the demo shop if the first scene did not.
pub fn connected(scene: &Scene<'_>) -> Result<()> {
    if scene.session.found("[role=\"tree\"][aria-label=\"Catalog\"] [role=\"treeitem\"]")? {
        return Ok(());
    }
    scene.connect_saved(DEMO_NAME)?;
    scene.session.wait_for("[role=\"tree\"][aria-label=\"Catalog\"] [role=\"treeitem\"]")
}

/// The About dialog: the version and the engine's commit.
pub fn about_scene(scene: &Scene<'_>) -> Result<()> {
    scene.command("About Turborel Studio")?;
    scene.session.wait_for(DIALOG)?;
    let read = "return [...document.querySelectorAll('dl.about code, dl.about dd')].every((e) => !e.textContent.includes('…'));";
    for _ in 0..40 {
        if scene.session.script(read)?.as_bool().unwrap_or(false) {
            break;
        }
        std::thread::sleep(SETTLE);
    }
    scene.save_part("about", DIALOG)?;
    scene.escape()
}

/// The connection dialog: a server's URI written, then its TLS opened.
pub fn connection_dialog_scene(scene: &Scene<'_>) -> Result<()> {
    scene.command("New Connection…")?;
    scene.session.wait_for(DIALOG)?;
    scene.fill("Name", "Shop, production")?;
    scene.fill("URI", "turborel://demo@db.example:7422/?tls_mode=verify-full")?;
    scene.save_part("connection-dialog", DIALOG)?;
    // The groups of the connection closed and TLS opened, so TLS is in view.
    scene.session.script(
        "for (const d of document.querySelectorAll('[role=dialog] details.field-group')) { d.open = d.querySelector('summary').textContent.includes('TLS'); }",
    )?;
    scene.choose("TLS mode", "verify-full")?;
    scene.fill("Server name", "db.example")?;
    scene.save_part("connection-tls", DIALOG)?;
    scene.escape()
}

/// New Database and Open Database, as their dialogs open.
pub fn embedded_dialogs_scene(scene: &Scene<'_>) -> Result<()> {
    scene.command("New Database…")?;
    scene.session.wait_for(DIALOG)?;
    scene.fill("Name", "Field notes")?;
    scene.fill("Owner", "DEMO")?;
    scene.save_part("new-database", DIALOG)?;
    scene.escape()?;
    scene.command("Open Database…")?;
    scene.session.wait_for(DIALOG)?;
    scene.fill("Name", "Archive")?;
    scene.save_part("open-database", DIALOG)?;
    scene.escape()
}

/// The status bar, as far as its parts reach, and a little more.
fn status_part(scene: &Scene<'_>) -> Result<crate::images::Pixels> {
    let (x, y, _, h) = scene.rect("footer.status-bar")?;
    let (px, _, pw, _) = scene.rect("footer.status-bar > *")?;
    let right = px.saturating_add(pw).saturating_add(16);
    Ok(crate::images::crop(&scene.shot()?, (x, y, right.saturating_sub(x), h)))
}

/// A database in memory, its badge, and the status bar of each kind of
/// connection: a server's, of a local socket, where the demo server runs;
/// an embedded database's; and one in memory.
pub fn in_memory_scene(scene: &Scene<'_>) -> Result<()> {
    scene.command("New In-Memory Database")?;
    scene.session.wait_for(".badge-unsaved")?;
    scene.save_part("in-memory", "[role=\"toolbar\"][aria-label=\"Explorer\"], [role=\"tree\"][aria-label=\"Open connections\"]")?;
    let memory = status_part(scene)?;
    scene.activate(DEMO_NAME)?;
    scene.wait_text("footer.status-bar", DEMO_NAME)?;
    let embedded = status_part(scene)?;
    let mut bars = Vec::new();
    if scene.saved_exists(SERVER_NAME)? {
        scene.connect_saved(SERVER_NAME)?;
        scene.wait_text("footer.status-bar", SERVER_NAME)?;
        bars.push(status_part(scene)?);
        scene.disconnect_others(Some(DEMO_NAME))?;
    }
    bars.extend([embedded, memory]);
    scene.save_stacked("status-bar", &bars)?;
    // The database in memory ended, as the active connection, by the command.
    scene.disconnect_others(Some(DEMO_NAME))?;
    scene.until("return document.querySelector('.badge-unsaved') === null;", "the database in memory stayed open")?;
    scene.activate(DEMO_NAME)
}

/// The tree: the demo shop's schema, its tables and views, and a table's
/// columns, keys and index, each of its icon.
pub fn tree_scene(scene: &Scene<'_>) -> Result<()> {
    // The connections folded and the explorer widened, so the tree shows whole.
    scene.connection_sections(false)?;
    scene.widen_left(120)?;
    scene.open_rows(&["DEMO", "Tables", "ORDERS", "CUSTOMER_ID"])?;
    scene.open_rows(&["DEMO", "Views", "CUSTOMER_TOTALS"])?;
    scene.save_part("explorer-tree", ".catalog")
}

/// The tree filtered by a name's start.
pub fn filter_scene(scene: &Scene<'_>) -> Result<()> {
    let filter = "input[aria-label=\"Search the catalog\"]";
    scene.press_button("[role=\"toolbar\"][aria-label=\"Explorer\"] button[aria-label=\"Filter\"]")?;
    scene.session.wait_for(filter)?;
    scene.session.type_into(filter, "ORDER")?;
    scene.save_part("explorer-filter", "[role=\"toolbar\"][aria-label=\"Explorer\"], .catalog")?;
    scene.session.press(&[CONTROL], &["a"])?;
    scene.session.press(&[], &[BACKSPACE])?;
    scene.press_button("[role=\"toolbar\"][aria-label=\"Explorer\"] button[aria-label=\"Filter\"]")
}

/// The details of a table, its definition and its dependencies.
pub fn details_scene(scene: &Scene<'_>) -> Result<()> {
    let details = "[role=\"region\"][aria-label=\"Details\"]";
    scene.widen_right(240)?;
    scene.select_row("ORDERS")?;
    scene.wait_text("h3.details-title", "ORDERS")?;
    for (tab, name) in [("Columns", "explorer-details"), ("Definition", "explorer-definition"), ("Dependencies", "explorer-dependencies")] {
        scene.click_text(&format!("{details} [role=\"tab\"]"), tab)?;
        wait_read(scene, details)?;
        scene.save_part(name, details)?;
    }
    scene.click_text(&format!("{details} [role=\"tab\"]"), "Columns")?;
    scene.reset_layout()
}

/// Waits until `selector` reads no more.
fn wait_read(scene: &Scene<'_>, selector: &str) -> Result<()> {
    let script = format!("return !document.querySelector({}).textContent.includes('Reading…');", quoted(selector));
    for _ in 0..60 {
        if scene.session.script(&script)?.as_bool().unwrap_or(false) {
            return Ok(());
        }
        std::thread::sleep(SETTLE);
    }
    fail(format!("{selector} was still reading"))
}

/// A table scripted as a SELECT to a worksheet, by its context menu: an
/// animation of the explorer and the worksheet.
pub fn script_as_scene(scene: &Scene<'_>) -> Result<()> {
    let (x, y, w, _) = scene.area(EXPLORER)?;
    let mut film = scene.film(Some((x, y, w.saturating_add(620), 540)));
    scene.wait_row("ORDERS")?;
    film.frame(80)?;
    scene.session.script("window.studioMenu(window.studioRow('ORDERS'));")?;
    scene.session.wait_for("[role=\"menu\"] [role=\"menuitem\"]")?;
    film.frame(90)?;
    scene.click_text("[role=\"menu\"][aria-label=\"Context menu\"] [role=\"menuitem\"]", "Script As")?;
    film.frame(90)?;
    scene.click_text("[role=\"menu\"][aria-label=\"Script As\"] [role=\"menuitem\"]", "SELECT")?;
    film.frame(90)?;
    scene.click_text("[role=\"menu\"][aria-label=\"SELECT\"] [role=\"menuitem\"]", "To Worksheet")?;
    scene.wait_text(".worksheet-body .cm-content", "SELECT")?;
    film.frame(300)?;
    film.write("script-as", None)?;
    scene.connection_sections(true)
}
