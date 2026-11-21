//! `studio-relay` (RULES.md D56): Turborel Studio's relay for Live
//! Sessions, which pairs a guest with its session's host and passes the
//! bytes of their own TLS session, which it cannot read. It has no
//! accounts and keeps its sessions in memory alone.
//!
//! ```text
//! studio-relay [--listen ADDRESS] [--identity DIRECTORY] [--sessions N] [--guests N]
//! ```
//!
//! It listens on `0.0.0.0:4433` unless told another address. Its
//! certificate is made as it starts, or, with `--identity`, kept in the
//! directory named, `relay.der` and `relay.key`, made the first time, so
//! its fingerprint stays the same across restarts. It prints the address
//! and fingerprint Studio's settings name.

#![allow(clippy::print_stdout, clippy::print_stderr, reason = "a command-line program tells its user on its standard streams")]

use std::net::SocketAddr;
use std::path::Path;
use std::process::ExitCode;

use rustls::pki_types::CertificateDer;
use turborel_studio_live::cert::Identity;
use turborel_studio_live::error::{LiveError, Result, failed, refused};
use turborel_studio_live::relay::{Limits, Relay};

/// The address listened on unless told another.
const DEFAULT_LISTEN: &str = "0.0.0.0:4433";

/// What the command line says.
struct Arguments {
    listen: SocketAddr,
    identity: Option<String>,
    limits: Limits,
}

/// The number of option `name`, its text `value`.
fn number(name: &str, value: Option<String>) -> Result<usize> {
    value.and_then(|v| v.parse().ok()).filter(|n| *n > 0).ok_or_else(|| refused(format!("{name} takes a number above 0")))
}

/// The arguments of `args`.
fn arguments(mut args: impl Iterator<Item = String>) -> Result<Arguments> {
    let mut read = Arguments {
        listen: DEFAULT_LISTEN.parse().map_err(|e| failed("the default address", e))?,
        identity: None,
        limits: Limits::default(),
    };
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--listen" => {
                read.listen =
                    args.next().and_then(|a| a.parse().ok()).ok_or_else(|| refused("--listen takes an address, as 0.0.0.0:4433"))?;
            }
            "--identity" => read.identity = Some(args.next().ok_or_else(|| refused("--identity takes a directory"))?),
            "--sessions" => read.limits.sessions = number("--sessions", args.next())?,
            "--guests" => read.limits.guests = number("--guests", args.next())?,
            other => {
                return Err(refused(format!(
                    "unknown argument {other}: studio-relay [--listen ADDRESS] [--identity DIRECTORY] [--sessions N] [--guests N]"
                )));
            }
        }
    }
    Ok(read)
}

/// The identity kept in `dir`, made there the first time.
fn kept(dir: &Path) -> Result<Identity> {
    let (cert, key) = (dir.join("relay.der"), dir.join("relay.key"));
    if let (Ok(der), Ok(pkcs8)) = (std::fs::read(&cert), std::fs::read(&key)) {
        return Ok(Identity::of(CertificateDer::from(der), pkcs8));
    }
    let made = rcgen::generate_simple_self_signed(vec![turborel_studio_live::cert::SERVER_NAME.to_owned()])
        .map_err(|e| failed("the relay's certificate", e))?;
    std::fs::create_dir_all(dir).map_err(|e| failed(&dir.display().to_string(), e))?;
    let pkcs8 = made.signing_key.serialize_der();
    write_private(&key, &pkcs8)?;
    std::fs::write(&cert, made.cert.der().as_ref()).map_err(|e| failed(&cert.display().to_string(), e))?;
    Ok(Identity::of(made.cert.der().clone(), pkcs8))
}

/// Writes `bytes` to `path`, its owner's alone.
fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|e| failed(&path.display().to_string(), e))?;
    std::io::Write::write_all(&mut file, bytes).map_err(|e| failed(&path.display().to_string(), e))
}

/// Runs the relay of `args` until it is stopped.
fn run(args: &Arguments) -> Result<()> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .thread_name("studio-relay")
        .enable_all()
        .build()
        .map_err(|e| failed("the relay's runtime", e))?;
    runtime.block_on(async {
        let identity = match &args.identity {
            Some(dir) => kept(Path::new(dir))?,
            None => Identity::new()?,
        };
        let relay = Relay::new(args.limits, false);
        let endpoint = relay.listen(&identity, args.listen)?;
        let bound = endpoint.local_addr().map_err(|e| failed("the relay's address", e))?;
        println!("studio-relay: listening on {bound}");
        println!("studio-relay: fingerprint {}", identity.fingerprint);
        let stopped = tokio::signal::ctrl_c().await.map_err(|e: std::io::Error| LiveError(e.to_string()));
        endpoint.close(0u32.into(), b"stopped");
        endpoint.wait_idle().await;
        stopped
    })
}

fn main() -> ExitCode {
    match arguments(std::env::args().skip(1)).and_then(|args| run(&args)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("studio-relay: {e}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{arguments, kept};

    /// The arguments of `words`.
    fn of(words: &[&str]) -> turborel_studio_live::error::Result<super::Arguments> {
        arguments(words.iter().map(|w| (*w).to_owned()))
    }

    /// [DESIGN] D56: the relay's arguments are read, and each wrong one refused.
    #[test]
    fn the_arguments_are_read() {
        let read = of(&["--listen", "127.0.0.1:5000", "--sessions", "5", "--guests", "2", "--identity", "dir"]).unwrap();
        assert_eq!((read.listen.port(), read.limits.sessions, read.limits.guests, read.identity.as_deref()), (5000, 5, 2, Some("dir")));
        assert_eq!(of(&[]).unwrap().listen.port(), 4433);
        for bad in [&["--listen", "nowhere"][..], &["--sessions", "0"], &["--guests"], &["--identity"], &["--verbose"]] {
            assert!(of(bad).is_err(), "{bad:?}");
        }
    }

    /// [DESIGN] D56: a relay's identity is made in its directory once, and
    /// read back the same after, its key its owner's alone.
    #[test]
    fn the_identity_is_kept() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("target").join("test-scratch").join("relay-identity");
        let _ = std::fs::remove_dir_all(&dir);
        let first = kept(&dir).unwrap();
        let again = kept(&dir).unwrap();
        assert_eq!(first.fingerprint, again.fingerprint);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(dir.join("relay.key")).unwrap().permissions().mode() & 0o777, 0o600);
        }
        std::fs::write(dir.join("relay.key"), b"x").unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
