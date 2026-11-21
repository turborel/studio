//! The real window's smoke test (RULES.md D49): the built application,
//! launched by tauri-driver under WebDriver, its toolbar and explorer
//! drawn, a new worksheet opened by the toolbar's button and its editor's
//! context menu opened (D53), no failure panel shown and none logged;
//! once from app data of none, and once from app data an earlier build
//! left, of a file that no longer fits, which is set aside and told. It runs where tauri-driver
//! and the platform's WebDriver run: Linux, under a display server.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use crate::command::{root, say};
use crate::error::{Error, Result, fail};

/// The port tauri-driver listens on.
const DRIVER: &str = "127.0.0.1:4444";
/// How long the window has to draw.
const DRAWN_WITHIN: Duration = Duration::from_secs(60);
/// The application's identifier, its folders' name.
const IDENTIFIER: &str = "com.turborel.studio";

/// A request to the driver: its answer's status and JSON.
fn request(method: &str, path: &str, body: Option<&serde_json::Value>) -> Result<(u16, serde_json::Value)> {
    let mut stream = TcpStream::connect(DRIVER).map_err(|e| Error(format!("tauri-driver: {e}")))?;
    let body = body.map(serde_json::Value::to_string).unwrap_or_default();
    let head = format!(
        "{method} {path} HTTP/1.1\r\nHost: {DRIVER}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes()).and_then(|()| stream.write_all(body.as_bytes())).map_err(|e| Error(format!("tauri-driver: {e}")))?;
    let mut reader = BufReader::new(stream);
    let mut status = String::new();
    reader.read_line(&mut status).map_err(|e| Error(format!("tauri-driver: {e}")))?;
    let code = status.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
    let mut rest = String::new();
    reader.read_to_string(&mut rest).map_err(|e| Error(format!("tauri-driver: {e}")))?;
    let json = rest.split_once("\r\n\r\n").map(|(_, b)| b).unwrap_or_default();
    let json = json.find('{').map_or("null", |at| json.get(at..).unwrap_or("null"));
    let value = serde_json::Deserializer::from_str(json).into_iter::<serde_json::Value>().next().and_then(std::result::Result::ok);
    Ok((code, value.unwrap_or(serde_json::Value::Null)))
}

/// Whether the page has an element `selector` finds.
fn found(session: &str, selector: &str) -> Result<bool> {
    let (code, _) =
        request("POST", &format!("/session/{session}/element"), Some(&serde_json::json!({"using": "css selector", "value": selector})))?;
    Ok(code == 200)
}

/// Clicks the element `selector` finds.
fn click(session: &str, selector: &str) -> Result<()> {
    let (code, found) =
        request("POST", &format!("/session/{session}/element"), Some(&serde_json::json!({"using": "css selector", "value": selector})))?;
    let element = found.pointer("/value").and_then(|v| v.as_object()).and_then(|o| o.values().next()).and_then(serde_json::Value::as_str);
    let Some(element) = element.filter(|_| code == 200) else { return fail(format!("no {selector} to click: {found}")) };
    let (code, answer) = request("POST", &format!("/session/{session}/element/{element}/click"), Some(&serde_json::json!({})))?;
    if code == 200 { Ok(()) } else { fail(format!("{selector} could not be clicked: {answer}")) }
}

/// Runs `script` in the page.
fn script(session: &str, script: &str) -> Result<serde_json::Value> {
    let (code, answer) =
        request("POST", &format!("/session/{session}/execute/sync"), Some(&serde_json::json!({"script": script, "args": []})))?;
    if code == 200 { Ok(answer) } else { fail(format!("the page's script failed: {answer}")) }
}

/// A new worksheet opened by the toolbar's button, and its editor's context menu opened.
fn worksheet_and_menu(session: &str) -> Result<()> {
    click(session, "[role=\"toolbar\"][aria-label=\"Toolbar\"] button[aria-label=\"New Worksheet\"]")?;
    wait_for(session, "[role=\"region\"][aria-label=\"Worksheet\"] .worksheet-body")?;
    script(
        session,
        "document.querySelector('.worksheet-body').dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: 120, clientY: 160}))",
    )?;
    wait_for(session, "[role=\"menu\"] [role=\"menuitem\"]")?;
    let said = script(session, "return document.querySelector('[role=menu]').textContent")?;
    if !said.pointer("/value").and_then(serde_json::Value::as_str).is_some_and(|s| s.contains("Run Statement")) {
        return fail(format!("the editor's menu did not hold Run Statement: {said}"));
    }
    Ok(())
}

/// Waits until the page has an element `selector` finds.
fn wait_for(session: &str, selector: &str) -> Result<()> {
    let start = Instant::now();
    while start.elapsed() < DRAWN_WITHIN {
        if found(session, selector)? {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    fail(format!("the window drew no {selector} within {} seconds", DRAWN_WITHIN.as_secs()))
}

/// tauri-driver, started with `home` as its home, so the application's
/// folders are under it; stopped as it is dropped.
struct Driver(Child);

impl Drop for Driver {
    fn drop(&mut self) {
        let _ = self.0.kill(); // A driver already gone needs no kill.
        let _ = self.0.wait();
    }
}

/// Starts tauri-driver of `home`, and waits for it to listen.
fn driver(home: &Path) -> Result<Driver> {
    let child = Command::new("tauri-driver")
        .env("HOME", home)
        .env_remove("XDG_CONFIG_HOME")
        .env_remove("XDG_CACHE_HOME")
        .env_remove("XDG_DATA_HOME")
        .stdout(Stdio::null())
        .spawn()
        .map_err(|e| Error(format!("cannot run tauri-driver: {e}")))?;
    let started = Driver(child);
    let start = Instant::now();
    while TcpStream::connect(DRIVER).is_err() {
        if start.elapsed() > Duration::from_secs(20) {
            return fail("tauri-driver did not listen");
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Ok(started)
}

/// The application's configuration folder of `home`, on Linux.
fn config(home: &Path) -> PathBuf {
    home.join(".config").join(IDENTIFIER)
}

/// Runs the application of `home`: its window drawn, no failure shown or
/// logged, and, if `told` is some, a notice that holds it.
fn scenario(application: &Path, home: &Path, told: Option<&str>) -> Result<()> {
    let _driver = driver(home)?;
    let capabilities = serde_json::json!({"capabilities": {"alwaysMatch": {"tauri:options": {"application": application}}}});
    let (code, answer) = request("POST", "/session", Some(&capabilities))?;
    let session = answer.pointer("/value/sessionId").and_then(serde_json::Value::as_str).map(str::to_owned);
    let Some(session) = session.filter(|_| code == 200) else { return fail(format!("no WebDriver session: {answer}")) };
    let checked = (|| {
        wait_for(&session, "[role=\"toolbar\"]")?;
        wait_for(&session, "[aria-label=\"Object Explorer\"]")?;
        if found(&session, ".failure-panel")? {
            return fail("the window showed its failure panel");
        }
        if let Some(text) = told {
            wait_for(&session, ".notice-banner")?;
            let said = script(&session, "return document.querySelector('.notice-banner').textContent")?;
            if !said.pointer("/value").and_then(serde_json::Value::as_str).is_some_and(|s| s.contains(text)) {
                return fail(format!("the notice did not tell {text}: {said}"));
            }
        }
        worksheet_and_menu(&session)
    })();
    let _ = request("DELETE", &format!("/session/{session}"), None); // The driver ends with it.
    checked?;
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
    scenario(&application, &empty, None)?;
    let before = homes.join("earlier");
    earlier(&before)?;
    say("==> smoke: from an earlier build's app data");
    scenario(&application, &before, Some("queries.json did not fit"))?;
    say("smoke: the window drew, and logged no failure");
    Ok(())
}
