//! The scenes of results (RULES.md D60): the grid of a 38-digit value
//! with its first columns frozen; the record view; the selection's sums in
//! the status bar; Copy As; the JSON, XML, binary, spatial and graph
//! viewers; and two results compared.

use crate::error::Result;
use crate::screenshots::scene::{DOWN, F10, SHIFT, Scene};

/// The result shown, its toolbar, grid and bar.
const RESULT: &str = ".result";
/// The shown result's toolbar.
const TOOLS: &str = "[role=\"toolbar\"][aria-label=\"Result\"]";

/// The query of a ledger's key of 38 digits beside each order line.
const LEDGER: &str = "SELECT O.ID, C.NAME, C.CITY, O.PLACED, O.TOTAL, CAST('1234567890123456789012345678901234' || CAST(1000 + O.ID AS VARCHAR(4)) AS DECIMAL(38,0)) AS LEDGER_KEY, P.NAME AS PRODUCT, L.QUANTITY FROM ORDERS O JOIN CUSTOMERS C ON C.ID = O.CUSTOMER_ID JOIN ORDER_LINES L ON L.ORDER_ID = O.ID JOIN PRODUCTS P ON P.ID = L.PRODUCT_ID ORDER BY O.ID, L.LINE";

/// Opens the menu of the grid's cell at `column`, `row`, by Shift+F10.
fn cell_menu(scene: &Scene<'_>, column: u32, row: u32) -> Result<()> {
    scene.cell(column, row)?;
    scene.session.press(&[SHIFT], &[F10])?;
    scene.session.wait_for("[role=\"menu\"] [role=\"menuitem\"]")
}

/// The grid: a ledger's key of 38 digits, every digit kept, and the
/// first two columns frozen as it scrolls across.
pub fn grid_scene(scene: &Scene<'_>) -> Result<()> {
    scene.result(LEDGER, "Run Statement")?;
    cell_menu(scene, 2, 0)?;
    scene.click_text("[role=\"menu\"] [role=\"menuitem\"]", "Freeze Up to This Column")?;
    scene.wait_text(".result-bar", "frozen")?;
    scene.session.script(
        "const s = [...document.querySelectorAll('.result-grid .dvn-scroller')].find((e) => e.offsetParent !== null); if (s) { s.scrollLeft = 220; }",
    )?;
    scene.save_part("result-grid", RESULT)
}

/// The record view: a row, a column a line.
pub fn record_scene(scene: &Scene<'_>) -> Result<()> {
    scene.result(LEDGER, "Run Statement")?;
    scene.click_shown(&format!("{TOOLS} button[aria-label=\"Record View\"]"))?;
    scene.click_shown("button[aria-label=\"Next Row\"]")?;
    scene.click_shown("button[aria-label=\"Next Row\"]")?;
    scene.save_part("record-view", RESULT)?;
    scene.click_shown(&format!("{TOOLS} button[aria-label=\"Grid View\"]"))
}

/// The cells of a column selected, their count, sum, average, least and
/// greatest in the status bar.
pub fn aggregates_scene(scene: &Scene<'_>) -> Result<()> {
    scene.result("SELECT * FROM ORDERS", "Run Statement")?;
    scene.cell(4, 0)?;
    for _ in 0..5 {
        scene.session.press(&[SHIFT], &[DOWN])?;
    }
    scene.wait_text("footer.status-bar .status-cells", "Sum")?;
    scene.save_part("selection-sums", ".result, footer.status-bar")
}

/// Copy As: the cells selected, and the formats a cell's menu copies them in.
pub fn copy_scene(scene: &Scene<'_>) -> Result<()> {
    scene.result("SELECT ID, NAME, CITY FROM CUSTOMERS", "Run Statement")?;
    scene.cell(1, 0)?;
    for _ in 0..3 {
        scene.session.press(&[SHIFT], &[DOWN])?;
    }
    scene.session.press(&[SHIFT], &[F10])?;
    scene.click_text("[role=\"menu\"] [role=\"menuitem\"]", "Copy As")?;
    scene.session.wait_for("[role=\"menu\"][aria-label=\"Copy As\"]")?;
    scene.save_part("copy-as", ".result, [role=\"menu\"]")?;
    scene.escape()?;
    scene.escape()
}

