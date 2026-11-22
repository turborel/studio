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
/// in a worksheet of its own, `setup` run in another of the same
/// session first if any, once a warning of `rule` is drawn: a statement
/// a worksheet, as one written where another ran may be written beside it.
fn warned(scene: &Scene<'_>, (setup, sql): (Option<&str>, &str), rule: &str) -> Result<crate::images::Pixels> {
    if let Some(setup) = setup {
        scene.new_worksheet()?;
        scene.write(setup)?;
        scene.tool("Run Statement")?;
        std::thread::sleep(crate::screenshots::scene::SETTLE);
    }
    scene.new_worksheet()?;
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
    let recheck = warned(
        scene,
        (None, "SELECT ID FROM STORE_AREAS WHERE ST_INTERSECTS(AREA, ST_MAKEENVELOPE(100, 100, 160, 160)) = 1"),
        "PLAN-RECHECK",
    )?;
    let spill = warned(
        scene,
        (
            Some("SET MEMORY.WORK_BYTES = 65536"),
            "SELECT A.ID AS A_ID, B.ID AS B_ID, A.TOTAL + B.TOTAL AS PAIR FROM ORDERS A CROSS JOIN ORDERS B WHERE A.ID <= 120 ORDER BY PAIR DESC",
        ),
        "PLAN-SPILL",
    );
    // The work area as it was, for the scenes after.
    scene.new_worksheet()?;
    scene.write("SET MEMORY.WORK_BYTES = 268435456")?;
    scene.tool("Run Statement")?;
    scene.save_stacked("plan-warnings", &[spill?, recheck])
}

/// What if: a query read whole, its plan's SCAN-NO-INDEX finding asked
/// what an index of its column would do, the index made, the query
/// explained and the index dropped, the guards' question of the DROP
/// answered, and the two plans compared; an animation of the window.
pub fn plan_compare_scene(scene: &Scene<'_>) -> Result<()> {
    scene.new_worksheet()?;
    // An index is made outside a transaction: each statement its own.
    scene.autocommit(true)?;
    scene.write("SELECT ID, PLACED FROM ORDERS WHERE TOTAL = 46.95")?;
    let mut film = scene.film(None);
    scene.tool("Explain Analyze")?;
    if let Err(e) = scene.wait_text("ul[aria-label=\"Warnings\"]", "SCAN-NO-INDEX") {
        return crate::error::fail(format!("{e}; {}", scene.messages()));
    }
    film.frame(200)?;
    scene.click_text("ul[aria-label=\"Warnings\"] button", "What If")?;
    scene.session.wait_for(DIALOG)?;
    film.frame(150)?;
    scene.click_exact("[role=\"dialog\"] button", "Make, Explain and Drop")?;
    scene.click_shown("[role=\"dialog\"] button.danger")?;
    scene.session.wait_for(".plan-pair")?;
    film.frame(400)?;
    film.write("plan-compare", None)?;
    scene.autocommit(false)
}
