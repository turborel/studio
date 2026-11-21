//! The real window's smoke test (RULES.md D49): the built application,
//! launched by tauri-driver under WebDriver, its toolbar and explorer
//! drawn, a new worksheet opened by the toolbar's button and its editor's
//! context menu opened (D53), no failure panel shown and none logged;
//! once from app data of none, and once from app data an earlier build
//! left, of a file that no longer fits, which is set aside and told. It runs where tauri-driver
//! and the platform's WebDriver run: Linux, under a display server.

use std::path::Path;

use crate::command::{root, say};
use crate::error::{Error, Result, fail};
use crate::webdriver::{Driver, Session, config};

/// The ports of each scenario's tauri-driver and of the platform's
/// WebDriver it starts: each scenario its own, as a WebDriver outlives
/// the tauri-driver that started it, and would launch the next
/// scenario's application of its own app data.
const PORTS: [(u16, u16); 2] = [(4444, 4445), (4454, 4455)];

/// A new worksheet opened by the toolbar's button, and its editor's context menu opened.
fn worksheet_and_menu(session: &Session<'_>) -> Result<()> {
    session.click("[role=\"toolbar\"][aria-label=\"Toolbar\"] button[aria-label=\"New Worksheet\"]")?;
    session.wait_for("[role=\"region\"][aria-label=\"Worksheet\"] .worksheet-body")?;
    session.script(
        "document.querySelector('.worksheet-body').dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: 120, clientY: 160}))",
    )?;
    session.wait_for("[role=\"menu\"] [role=\"menuitem\"]")?;
    let said = session.script("return document.querySelector('[role=menu]').textContent")?;
    if !said.as_str().is_some_and(|s| s.contains("Run Statement")) {
        return fail(format!("the editor's menu did not hold Run Statement: {said}"));
    }
    Ok(())
}

/// Runs the application of `home`: its window drawn, no failure shown or
/// logged, and, if `told` is some, a notice that holds it.
fn scenario(application: &Path, (home, ports): (&Path, (u16, u16)), told: Option<&str>) -> Result<()> {
    let driver = Driver::start(home, ports)?;
    let session = driver.session(application)?;
    session.wait_for("[role=\"toolbar\"]")?;
    session.wait_for("[aria-label=\"Object Explorer\"]")?;
    if session.found(".failure-panel")? {
        return fail("the window showed its failure panel");
    }
    if let Some(text) = told {
        session.wait_for(".notice-banner")?;
        let said = session.script("return document.querySelector('.notice-banner').textContent")?;
        if !said.as_str().is_some_and(|s| s.contains(text)) {
            return fail(format!("the notice did not tell {text}: {said}"));
        }
    }
    worksheet_and_menu(&session)?;
    drop(session);
    let log = config(home).join("failures.log");
    if let Ok(failures) = std::fs::read_to_string(&log) {
        return fail(format!("the window logged failures: {failures}"));
    }
    Ok(())
}
/// Copies the earlier build's app data of `xtask/smoke/earlier` into `home`.
fn earlier(home: &Path) -> Result<()> {
    let into = config(home);
    std::fs::create_dir_all(&into).map_err(|e| Error(format!("{}: {e}", into.display())))?;
    let from = root().join("xtask").join("smoke").join("earlier");
    for entry in std::fs::read_dir(&from).map_err(|e| Error(format!("{}: {e}", from.display())))?.flatten() {
        std::fs::copy(entry.path(), into.join(entry.file_name())).map_err(|e| Error(format!("{}: {e}", entry.path().display())))?;
    }
    Ok(())
}

/// The smoke test of the application at `application`: from no app data,
/// then from an earlier build's.
pub fn smoke(application: Option<&str>) -> Result<()> {
    let Some(application) = application else { return fail("usage: cargo xtask smoke <the built application>") };
    let application = std::fs::canonicalize(application).map_err(|e| Error(format!("{application}: {e}")))?;
    let homes = root().join("target").join("smoke");
    let _ = std::fs::remove_dir_all(&homes); // One of a run before is replaced.
    let empty = homes.join("empty");
    std::fs::create_dir_all(&empty).map_err(|e| Error(format!("{}: {e}", empty.display())))?;
    say("==> smoke: from no app data");
    let [first, second] = PORTS;
    scenario(&application, (&empty, first), None)?;
    let before = homes.join("earlier");
    earlier(&before)?;
    say("==> smoke: from an earlier build's app data");
    scenario(&application, (&before, second), Some("queries.json did not fit"))?;
    say("smoke: the window drew, and logged no failure");
    Ok(())
}
