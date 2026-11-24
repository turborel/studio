//! The scene of the routine debugger (RULES.md D60, D73): the demo's
//! procedure RAISE_PRICES debugged, a breakpoint set at its UPDATE, its
//! CALL run in a worksheet and paused there, its call stack and values
//! drawn, stepped over and let go on; the CALL rolled back after, so the
//! prices the other scenes show stay as they were.

use crate::error::Result;
use crate::screenshots::scene::Scene;

/// The debugger's panel.
const PANEL: &str = "[role=\"region\"][aria-label=\"Debugger\"]";
/// What the debugger last said.
const TOLD: &str = ".debug-told";

/// Clicks the debugger's tool `name`.
fn tool(scene: &Scene<'_>, name: &str) -> Result<()> {
    scene.click_shown(&format!("[role=\"toolbar\"][aria-label=\"Debugger\"] button[aria-label=\"{name}\"]"))
}

/// The debugger: RAISE_PRICES's Debug…, a breakpoint at line 4, its CALL
/// paused there, a picture of the panel; then a step over, a picture, and
/// the CALL let go on and rolled back.
pub fn debugger_scene(scene: &Scene<'_>) -> Result<()> {
    scene.open_rows(&["DEMO", "Routines", "RAISE_PRICES"])?;
    scene.session.script("window.studioMenu(window.studioRow('RAISE_PRICES'));")?;
    scene.click_text("[role=\"menu\"] [role=\"menuitem\"]", "Debug…")?;
    scene.session.wait_for("[aria-label=\"Routine text\"]")?;
    scene.widen_right(420)?;
    scene.click_shown("button[aria-label=\"Breakpoint at line 4\"]")?;
    scene.wait_text(TOLD, "Breakpoint")?;
    scene.new_worksheet()?;
    scene.write("CALL RAISE_PRICES(10)")?;
    scene.tool("Run Statement")?;
    if let Err(e) = scene.wait_text(TOLD, "Paused at breakpoint") {
        return crate::error::fail(format!("{e}; {}", scene.messages()));
    }
    scene.save_part("debugger-paused", PANEL)?;
    tool(scene, "Step Over")?;
    scene.wait_text(TOLD, "Paused.")?;
    scene.save_part("debugger-stepped", PANEL)?;
    tool(scene, "Continue")?;
    tool(scene, "Stop Debugging")?;
    scene.new_worksheet()?;
    scene.write("ROLLBACK")?;
    scene.tool("Run Statement")?;
    scene.reset_layout()
}
