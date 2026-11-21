//! The scenes of modeling (RULES.md D60): the ER diagram of the demo
//! shop's schema, and its SVG as Studio's own Export as SVG writes it;
//! the query builder; a schema compared with its staging copy; and a DDL
//! script imported into a model.

use crate::error::{Result, fail};
use crate::screenshots::connections::DIALOG;
use crate::screenshots::scene::{SETTLE, Scene, demo_file, name_in_dialog};

/// The ER diagram: the schema's model, and, of the light theme, its SVG,
/// as Studio's own Export as SVG writes it.
pub fn diagram_scene(scene: &Scene<'_>) -> Result<()> {
    scene.select_row("DEMO")?;
    scene.session.wait_for("[aria-label=\"Schema actions\"]")?;
    scene.click_text("[aria-label=\"Schema actions\"] button", "Open Model")?;
    // The model opens in a tab of its own, shown as it opens.
    scene.session.wait_for(".react-flow__node")?;
    scene.save("er-diagram")?;
    if scene.theme != "light" {
        return Ok(());
    }
    // Studio's own Export as SVG, its file named in the platform's save
    // dialog as a person names it, by keys typed into the dialog.
    let file = scene.out.join("er-diagram.svg");
    let _ = std::fs::remove_file(&file); // One of a run before is made again.
    scene.session.click("button[aria-label=\"Export as SVG…\"]")?;
    name_in_dialog("Save", &file, false)?;
    for _ in 0..20 {
        if file.is_file() {
            return Ok(());
        }
        std::thread::sleep(SETTLE);
    }
    fail(format!("the diagram was not exported to {}", file.display()))
}

/// The visual query builder: the orders and their customers joined by
/// their foreign key, columns chosen and a total summed, its SQL written.
pub fn builder_scene(scene: &Scene<'_>) -> Result<()> {
    scene.command("Query Builder…")?;
    scene.session.wait_for(DIALOG)?;
    for table in ["ORDERS", "CUSTOMERS"] {
        scene.choose("Table", table)?;
        scene.button("Add Table")?;
    }
    scene.session.wait_for("ul[aria-label=\"Joins\"]")?;
    scene.click_text("fieldset.builder-table label", "NAME")?;
    scene.click_text("fieldset.builder-table label", "TOTAL")?;
    scene.choose("Aggregate of O1.TOTAL", "SUM")?;
    scene.wait_text("pre[aria-label=\"Query\"]", "SUM")?;
    scene.save_part("query-builder", DIALOG)?;
    scene.escape()
}

/// The demo shop's schema compared with its staging copy, the differences
/// and the script that makes the copy match.
pub fn schema_compare_scene(scene: &Scene<'_>) -> Result<()> {
    scene.select_row("DEMO")?;
    scene.click_text("[aria-label=\"Schema actions\"] button", "Compare Schema…")?;
    scene.session.wait_for(DIALOG)?;
    scene.choose("Schema", "STAGING")?;
    scene.click_exact("[role=\"dialog\"] .dialog-buttons button", "Compare")?;
    scene.session.wait_for("ul[aria-label=\"Differences\"]")?;
    let differences = scene.part(DIALOG)?;
    scene.click_text("[role=\"dialog\"] .dialog-buttons button", "Open Script in Worksheet")?;
    scene.wait_text(".worksheet-body .cm-content", "ALTER")?;
    let script = scene.part(".worksheet-body")?;
    scene.save_stacked("schema-compare", &[differences, script])
}

/// Import DDL into Model: a script of the shop as a team designs it next,
/// read into a model, a view and an INSERT left out and told.
pub fn import_ddl_scene(scene: &Scene<'_>) -> Result<()> {
    let file = demo_file("shop.sql")?;
    scene.command("Import DDL into Model…")?;
    name_in_dialog("Open File", &file, true)?;
    scene.session.wait_for("[role=\"dialog\"] form input")?;
    scene.session.script("const i = document.querySelector('[role=dialog] form input'); i.focus(); i.select();")?;
    scene.session.type_into("[role=\"dialog\"] form input", "DEMO")?;
    scene.click_shown("[role=\"dialog\"] button[type=\"submit\"]")?;
    scene.session.wait_for("section[aria-label=\"Left out of the model\"]")?;
    scene.save_part("import-ddl", ".model-view")
}
