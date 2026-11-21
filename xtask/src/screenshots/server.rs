//! The screenshots' server (RULES.md D60): the `turboreld` that
//! `TURBOREL_TEST_SERVER` names, a program's path or `docker:` and an
//! image, as the live tests' is (R-TEST-8), started for the scenes that
//! show a server: on a port of its own, 17450, and a Unix socket in a
//! directory of its own, SERVER.TRUST_LOCAL on, so the demo user, its
//! owner, connects by the socket with no password, and no secret is ever
//! made or kept. The demo shop's statements make its data, as they make
//! the embedded database's; stopped after, its own process alone waited
//! on.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use turborel_client::connection::{Connection, connect_local};
use turborel_client::mechanism::Trust;

use crate::error::{Error, Result, fail};

/// The variable that names the server; unset, the scenes of a server are
/// told and skipped.
pub const SERVER_VARIABLE: &str = "TURBOREL_TEST_SERVER";
/// The screenshots' own port, apart from the live tests'.
const PORT: u16 = 17450;
/// A server named by its image begins so.
const DOCKER: &str = "docker:";
/// The line the server writes once it listens.
const LISTENING: &str = "turboreld: listening at";
/// How long the server has to listen.
const START_WITHIN: Duration = Duration::from_secs(120);

/// The demo server, running.
pub struct DemoServer {
    /// Its Unix socket, which Studio's saved connection names.
    pub socket: PathBuf,
    child: Child,
    container: Option<String>,
}

impl DemoServer {
    /// The server `spec` names, started in `dir`, its owner `user` and its
    /// other users `others`.
    ///
    /// # Errors
    ///
    /// The server cannot be started, or says not that it listens.
    pub fn start(spec: &str, dir: &Path, (user, others): (&str, &[&str])) -> Result<DemoServer> {
        std::fs::create_dir_all(dir).map_err(|e| Error(format!("{}: {e}", dir.display())))?;
        // A path a container can follow too: none of its parts `..`.
        let dir = dir.canonicalize().map_err(|e| Error(format!("{}: {e}", dir.display())))?;
        let socket = dir.join("s.sock");
        let data = dir.join("data").display().to_string();
        let container = spec.strip_prefix(DOCKER).map(|_| format!("studio-screenshots-{}", std::process::id()));
        for (name, owner) in std::iter::once((user, true)).chain(others.iter().map(|o| (*o, false))) {
            let mut args = vec!["--dir", &data, "user", "add", name];
            if owner {
                args.push("--owner");
            }
            add_user(command(spec, container.as_deref(), &dir, &args), name)?;
        }
        let mut args = vec!["--dir".to_owned(), data];
        for setting in [format!("SERVER.PORT={PORT}"), "SERVER.TRUST_LOCAL=ON".to_owned(), format!("SERVER.SOCKET={}", socket.display())] {
            args.push("--set".to_owned());
            args.push(setting);
        }
        let mut serve = command(spec, container.as_deref(), &dir, &args.iter().map(String::as_str).collect::<Vec<_>>());
        serve.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
        let mut child = serve.spawn().map_err(|e| Error(format!("cannot run {spec}: {e}")))?;
        let server = DemoServer {
            socket,
            child: {
                wait_listening(&mut child)?;
                child
            },
            container,
        };
        Ok(server)
    }

    /// A connection of `user`'s, by the socket.
    ///
    /// # Errors
    ///
    /// The server's refusal.
    pub fn connect(&self, user: &str) -> Result<Connection<UnixStream>> {
        connect_local(&self.socket, user, &mut Trust).map_err(|e| Error(format!("the demo server: {e}")))
    }

    /// Runs each of `statements` on a connection of `user`'s, each its own
    /// transaction.
    ///
    /// # Errors
    ///
    /// The first statement the server refuses.
    pub fn seed(&self, user: &str, statements: &[String]) -> Result<()> {
        let mut connection = self.connect(user)?;
        connection.set_autocommit(true);
        for sql in statements {
            connection.query(sql).map_err(|e| Error(format!("the demo server, at {sql}: {e}")))?;
        }
        Ok(())
    }

    /// Stops the server, and waits for its process alone.
    pub fn stop(mut self) {
        if let Some(name) = &self.container {
            let _ = Command::new("docker").args(["stop", name]).output(); // A container gone needs no stop.
        }
        let _ = self.child.kill(); // A process already ended needs no kill.
        let _ = self.child.wait();
    }
}

/// Runs `add`, which makes the user `name`, a password typed as it asks
/// for one, which the socket's trust never asks for.
fn add_user(mut add: Command, name: &str) -> Result<()> {
    add.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut made = add.spawn().map_err(|e| Error(format!("cannot make the demo server's user {name}: {e}")))?;
    if let Some(stdin) = made.stdin.as_mut() {
        stdin.write_all(b"never asked for\n").map_err(|e| Error(format!("the demo server's user {name}: {e}")))?;
    }
    let out = made.wait_with_output().map_err(|e| Error(format!("the demo server's user {name}: {e}")))?;
    if out.status.success() { Ok(()) } else { fail(format!("the demo server's user {name}: {}", String::from_utf8_lossy(&out.stderr))) }
}

/// The command of `spec`, a program or an image, with `args`, in `dir`.
fn command(spec: &str, container: Option<&str>, dir: &Path, args: &[&str]) -> Command {
    if let (Some(image), Some(name)) = (spec.strip_prefix(DOCKER), container) {
        let mut command = Command::new("docker");
        let mount = format!("{0}:{0}", dir.display());
        command.args(["run", "--rm", "-i", "--network", "host", "--name", name, "-v", &mount, "--user", &owner_ids(dir)]);
        command.arg(image).args(args);
        return command;
    }
    let mut command = Command::new(spec);
    command.args(args);
    command
}

/// The user and group that own `dir`, so the server in a container makes
/// files this program may remove.
fn owner_ids(dir: &Path) -> String {
    use std::os::unix::fs::MetadataExt;
    std::fs::metadata(dir).map_or_else(|_| "0:0".to_owned(), |m| format!("{}:{}", m.uid(), m.gid()))
}

/// Waits for `child` to say it listens, its output then drained.
fn wait_listening(child: &mut Child) -> Result<()> {
    let Some(err) = child.stderr.take() else { return fail("the demo server's output is not readable") };
    let (said, heard) = mpsc::channel();
    std::thread::Builder::new()
        .name("screenshots-server-output".to_owned())
        .spawn(move || {
            let mut said = Some(said);
            for line in BufReader::new(err).lines().map_while(std::result::Result::ok) {
                if line.starts_with(LISTENING)
                    && let Some(said) = said.take()
                {
                    let _ = said.send(()); // The scenes may have stopped waiting.
                }
            }
        })
        .map_err(|e| Error(format!("the demo server's output: {e}")))?;
    heard.recv_timeout(START_WITHIN).map_err(|_| Error("the demo server did not say it listens".to_owned()))
}
