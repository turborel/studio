//! The window's failures, kept in a log of their own (RULES.md D49,
//! R-SEC-11): each line the instant and what the window said of a failure
//! it did not handle, so a window that failed can be told of after. The
//! window holds no secret, and the log holds no row's values, but the
//! messages the window wrote; it is its owner's alone, and kept short.

use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::{Result, StudioError};

/// The log's file, in Studio's configuration.
pub const FAILURES_FILE: &str = "failures.log";
/// The longest failure told, in characters; the rest is let go.
pub const MAX_FAILURE_CHARS: usize = 16 * 1024;
/// The longest the log grows before it is begun again, the old kept beside it.
pub const MAX_LOG_BYTES: u64 = 1024 * 1024;

/// The window's failures' log.
#[derive(Debug)]
pub struct Failures {
    path: PathBuf,
}

impl Failures {
    /// The log in `dir`.
    pub fn new(dir: &Path) -> Failures {
        Failures { path: dir.join(FAILURES_FILE) }
    }

    /// The log's file.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Adds `text`, a failure the window told, at most `MAX_FAILURE_CHARS`
    /// of it, a line, the instant before it; the log begun again, the old
    /// kept as `failures.log.old`, once it passes `MAX_LOG_BYTES`.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the log cannot be written.
    pub fn log(&self, text: &str) -> Result<()> {
        let failed = |e: std::io::Error| StudioError::misuse(format!("[DESIGN] {}: {e}", self.path.display()));
        if std::fs::metadata(&self.path).is_ok_and(|m| m.len() > MAX_LOG_BYTES) {
            std::fs::rename(&self.path, self.path.with_extension("log.old")).map_err(failed)?;
        }
        let mut options = std::fs::OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            /// Read and write for the owner alone (R-SEC-2).
            const OWNER_ONLY: u32 = 0o600;
            options.mode(OWNER_ONLY);
        }
        let mut file = options.open(&self.path).map_err(failed)?;
        let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or_default();
        let told: String = text.chars().take(MAX_FAILURE_CHARS).map(|c| if c == '\n' || c == '\r' { ' ' } else { c }).collect();
        writeln!(file, "{at} {told}").map_err(failed)
    }
}

#[cfg(test)]
mod tests {
    use super::{Failures, MAX_FAILURE_CHARS, MAX_LOG_BYTES};

    /// [DESIGN] D49: each failure is a line of the log, the instant before
    /// it, its lines joined and its length bounded; a log past its bound is
    /// begun again, the old kept.
    #[test]
    fn failures_are_logged() {
        let dir = crate::testing::scratch("failures");
        let log = Failures::new(&dir);
        log.log("TypeError: x is undefined\n  at App").unwrap();
        log.log(&"y".repeat(MAX_FAILURE_CHARS + 10)).unwrap();
        let text = std::fs::read_to_string(log.path()).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with(" TypeError: x is undefined   at App"), "{}", lines[0]);
        assert!(lines[1].len() < MAX_FAILURE_CHARS + 30);
        std::fs::write(log.path(), vec![b'z'; usize::try_from(MAX_LOG_BYTES).unwrap() + 1]).unwrap();
        log.log("after").unwrap();
        assert!(dir.join("failures.log.old").exists());
        assert!(std::fs::read_to_string(log.path()).unwrap().ends_with(" after\n"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(log.path()).unwrap().permissions().mode() & 0o777, 0o600);
        }
        assert!(Failures::new(&dir.join("none")).log("x").is_err());
    }
}
