//! The scenes of editing data (RULES.md D60): rows edited in the grid
//! and applied; the import wizard, its format found, its types inferred
//! and its CREATE TABLE; the dialogs that make and alter a table; rows
//! compared with a staging copy; a schema's script with its data; and a
//! SQL file run, its statements told before it runs.

use crate::error::Result;
use crate::screenshots::connections::DIALOG;
use crate::screenshots::scene::{ENTER, SETTLE, Scene, demo_file, name_in_dialog, quoted};
use crate::webdriver::CONTROL;

/// The shown result's grid's cell that shows `text`, edited to `to`.
fn edit_cell(scene: &Scene<'_>, text: &str, to: &str) -> Result<()> {
    let focus = format!(
        "const t = [...(window.studioGrid()?.querySelectorAll('td[role=gridcell]') ?? [])].find((t) => t.textContent === {}); if (t) {{ t.focus(); setTimeout(() => t.click(), 300); }} return t !== undefined;",
        quoted(text)
    );
    scene.until(&focus, &format!("the grid shows no cell {text}"))?;
    scene.session.wait_for("textarea.gdg-input")?;
    scene.session.press(&[CONTROL], &["a"])?;
    scene.session.type_into("textarea.gdg-input", to)?;
    scene.session.press(&[], &[ENTER])
}

/// Rows edited in the grid: a city changed, the change staged, reviewed
/// and applied; an animation of the result.
pub fn edit_rows_scene(scene: &Scene<'_>) -> Result<()> {
    scene.open_rows(&["DEMO", "Tables", "CUSTOMERS"])?;
    scene.select_row("CUSTOMERS")?;
    scene.click_text("[aria-label=\"Table actions\"] button", "Edit Rows…")?;
    scene.click_exact("[role=\"dialog\"] .dialog-buttons button", "Edit")?;
    scene.session.wait_for("button[aria-label=\"Add Row\"]")?;
    let mut film = scene.film(None);
    film.frame(120)?;
    edit_cell(scene, "Oslo", "Bergen")?;
    film.frame(100)?;
    edit_cell(scene, "Cairo", "Alexandria")?;
    scene.wait_text(".edit-tools span.hint", "2 changes")?;
    film.frame(150)?;
    scene.click_shown("button[aria-label=\"Apply Changes\"]")?;
    std::thread::sleep(SETTLE);
    let _ = scene.command("Commit"); // Of a session in autocommit, there is none to make.
    film.frame(300)?;
    let area = scene.area(".result")?;
    film.write("edit-rows", Some((area.0, area.1, area.2, area.3.min(460))))
}

/// The import wizard into a new table: a CSV file chosen, its format found,
/// its fields' types inferred and the CREATE TABLE written; then the table
/// made and the rows imported. A picture of the dialog, and an animation.
pub fn import_scene(scene: &Scene<'_>) -> Result<()> {
    let suppliers = demo_file("suppliers.csv")?;
    scene.select_row("DEMO")?;
    scene.click_text("[aria-label=\"Schema actions\"] button", "Import into New Table…")?;
    scene.session.wait_for(DIALOG)?;
    let mut film = scene.film(None);
    film.frame(120)?;
    scene.click_text("[role=\"dialog\"] button", "Choose File…")?;
    name_in_dialog("Open File", &suppliers, true)?;
    scene.session.wait_for("pre[aria-label=\"DDL\"]")?;
    film.frame(200)?;
    scene.save_part("import-wizard", DIALOG)?;
    scene.session.script("document.querySelector('pre[aria-label=\"DDL\"]').scrollIntoView({block: 'end'});")?;
    film.frame(200)?;
    scene.save_part("import-create-table", DIALOG)?;
    let area = scene.area(DIALOG)?;
    scene.click_text("[role=\"dialog\"] .dialog-buttons button", "Create Table and Import")?;
    scene.click_exact("[role=\"dialog\"] button", "Create Table")?;
    scene.wait_text("[role=\"dialog\"] [role=\"status\"]", "Imported")?;
    film.frame(300)?;
    film.write("import", Some(area))?;
    scene.escape()
}

