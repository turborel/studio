//! The scenes of administration (RULES.md D60): users, roles and a
//! table's privileges, of the demo database; and, of the demo server, the
//! monitor: a session waiting on another's lock, the statements, the
//! tables and indexes, a setting changed, replication, and the plug-ins.

use crate::error::Result;
use crate::screenshots::connections::DIALOG;
use crate::screenshots::scene::Scene;

/// The monitor.
#[cfg(unix)]
const MONITOR: &str = "[role=\"region\"][aria-label=\"Monitor\"]";

/// Users and roles in the explorer, a user's menu; and a table's
/// privileges granted to a role.
pub fn users_scene(scene: &Scene<'_>) -> Result<()> {
    scene.open_rows(&["Users and Roles", "ANN"])?;
    scene.wait_row("AUDITORS")?;
    scene.session.script("window.studioMenu(window.studioRow('ANN'));")?;
    scene.session.wait_for("[role=\"menu\"] [role=\"menuitem\"]")?;
    scene.save_part("users-roles", ".catalog, [role=\"menu\"]")?;
    scene.escape()?;
    scene.row_menu("ORDERS", &["Privileges…"])?;
    scene.session.wait_for(DIALOG)?;
    scene.tick("SELECT")?;
    scene.fill("To or from", "AUDITORS")?;
    scene.save_part("privileges", DIALOG)?;
    scene.escape()
}

/// Clicks the monitor's tab `tab`, and waits for `shown` in it.
#[cfg(unix)]
fn monitor_tab(scene: &Scene<'_>, tab: &str, shown: &str) -> Result<()> {
    scene.click_text(&format!("{MONITOR} [role=\"tab\"]"), tab)?;
    scene.session.wait_for(&format!("{MONITOR} {shown}"))
}

/// The monitor of the demo server: a session waiting on a lock another
/// holds, the statements, the tables and indexes, a setting being changed
/// and replication; and the plug-ins of the demo database.
#[cfg(unix)]
pub fn monitor_scene(scene: &Scene<'_>) -> Result<()> {
    let Some(server) = scene.server else { return crate::error::fail("no demo server runs: TURBOREL_TEST_SERVER names none") };
    let mut holder = server.connect("DEMO")?;
    holder.set_autocommit(false);
    holder
        .query("UPDATE DEMO.CUSTOMERS SET CITY = CITY WHERE ID = 1")
        .map_err(|e| crate::error::Error(format!("the lock's holder: {e}")))?;
    let mut waiter = server.connect("DEMO")?;
    let waiting = std::thread::Builder::new()
        .name("screenshots-waiter".to_owned())
        .spawn(move || waiter.query("UPDATE DEMO.CUSTOMERS SET CITY = CITY WHERE ID = 1").map(drop))
        .map_err(|e| crate::error::Error(format!("the waiter: {e}")))?;
    let shown = monitor_shots(scene);
    let _ = holder.query("ROLLBACK"); // The waiter goes on, and the scene's own failure is the one told.
    let _ = waiting.join();
    shown
}

/// The monitor's pictures, of the demo server and then the demo database.
#[cfg(unix)]
fn monitor_shots(scene: &Scene<'_>) -> Result<()> {
    let server = crate::screenshots::connections::SERVER_NAME;
    scene.session.click(&format!("button[aria-label=\"Connect to {server}\"]"))?;
    scene.wait_text("footer.status-bar", server)?;
    scene.command("Monitor")?;
    scene.click_text(&format!("{MONITOR} .monitor-head button"), "Refresh")?;
    scene.wait_text(&format!("{MONITOR} ul[aria-label=\"Waits\"]"), "waits on a lock")?;
    scene.save_part("monitor-sessions", MONITOR)?;
    monitor_tab(scene, "Statements", "table[aria-label=\"Statements\"]")?;
    scene.save_part("monitor-statements", MONITOR)?;
    monitor_tab(scene, "Tables and Indexes", "section[aria-label=\"Indexes\"]")?;
    scene.save_part("monitor-tables", MONITOR)?;
    monitor_tab(scene, "Settings", "table[aria-label=\"Settings\"]")?;
    scene.fill("Filter the settings", "LOCKS")?;
    scene.click_text("table[aria-label=\"Settings\"] button", "Change…")?;
    scene.session.wait_for("fieldset.monitor-setting")?;
    scene.save_part("monitor-settings", MONITOR)?;
    monitor_tab(scene, "Replication", "p")?;
    scene.save_part("monitor-replication", MONITOR)?;
    scene.click_text("[aria-label=\"Open connections\"] button.tree-name", crate::screenshots::connections::DEMO_NAME)?;
    monitor_tab(scene, "Plug-ins", "table[aria-label=\"Plug-ins\"]")?;
    scene.save_part("monitor-plugins", MONITOR)?;
    scene.session.click(&format!("button[aria-label=\"Disconnect {server}\"]"))
}
