//! The scenes of the analyzer (RULES.md D60): a schema's findings and
//! their fixes; its top statements; its tables' and indexes' use and
//! sizes; a built-in report's chart; the plan's warnings of a spill and
//! of an index that decides little; and a plan compared before and after
//! an index is made.

use crate::error::Result;
use crate::screenshots::connections::DIALOG;
use crate::screenshots::scene::Scene;

/// The analyzer's findings, its top statements and its use and sizes.
pub fn analyzer_scene(scene: &Scene<'_>) -> Result<()> {
    scene.command("Analyze Schema…")?;
    scene.session.wait_for("ul[aria-label=\"Findings\"]")?;
    scene.wait_text("ul[aria-label=\"Findings\"]", "PRODUCT_ID")?;
    scene.save_part("analyzer-findings", DIALOG)?;
    scene.click_text("[role=\"dialog\"] [role=\"tab\"]", "Top Statements")?;
    scene.session.wait_for("table[aria-label=\"Top statements by total time\"]")?;
    scene.save_part("analyzer-top-statements", DIALOG)?;
    scene.click_text("[role=\"dialog\"] [role=\"tab\"]", "Usage and Sizes")?;
    scene.session.wait_for("table[aria-label=\"Table sizes\"]")?;
    scene.save_part("analyzer-usage", DIALOG)?;
    scene.escape()
}

/// A built-in report: the database's files, their reads, writes and
/// syncs by kind, drawn as bars.
pub fn report_scene(scene: &Scene<'_>) -> Result<()> {
    scene.click_text("details.explorer-section > summary", "Reports")?;
    scene.click_text("ul[aria-label=\"Built-in reports\"] button", "Files")?;
    scene.session.wait_for("svg.chart[role=\"img\"]")?;
    scene.editor_share(20)?;
    scene.save_part("report-chart", ".result")?;
    scene.explorer_section("Reports", false)
}

/// The plan's summary and warnings, as `sql` is explained and analyzed
/// in a worksheet of its own, `setup` run in it first if any, once a
/// warning of `rule` is drawn.
fn warned(scene: &Scene<'_>, (setup, sql): (Option<&str>, &str), rule: &str) -> Result<crate::images::Pixels> {
    scene.new_worksheet()?;
    if let Some(setup) = setup {
        scene.write(setup)?;
        scene.tool("Run Statement")?;
        std::thread::sleep(crate::screenshots::scene::SETTLE);
        scene.worksheet()?;
    }
    scene.write(sql)?;
    scene.tool("Explain Analyze")?;
    if let Err(e) = scene.wait_text("ul[aria-label=\"Warnings\"]", rule) {
        return crate::error::fail(format!("{e}; {}", scene.messages()));
    }
    scene.part("section[aria-label=\"Summary of the plan\"], ul[aria-label=\"Warnings\"]")
}

/// The plan's warnings: a sort that spilled past a small work area, and
/// a spatial index whose entries are each judged again.
pub fn warnings_scene(scene: &Scene<'_>) -> Result<()> {
    let spill = warned(
        scene,
        (
            Some("SET MEMORY.WORK_BYTES = 65536"),
            "SELECT A.ID AS A_ID, B.ID AS B_ID, A.TOTAL + B.TOTAL AS PAIR FROM ORDERS A CROSS JOIN ORDERS B ORDER BY PAIR DESC",
        ),
        "PLAN-SPILL",
    );
    let recheck = warned(
        scene,
        (
            Some("SET MEMORY.WORK_BYTES = 268435456"),
            "SELECT ID FROM STORE_AREAS WHERE ST_INTERSECTS(AREA, ST_MAKEENVELOPE(100, 100, 160, 160)) = 1",
        ),
        "PLAN-RECHECK",
    )?;
    scene.save_stacked("plan-warnings", &[spill?, recheck])
}

/// A query's plan before an index and after it, compared; an animation
/// of the window. The index is dropped after, the guard's question
/// answered.
pub fn plan_compare_scene(scene: &Scene<'_>) -> Result<()> {
    let query = "SELECT ID, PLACED FROM ORDERS WHERE TOTAL = 46.95";
    // An index is made outside a transaction: the session's is ended first.
    scene.new_worksheet()?;
    scene.write("ROLLBACK")?;
    scene.tool("Run Statement")?;
    let mut film = scene.film(None);
    scene.run(query, "Explain Analyze")?;
    scene.session.wait_for("[aria-label=\"Summary of the plan\"]")?;
    film.frame(200)?;
    // The transaction the plan began ended, as an index is made outside one.
    scene.run("ROLLBACK", "Run Statement")?;
    scene.run("CREATE INDEX ORDERS_BY_TOTAL ON ORDERS (TOTAL)", "Run Statement")?;
    film.frame(150)?;
    scene.run(query, "Explain Analyze")?;
    scene.wait_text(".plan-viewer", "ORDERS_BY_TOTAL")?;
    film.frame(150)?;
    scene.click_text("[role=\"toolbar\"][aria-label=\"Plan\"] label", "Compare with the plan before")?;
    scene.session.wait_for(".plan-pair")?;
    film.frame(400)?;
    film.write("plan-compare", None)?;
    scene.run("DROP INDEX ORDERS_BY_TOTAL", "Run Statement")?;
    scene.click_shown("[role=\"dialog\"] button.danger")
}