/// The dialogs that make a table and alter one, each with its DDL.
pub fn table_dialogs_scene(scene: &Scene<'_>) -> Result<()> {
    scene.select_row("DEMO")?;
    scene.click_text("[aria-label=\"Schema actions\"] button", "Create Table…")?;
    scene.session.wait_for(DIALOG)?;
    scene.fill("Name", "STOCK")?;
    scene.fill("Name of column 1", "PRODUCT_ID")?;
    scene.choose("Key of column 1", "primary")?;
    for (n, (name, kind)) in [(2, ("ON_HAND", "INTEGER")), (3, ("COUNTED", "DATE"))] {
        scene.button("Add Column")?;
        scene.fill(&format!("Name of column {n}"), name)?;
        scene.fill(&format!("Type of column {n}"), kind)?;
    }
    scene.tick("Column 2 is NOT NULL")?;
    scene.wait_text("pre[aria-label=\"DDL\"]", "CREATE TABLE")?;
    scene.save_part("create-table", DIALOG)?;
    scene.escape()?;
    scene.select_row("CUSTOMERS")?;
    scene.click_text("[aria-label=\"Table actions\"] button", "Alter Table…")?;
    scene.choose("Action", "addColumn")?;
    scene.fill("Name of column 1", "EMAIL")?;
    scene.fill("Type of column 1", "VARCHAR(80)")?;
    scene.button("Add to Script")?;
    scene.wait_text("pre[aria-label=\"DDL\"]", "ALTER TABLE")?;
    scene.save_part("alter-table", DIALOG)?;
    scene.escape()
}

/// The products compared with their staging copy's, and the script that
/// makes the copy's rows the shop's.
pub fn compare_rows_scene(scene: &Scene<'_>) -> Result<()> {
    scene.select_row("PRODUCTS")?;
    scene.click_text("[aria-label=\"Table actions\"] button", "Compare Rows…")?;
    scene.session.wait_for(DIALOG)?;
    scene.fill("Schema", "STAGING")?;
    scene.click_exact("[role=\"dialog\"] .dialog-buttons button", "Compare")?;
    scene.wait_text("[role=\"dialog\"] [role=\"status\"]", "rows the same")?;
    let dialog = scene.part(DIALOG)?;
    scene.click_text("[role=\"dialog\"] .dialog-buttons button", "Open Script in Worksheet")?;
    scene.wait_text(".worksheet-body .cm-content", "UPDATE")?;
    let script = scene.part(".worksheet-body")?;
    scene.save_stacked("compare-rows", &[dialog, script])
}

/// Generate Script: the schema's objects, and its tables' rows as INSERTs.
pub fn generate_scene(scene: &Scene<'_>) -> Result<()> {
    scene.select_row("DEMO")?;
    scene.click_text("[aria-label=\"Schema actions\"] button", "Generate Script…")?;
    scene.session.wait_for("ul[aria-label=\"Objects\"]")?;
    scene.click_text("[role=\"dialog\"] label", "as INSERT statements")?;
    scene.save_part("generate-script", DIALOG)?;
    scene.escape()
}

/// Run SQL File: a month end's file chosen, what it holds told before it
/// runs, its destroying statement asked about, and what the run did; an
/// animation of the dialog.
pub fn sql_file_scene(scene: &Scene<'_>) -> Result<()> {
    let month_end = demo_file("month-end.sql")?;
    scene.command("Run SQL File…")?;
    scene.session.wait_for(DIALOG)?;
    scene.click_text("[role=\"dialog\"] button", "Choose File…")?;
    name_in_dialog("Open File", &month_end, true)?;
    scene.session.wait_for("section[aria-label=\"What the file holds\"]")?;
    scene.click_text("[role=\"dialog\"] label", "Go on, logging")?;
    let mut film = scene.film(None);
    film.frame(300)?;
    let area = scene.area(DIALOG)?;
    scene.click_exact("[role=\"dialog\"] .dialog-buttons button", "Run")?;
    scene.click_exact("[role=\"dialog\"] button", "Run File")?;
    film.frame(60)?;
    scene.session.wait_for("section[aria-label=\"What the run did\"]")?;
    film.frame(400)?;
    film.write("run-sql-file", Some(area))?;
    scene.escape()
}
