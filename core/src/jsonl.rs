//! A local log of JSON lines (RULES.md R-TEST-7's one harness of a kind,
//! for logs): an entry a line, each of format 1, the file its owner's
//! alone, begun again past 1 MiB, the old let go; read back the latest
//! first, a line of another format or no entry passed over; cleared.
//! The assistant's log (D55) and Live Sessions' (D56) are each one.

use std::io::Write as _;
use std::marker::PhantomData;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::error::{Result, StudioError};
use crate::store::FORMAT;

/// The most bytes a log holds before it is begun again.
const MAX_LOG_BYTES: u64 = 1024 * 1024;
/// The most entries read back.
const MAX_READ: usize = 1000;

/// An entry of a log: of its format.
pub trait Entry: Serialize + DeserializeOwned {
    /// The entry's format.
    fn format(&self) -> u32;
}

/// A log of entries `T`, in a file.
#[derive(Debug, Clone)]
pub struct Log<T> {
    path: PathBuf,
    name: &'static str,
    of: PhantomData<fn() -> T>,
}

/// The seconds since 1970, now.
pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

impl<T: Entry> Log<T> {
    /// The log `file` of `dir`, called `name` as its failures say.
    pub fn new(dir: &Path, file: &str, name: &'static str) -> Log<T> {
        Log { path: dir.join(file), name, of: PhantomData }
    }

    /// A failure of the log, of `e`.
    fn failed(&self, e: impl std::fmt::Display) -> StudioError {
        StudioError::misuse(format!("[DESIGN] {} {}: {e}", self.name, self.path.display()))
    }

    /// Adds `entry`, the log begun again past its bound, the old let go.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the log cannot be written.
    pub fn add(&self, entry: &T) -> Result<()> {
        if std::fs::metadata(&self.path).is_ok_and(|m| m.len() > MAX_LOG_BYTES) {
            std::fs::remove_file(&self.path).map_err(|e| self.failed(e))?;
        }
        let mut options = std::fs::OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&self.path).map_err(|e| self.failed(e))?;
        let line = serde_json::to_string(entry).map_err(|e| self.failed(e))?;
        writeln!(file, "{line}").map_err(|e| self.failed(e))
    }

    /// The entries, the latest first, at most 1000; a line that is no
    /// entry, or of another format, passed over.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the log cannot be read.
    pub fn entries(&self) -> Result<Vec<T>> {
        let text = match std::fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(self.failed(e)),
        };
        let entries = text.lines().rev().filter_map(|l| serde_json::from_str::<T>(l).ok());
        Ok(entries.filter(|e| e.format() == FORMAT).take(MAX_READ).collect())
    }

    /// Forgets every entry.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the log cannot be removed.
    pub fn clear(&self) -> Result<()> {
        match std::fs::remove_file(&self.path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(self.failed(e)),
            _ => Ok(()),
        }
    }
}
