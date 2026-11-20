//! The live tests' server (RULES.md R-TEST-7, R-TEST-8): the one
//! `TURBOREL_TEST_SERVER` names, a `turboreld` program's path or `docker:`
//! and an image, started once for every live test on Studio's own port,
//! 17440, with a data directory of its own under the repository's ignored
//! `.claude/`, TLS by certificates made as it starts, SERVER.TRUST_LOCAL
//! on, and an owner of a password; and stopped after, waiting on its own
//! process alone.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use crate::certs::{self, Certs};

/// The variable that names the server; unset, the live tests are skipped.
pub const SERVER_VARIABLE: &str = "TURBOREL_TEST_SERVER";
/// Studio's own port for live servers.
pub const PORT: u16 = 17440;
/// The database's owner, its first user, and the owner's password.
pub const OWNER: &str = "ANN";
/// The owner's password.
pub const OWNER_PASSWORD: &str = "ann's secret";
/// A server named by its image begins so.
const DOCKER: &str = "docker:";
/// The line the server writes once it listens.
const LISTENING: &str = "turboreld: listening at";
/// How long the server has to listen.
const START_WITHIN: Duration = Duration::from_secs(120);

/// A running server.
pub struct Server {
    /// Its directory: certificates, the data and the socket.
    pub dir: PathBuf,
    /// Its certificates.
    pub certs: Certs,
    /// Its Unix socket, on Unix.
    pub socket: Option<PathBuf>,
    child: Child,
    container: Option<String>,
}

impl Server {
    /// The server `spec` names, started.
    pub fn start(spec: &str) -> Server {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(".claude").join("live").join(std::process::id().to_string());
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let certs = certs::make(&dir, OWNER);
        let socket = cfg!(unix).then(|| dir.join("s.sock"));
        let container = spec.strip_prefix(DOCKER).map(|_| format!("studio-live-{}", std::process::id()));
        let mut owner = command(spec, container.as_deref(), &dir, &["--dir", &data(&dir), "user", "add", OWNER, "--owner"]);
        owner.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut made = owner.spawn().unwrap();
        std::io::Write::write_all(made.stdin.as_mut().unwrap(), format!("{OWNER_PASSWORD}\n").as_bytes()).unwrap();
        let out = made.wait_with_output().unwrap();
        assert!(out.status.success(), "making the owner: {}", String::from_utf8_lossy(&out.stderr));
        let args = settings(&dir, &certs, socket.as_deref());
        let mut serve = command(spec, container.as_deref(), &dir, &args.iter().map(String::as_str).collect::<Vec<_>>());
        serve.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
        let mut child = serve.spawn().unwrap();
        wait_listening(&mut child);
        Server { dir, certs, socket, child, container }
    }

    /// Stops the server, and waits for its process alone.
    pub fn stop(mut self) {
        if let Some(name) = &self.container {
            let _ = Command::new("docker").args(["stop", name]).output(); // A container gone needs no stop.
        }
        let _ = self.child.kill(); // A process already ended needs no kill.
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// The database's directory.
fn data(dir: &Path) -> String {
    dir.join("data").display().to_string()
}

/// The server's settings, as `--set` takes them.
fn settings(dir: &Path, certs: &Certs, socket: Option<&Path>) -> Vec<String> {
    let mut set = vec![
        format!("SERVER.PORT={PORT}"),
        "SERVER.TRUST_LOCAL=ON".to_owned(),
        "SERVER.TLS=ON".to_owned(),
        format!("SERVER.TLS_CERTIFICATE={}", certs.server.0.display()),
        format!("SERVER.TLS_KEY={}", certs.server.1.display()),
        format!("SERVER.TLS_CLIENT_CA={}", certs.authority.display()),
        "SERVER.PASSWORD_ITERATIONS=10000".to_owned(),
        "SERVER.LOGIN_DELAY_MS=0".to_owned(),
    ];
    if let Some(socket) = socket {
        set.push(format!("SERVER.SOCKET={}", socket.display()));
    }
    let mut args = vec!["--dir".to_owned(), data(dir)];
    for setting in set {
        args.push("--set".to_owned());
        args.push(setting);
    }
    args
}

/// The command of `spec`, a program or an image, with `args`.
fn command(spec: &str, container: Option<&str>, dir: &Path, args: &[&str]) -> Command {
    if let (Some(image), Some(name)) = (spec.strip_prefix(DOCKER), container) {
        {
            let mut command = Command::new("docker");
            let mount = format!("{0}:{0}", dir.display());
            command.args(["run", "--rm", "-i", "--network", "host", "--name", name, "-v", &mount]);
            #[cfg(unix)]
            command.args(["--user", &owner_ids(dir)]);
            command.arg(image).args(args);
            return command;
        }
    }
    let mut command = Command::new(spec);
    command.args(args);
    command
}

/// The user and group that own `dir`, so the server in a container makes
/// files the tests may remove.
#[cfg(unix)]
fn owner_ids(dir: &Path) -> String {
    use std::os::unix::fs::MetadataExt;
    let meta = std::fs::metadata(dir).unwrap();
    format!("{}:{}", meta.uid(), meta.gid())
}

/// Waits for `child` to say it listens, its output then drained.
fn wait_listening(child: &mut Child) {
    let err = child.stderr.take().unwrap();
    let (said, heard) = mpsc::channel();
    std::thread::Builder::new()
        .name("live-server-output".to_owned())
        .spawn(move || {
            let mut said = Some(said);
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                if line.starts_with(LISTENING)
                    && let Some(said) = said.take()
                {
                    let _ = said.send(());
                }
            }
        })
        .unwrap();
    heard.recv_timeout(START_WITHIN).expect("the server did not say it listens");
}