/// The value viewer of the cell at `column` of `sql`'s first row, as `name`.
fn viewer(scene: &Scene<'_>, sql: &str, column: u32, name: &str) -> Result<()> {
    scene.result(sql, "Run Statement")?;
    cell_menu(scene, column, 0)?;
    scene.click_text("[role=\"menu\"] [role=\"menuitem\"]", "View Value")?;
    scene.session.wait_for("aside.result-viewer[aria-label=\"Value\"]")?;
    scene.save_part(name, RESULT)
}

/// The JSON, XML and binary values' viewers.
pub fn viewers_scene(scene: &Scene<'_>) -> Result<()> {
    viewer(
        scene,
        "SELECT ID, NAME, JSON('{\"customer\":\"Harbour Books\",\"city\":\"Lisbon\",\"lines\":[{\"product\":\"Notebook\",\"qty\":2},{\"product\":\"Fountain pen\",\"qty\":1}],\"paid\":true}') AS DOC FROM CUSTOMERS WHERE ID = 1",
        3,
        "viewer-json",
    )?;
    viewer(
        scene,
        "SELECT ID, XMLPARSE(DOCUMENT '<order no=\"17\"><customer>Harbour Books</customer><line product=\"Notebook\" qty=\"2\"/><line product=\"Fountain pen\" qty=\"1\"/></order>' STRIP WHITESPACE) AS BODY FROM CUSTOMERS WHERE ID = 1",
        2,
        "viewer-xml",
    )?;
    viewer(
        scene,
        "SELECT ID, X'4f7264657220313720666f7220486172626f757220426f6f6b732c204c6973626f6e3a2032206e6f7465626f6f6b732c203120666f756e7461696e2070656e2e0a' AS RECEIPT FROM CUSTOMERS WHERE ID = 1",
        2,
        "viewer-binary",
    )
}

/// Spatial values drawn on a plane: a shop's floor, its counter, door and shelf.
pub fn spatial_scene(scene: &Scene<'_>) -> Result<()> {
    scene.result(
        "SELECT * FROM (VALUES (1, 'Shop floor', ST_GEOMFROMTEXT('POLYGON ((0 0, 40 0, 40 25, 0 25, 0 0), (30 15, 38 15, 38 23, 30 23, 30 15))')), (2, 'Counter', ST_GEOMFROMTEXT('LINESTRING (5 5, 25 5)')), (3, 'Door', ST_POINT(20, 0)), (4, 'Shelf', ST_GEOMFROMTEXT('POLYGON ((2 18, 12 18, 12 22, 2 22, 2 18))'))) AS P (ID, NAME, SHAPE)",
        "Run Statement",
    )?;
    scene.click_shown(&format!("{TOOLS} button[aria-label=\"Plane View\"]"))?;
    scene.session.wait_for("figure.plane")?;
    scene.save_part("spatial", RESULT)
}

/// A graph: the paths of the shop's property graph from an order, through
/// a product, to the other orders of it.
pub fn graph_scene(scene: &Scene<'_>) -> Result<()> {
    scene.result(
        // Labels by IS, as a colon begins a worksheet's script variable.
        "SELECT * FROM GRAPH_TABLE (SHOP MATCH P = (A IS ORDERS WHERE A.ID = 1)-[X]->(B IS PRODUCTS)<-[Y]-(C IS ORDERS WHERE C.ID <= 12) COLUMNS (PATH_TO_JSON(P) AS PATH))",
        "Run Statement",
    )?;
    scene.click_shown(&format!("{TOOLS} button[aria-label=\"Graph View\"]"))?;
    scene.session.wait_for(".graph-view[role=\"figure\"]")?;
    scene.save_part("graph", RESULT)
}

/// Two results of a script compared, row by row.
pub fn compare_scene(scene: &Scene<'_>) -> Result<()> {
    scene
        .run("SELECT ID, NAME, PRICE FROM PRODUCTS WHERE PRICE < 30;\nSELECT ID, NAME, PRICE FROM PRODUCTS WHERE ID <= 4;", "Run Script")?;
    scene.wait_text("[role=\"tablist\"][aria-label=\"Results\"] [role=\"tab\"]", "Result 2")?;
    scene.choose("Compare with", "Result 1")?;
    scene.session.wait_for("table[aria-label=\"Comparison\"]")?;
    scene.save_part("result-compare", RESULT)
}
