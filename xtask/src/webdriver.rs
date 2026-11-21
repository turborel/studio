//! The real window driven under WebDriver (RULES.md D49): tauri-driver
//! started with a home of its own, a session of the built application,
//! and what a test or the screenshots ask of it. The one harness of the
//! window's own tests, which the smoke test and the screenshots share
//! (R-TEST-7). tauri-driver and the platform's WebDriver run on Linux,
//! under a display server.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use crate::error::{Error, Result, fail};

/// How long the window has to draw what is waited for.
pub const DRAWN_WITHIN: Duration = Duration::from_secs(60);
/// The application's identifier, its folders' name.
const IDENTIFIER: &str = "com.turborel.studio";
/// The key WebDriver names Tab by [WebDriver §17.4.2].
pub const TAB: &str = "\u{E004}";
/// The key WebDriver names Arrow Down by.
pub const DOWN: &str = "\u{E015}";
/// The key WebDriver names Control by.
pub const CONTROL: &str = "\u{E009}";
/// The key WebDriver names Escape by.
pub const ESCAPE: &str = "\u{E00C}";
/// The key WebDriver names Backspace by.
pub const BACKSPACE: &str = "\u{E003}";

/// tauri-driver, listening on a port, started with a home of its own, so
/// the application's folders are under it; stopped as it is dropped.
pub struct Driver {
    child: Child,
    port: u16,
}

impl Drop for Driver {
    fn drop(&mut self) {
        let _ = self.child.kill(); // A driver already gone needs no kill.
        let _ = self.child.wait();
    }
}

/// The application's configuration folder of `home`, on Linux.
pub fn config(home: &Path) -> PathBuf {
    home.join(".config").join(IDENTIFIER)
}

impl Driver {
    /// Starts tauri-driver of `home` on `port`, its platform's WebDriver on
    /// `native`, and waits for it to listen. Each run its own ports, as a
    /// WebDriver outlives the tauri-driver that started it.
    pub fn start(home: &Path, (port, native): (u16, u16)) -> Result<Driver> {
        let child = Command::new("tauri-driver")
            .args(["--port", &port.to_string(), "--native-port", &native.to_string()])
            .env("HOME", home)
            .env_remove("XDG_CONFIG_HOME")
            .env_remove("XDG_CACHE_HOME")
            .env_remove("XDG_DATA_HOME")
            .stdout(Stdio::null())
            .spawn()
            .map_err(|e| Error(format!("cannot run tauri-driver: {e}")))?;
        let driver = Driver { child, port };
        let start = Instant::now();
        while TcpStream::connect(driver.address()).is_err() {
            if start.elapsed() > Duration::from_secs(20) {
                return fail("tauri-driver did not listen");
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        Ok(driver)
    }

    /// The driver's address.
    fn address(&self) -> String {
        format!("127.0.0.1:{}", self.port)
    }

    /// A request to the driver: its answer's status and JSON.
    fn request(&self, method: &str, path: &str, body: Option<&serde_json::Value>) -> Result<(u16, serde_json::Value)> {
        let driver = self.address();
        let mut stream = TcpStream::connect(&driver).map_err(|e| Error(format!("tauri-driver: {e}")))?;
        let body = body.map(serde_json::Value::to_string).unwrap_or_default();
        let head = format!(
            "{method} {path} HTTP/1.1\r\nHost: {driver}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream
            .write_all(head.as_bytes())
            .and_then(|()| stream.write_all(body.as_bytes()))
            .map_err(|e| Error(format!("tauri-driver: {e}")))?;
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

    /// A session of the application at `application`, begun with `args`.
    pub fn session(&self, application: &Path, args: &[&str]) -> Result<Session<'_>> {
        let capabilities =
            serde_json::json!({"capabilities": {"alwaysMatch": {"tauri:options": {"application": application, "args": args}}}});
        let (code, answer) = self.request("POST", "/session", Some(&capabilities))?;
        let id = answer.pointer("/value/sessionId").and_then(serde_json::Value::as_str).map(str::to_owned);
        let Some(id) = id.filter(|_| code == 200) else { return fail(format!("no WebDriver session: {answer}")) };
        Ok(Session { driver: self, id })
    }
}

/// A session of the application, ended as it is dropped.
pub struct Session<'d> {
    driver: &'d Driver,
    id: String,
}

impl Drop for Session<'_> {
    fn drop(&mut self) {
        let _ = self.driver.request("DELETE", &format!("/session/{}", self.id), None); // The window ends with it.
    }
}

impl Session<'_> {
    /// A request of the session's, at `path` below it.
    fn ask(&self, method: &str, path: &str, body: Option<&serde_json::Value>) -> Result<(u16, serde_json::Value)> {
        self.driver.request(method, &format!("/session/{}{path}", self.id), body)
    }

