//! This program run again as another process, holding a database as a
//! server or another program would: `CHILD` names what it does and the
//! directory, `hold:<dir>` to hold the database open until its input
//! ends, `crash:<dir>` to commit a row and wait to be killed, never
//! closing. Each says `ready` on its output once it holds the database.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdout, Command, ExitCode, Stdio};

use turborel_studio_core::embedded::open;

use crate::{OWNER, spec};

/// The variable that tells this program to run as the other process.
const CHILD: &str = "STUDIO_EMBEDDED_CHILD";

/// Runs as the other process, if `CHILD` says to: its exit code.
pub fn run_if_asked() -> Option<ExitCode> {
    let asked = std::env::var(CHILD).ok()?;
    let (what, dir) = asked.split_once(':')?;
    let held = open(&spec(Path::new(dir), false)).unwrap();
    if what == "crash" {
        let session = held.db.session(OWNER);
        session.run("INSERT INTO KEPT VALUES (2)").unwrap();
        session.commit().unwrap();
    }
    println!("ready");
    std::io::stdout().flush().unwrap();
    let mut rest = Vec::new();
    std::io::stdin().read_to_end(&mut rest).unwrap(); // Until the test ends the input, or kills this.
    held.close().unwrap();
    Some(ExitCode::SUCCESS)
}

/// The other process, holding the database in `dir` as `what` says, once
/// it says it is ready.
pub fn start(what: &str, dir: &Path) -> Child {
    let mut child = Command::new(std::env::current_exe().unwrap())
        .env(CHILD, format!("{what}:{}", dir.display()))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let out: ChildStdout = child.stdout.take().unwrap();
    let mut line = String::new();
    BufReader::new(out).read_line(&mut line).unwrap();
    assert_eq!(line.trim(), "ready", "the other process did not open the database");
    child
}
