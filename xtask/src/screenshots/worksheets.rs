//! The scenes of the window and its worksheets (RULES.md D60): the
//! window of a query and its rows; a context menu; completion; the guard
//! rails before a DROP; the plan viewer; the history; a snippet and the
//! formatter; Explain Analyze of a data change; and the keys' scheme.

use crate::error::Result;
use crate::images::write_png;
use crate::screenshots::connections::DIALOG;
use crate::screenshots::scene::Scene;
use crate::webdriver::{DOWN, TAB};

/// The query the window, its plan and its completion show.
pub const QUERY: &str = "SELECT C.NAME, COUNT(*) AS ORDERS, SUM(O.TOTAL) AS TOTAL FROM CUSTOMERS C JOIN ORDERS O ON O.CUSTOMER_ID = C.ID GROUP BY C.NAME ORDER BY TOTAL DESC";

/// The window: the demo shop open, its catalog shown, a query and its rows.
pub fn window_scene(scene: &Scene<'_>) -> Result<()> {
    scene.run(QUERY, "Run Statement")?;
    scene.session.wait_for("[role=\"grid\"], .result-grid, canvas")?;
    scene.save("window")
}

/// Completion: a table's name begun, the list offered, the arrows moving
/// through it and Tab taking one; an animation of the editor alone.
pub fn completion_scene(scene: &Scene<'_>) -> Result<()> {
    scene.worksheet()?;
    let (x, y, w, h) = scene.rect(".worksheet-body")?;
    let mut film = scene.film(Some((x, y, w, h.min(260))));
    for word in ["SELECT ", "NAME ", "FROM ", "C", "U"] {
        scene.type_text(word)?;
        film.frame(40)?;
    }
    scene.session.wait_for(".cm-tooltip-autocomplete")?;
    film.frame(120)?;
    scene.session.press(&[], &[DOWN])?;
    film.frame(80)?;
    scene.session.press(&[], &[DOWN])?;
    film.frame(80)?;
    scene.session.press(&[], &[TAB])?;
    film.frame(250)?;
    film.write("completion", None)
}

/// The plan viewer: the query written, explained and analyzed, its plan
/// drawn; a picture of the window, and an animation.
pub fn plan_scene(scene: &Scene<'_>) -> Result<()> {
    scene.worksheet()?;
    scene.write(QUERY)?;
    let mut film = scene.film(None);
    film.frame(150)?;
    scene.tool("Explain Analyze")?;
    scene.session.wait_for("[aria-label=\"Summary of the plan\"]")?;
    film.frame(400)?;
    scene.save("plan-viewer")?;
    film.write("plan", None)
}

/// A context menu: a table's, in the explorer.
pub fn menu_scene(scene: &Scene<'_>) -> Result<()> {
    scene.open_rows(&["DEMO", "Tables", "ORDERS"])?;
    scene.session.script("window.studioMenu(window.studioRow('ORDERS'));")?;
    scene.session.wait_for("[role=\"menu\"] [role=\"menuitem\"]")?;
    scene.save("context-menu")?;
    scene.escape()
}

/// The guard rails: a DROP asked about before it runs.
pub fn guard_scene(scene: &Scene<'_>) -> Result<()> {
    scene.new_worksheet()?;
    scene.write("DROP TABLE ORDER_LINES CASCADE")?;
    scene.tool("Run Statement")?;
    scene.session.wait_for(DIALOG)?;
    scene.save("guard-drop")?;
    scene.escape()
}

/// The worksheet's editor, at most `tall` pixels of it, as it is now.
fn editor_part(scene: &Scene<'_>, tall: u32) -> Result<crate::images::Pixels> {
    let (x, y, w, h) = scene.area(".worksheet-body")?;
    Ok(crate::images::crop(&scene.shot()?, (x, y, w, h.min(tall))))
}

/// The history of the statements run, newest first.
pub fn history_scene(scene: &Scene<'_>) -> Result<()> {
    scene.command("History…")?;
    scene.session.wait_for("table[aria-label=\"History\"]")?;
    scene.save_part("history", DIALOG)?;
    scene.escape()
}

/// A snippet offered among the completions, its template shown; and a
/// statement as it was written and as Format writes it.
pub fn snippet_format_scene(scene: &Scene<'_>) -> Result<()> {
    scene.worksheet()?;
    scene.type_text("sel")?;
    scene.session.wait_for(".cm-tooltip-autocomplete")?;
    let chosen =
        "return document.querySelector('.cm-tooltip-autocomplete li[aria-selected=\"true\"] .cm-completionLabel')?.textContent === 'sel';";
    for _ in 0..12 {
        if scene.session.script(chosen)?.as_bool().unwrap_or(false) {
            break;
        }
        scene.session.press(&[], &[DOWN])?;
    }
    write_png(&editor_part(scene, 300)?, &scene.path("snippet", "png"))?;
    scene.worksheet()?;
    scene.write("select c.name, count(*) as n from customers c left join orders o on o.customer_id = c.id where o.total > 100 and c.city is not null group by c.name")?;
    let before = editor_part(scene, 120)?;
    scene.tool("Format")?;
    let after = editor_part(scene, 260)?;
    scene.save_stacked("format", &[before, after])
}

/// Explain Analyze of a data change: asked first, then analyzed and
/// rolled back, its plan shown; an animation of the window.
pub fn analyze_change_scene(scene: &Scene<'_>) -> Result<()> {
    scene.worksheet()?;
    scene.write("UPDATE ORDERS SET TOTAL = TOTAL * 1.1 WHERE CUSTOMER_ID = 3")?;
    let mut film = scene.film(None);
    film.frame(120)?;
    scene.tool("Explain Analyze")?;
    scene.session.wait_for(DIALOG)?;
    film.frame(250)?;
    scene.click_exact("[role=\"dialog\"] button", "Analyze, Then Roll Back")?;
    scene.session.wait_for("[aria-label=\"Summary of the plan\"]")?;
    film.frame(350)?;
    film.write("analyze-change", None)
}

/// Settings, Keys: the scheme of function keys chosen, each command's
/// key shown as it binds; the scheme set back after.
pub fn keys_scene(scene: &Scene<'_>) -> Result<()> {
    scene.command("Settings…")?;
    scene.session.wait_for(DIALOG)?;
    scene.click_text("[role=\"dialog\"] details.field-group > summary", "Keys")?;
    scene.choose("Scheme", "functionKeys")?;
    scene.session.script(
        "const s = [...document.querySelectorAll('[role=dialog] details.field-group > summary')].find((s) => s.textContent.includes('Keys')); s?.scrollIntoView({block: 'start'});",
    )?;
    scene.save_part("settings-keys", DIALOG)?;
    scene.choose("Scheme", "default")?;
    scene.escape()
}