    /// The element `selector` finds, if one does.
    fn element(&self, selector: &str) -> Result<Option<String>> {
        let (code, found) = self.ask("POST", "/element", Some(&serde_json::json!({"using": "css selector", "value": selector})))?;
        let element =
            found.pointer("/value").and_then(|v| v.as_object()).and_then(|o| o.values().next()).and_then(serde_json::Value::as_str);
        Ok(element.filter(|_| code == 200).map(str::to_owned))
    }

    /// Whether the page has an element `selector` finds.
    pub fn found(&self, selector: &str) -> Result<bool> {
        Ok(self.element(selector)?.is_some())
    }

    /// Clicks the element `selector` finds, once the window draws it: what
    /// it shows told if it never does.
    pub fn click(&self, selector: &str) -> Result<()> {
        self.wait_for(selector)?;
        let Some(element) = self.element(selector)? else { return fail(format!("no {selector} to click")) };
        let (code, answer) = self.ask("POST", &format!("/element/{element}/click"), Some(&serde_json::json!({})))?;
        if code == 200 { Ok(()) } else { fail(format!("{selector} could not be clicked: {answer}")) }
    }

    /// Types `text` into the element `selector` finds, WebDriver's keys among it.
    pub fn type_into(&self, selector: &str, text: &str) -> Result<()> {
        let Some(element) = self.element(selector)? else { return fail(format!("no {selector} to type into")) };
        let (code, answer) = self.ask("POST", &format!("/element/{element}/value"), Some(&serde_json::json!({"text": text})))?;
        if code == 200 { Ok(()) } else { fail(format!("{selector} took no keys: {answer}")) }
    }

    /// Presses `keys` in turn, each down then up, with `held` held down
    /// through them all, as Control and Shift are for a shortcut.
    pub fn press(&self, held: &[&str], keys: &[&str]) -> Result<()> {
        let mut actions = Vec::new();
        for h in held {
            actions.push(serde_json::json!({"type": "keyDown", "value": h}));
        }
        for key in keys {
            actions.push(serde_json::json!({"type": "keyDown", "value": key}));
            actions.push(serde_json::json!({"type": "keyUp", "value": key}));
        }
        for h in held.iter().rev() {
            actions.push(serde_json::json!({"type": "keyUp", "value": h}));
        }
        let body = serde_json::json!({"actions": [{"type": "key", "id": "keyboard", "actions": actions}]});
        let (code, answer) = self.ask("POST", "/actions", Some(&body))?;
        if code == 200 { Ok(()) } else { fail(format!("the keys were not pressed: {answer}")) }
    }

    /// Runs `script` in the page: what it returns.
    pub fn script(&self, script: &str) -> Result<serde_json::Value> {
        let (code, answer) = self.ask("POST", "/execute/sync", Some(&serde_json::json!({"script": script, "args": []})))?;
        if code == 200 {
            Ok(answer.pointer("/value").cloned().unwrap_or_default())
        } else {
            fail(format!("the page's script failed: {answer}"))
        }
    }

    /// Waits until the page has an element `selector` finds.
    pub fn wait_for(&self, selector: &str) -> Result<()> {
        let start = Instant::now();
        while start.elapsed() < DRAWN_WITHIN {
            if self.found(selector)? {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        let shown = self.script("return document.body.innerText.slice(0, 600)").map(|v| v.to_string()).unwrap_or_default();
        fail(format!("the window drew no {selector} within {} seconds; it showed: {shown}", DRAWN_WITHIN.as_secs()))
    }

    /// Makes the window `width` by `height` pixels.
    pub fn size(&self, (width, height): (u32, u32)) -> Result<()> {
        let (code, answer) =
            self.ask("POST", "/window/rect", Some(&serde_json::json!({"width": width, "height": height, "x": 0, "y": 0})))?;
        if code == 200 { Ok(()) } else { fail(format!("the window was not sized: {answer}")) }
    }

    /// The window's screenshot, a PNG image.
    pub fn screenshot(&self) -> Result<Vec<u8>> {
        let (code, answer) = self.ask("GET", "/screenshot", None)?;
        let text = answer.pointer("/value").and_then(serde_json::Value::as_str).filter(|_| code == 200);
        let Some(text) = text else { return fail(format!("no screenshot: {answer}")) };
        crate::images::from_base64(text)
    }
}
