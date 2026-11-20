//! The history of what ran (RULES.md D36): each statement's text, when it
//! ran, on which connection, how long it took, its rows and its outcome,
//! in a file of format 1 its owner's alone, the latest first, at most
//! `MAX_ENTRIES`. A statement that changes who may do what, as CREATE USER
//! with its password, is never kept (R-SEC-1).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{Result, StudioError};
use crate::guard::classify::{Class, classify};
use crate::store::{self, FORMAT};

/// The history's file.
pub const HISTORY_FILE: &str = "history.json";
/// The most entries kept.
pub const MAX_ENTRIES: usize = 1000;
/// The longest statement kept, in bytes.
pub const MAX_STATEMENT_BYTES: usize = 64 * 1024;
/// The longest name of a connection kept, in characters.
const MAX_NAME_CHARS: usize = 200;
/// The longest the file may be, in bytes.
const MAX_FILE_BYTES: u64 = 96 * 1024 * 1024;

/// A statement that ran.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    /// The statement.
    pub sql: String,
    /// When it ran, in milliseconds since the Unix epoch.
    pub at: u64,
    /// The connection's name.
    pub connection: String,
    /// The saved connection's identifier, if it is one.
    pub saved: Option<String>,
    /// How long it took, in milliseconds, as the window measured it.
    pub millis: u64,
    /// The rows it gave or changed, if it told them.
    pub rows: Option<u64>,
    /// Its SQLSTATE: 00000, or a warning's or failure's.
    pub sqlstate: String,
}

/// The history's file.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct HistoryFile {
    format: u32,
    entries: Vec<Entry>,
}

/// The history, in a directory of the user's own.
#[derive(Debug)]
pub struct History {
    path: PathBuf,
    lock: Mutex<()>,
}

impl History {
    /// The history kept in `dir`.
    pub fn new(dir: &Path) -> Self {
        History { path: dir.join(HISTORY_FILE), lock: Mutex::new(()) }
    }

    /// The entries whose statement or connection holds `text`, in any
    /// case, the latest first, at most `limit`.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the file cannot be read.
    pub fn search(&self, text: &str, limit: usize) -> Result<Vec<Entry>> {
        let _held = self.lock.lock().map_err(|_| StudioError::misuse("[DESIGN] the history was poisoned"))?;
        let wanted = text.to_lowercase();
        Ok(self
            .read()?
            .into_iter()
            .filter(|e| wanted.is_empty() || e.sql.to_lowercase().contains(&wanted) || e.connection.to_lowercase().contains(&wanted))
            .take(limit)
            .collect())
    }

    /// Keeps `entry`, first, unless its statement changes who may do
    /// what; the oldest let go past `MAX_ENTRIES`. Whether it was kept.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the entry is out of bounds, or the file cannot be
    /// read or written.
    pub fn record(&self, entry: Entry) -> Result<bool> {
        if entry.sql.is_empty() || entry.sql.len() > MAX_STATEMENT_BYTES || entry.connection.chars().count() > MAX_NAME_CHARS {
            return Err(StudioError::misuse(format!("[DESIGN] a statement kept is 1 to {MAX_STATEMENT_BYTES} bytes")));
        }
        if classify(&entry.sql).class == Class::Security {
            return Ok(false);
        }
        let _held = self.lock.lock().map_err(|_| StudioError::misuse("[DESIGN] the history was poisoned"))?;
        let mut entries = self.read()?;
        entries.insert(0, entry);
        entries.truncate(MAX_ENTRIES);
        store::write(&self.path, &HistoryFile { format: FORMAT, entries })?;
        Ok(true)
    }

    /// Forgets every entry.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the file cannot be written.
    pub fn clear(&self) -> Result<()> {
        let _held = self.lock.lock().map_err(|_| StudioError::misuse("[DESIGN] the history was poisoned"))?;
        store::write(&self.path, &HistoryFile { format: FORMAT, entries: Vec::new() })
    }

    /// The entries in the file, none if there is none.
    fn read(&self) -> Result<Vec<Entry>> {
        Ok(store::read::<HistoryFile>(&self.path, MAX_FILE_BYTES)?.map(|f| f.entries).unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::{Entry, History, MAX_ENTRIES};
    use crate::testing::scratch;

    /// An entry of `sql`, run at `at`.
    fn entry(sql: &str, at: u64) -> Entry {
        Entry { sql: sql.into(), at, connection: "Orders".into(), saved: None, millis: 3, rows: Some(1), sqlstate: "00000".into() }
    }

    /// [DESIGN] D36: entries are kept the latest first, found by their
    /// statement or connection in any case, at most `MAX_ENTRIES`, and
    /// cleared.
    #[test]
    fn the_history_keeps_the_latest_first() {
        let history = History::new(&scratch("history"));
        assert_eq!(history.search("", 10).unwrap(), Vec::new());
        assert!(history.record(entry("SELECT 1", 1)).unwrap());
        assert!(history.record(entry("select name from staff", 2)).unwrap());
        assert_eq!(history.search("", 10).unwrap().iter().map(|e| e.at).collect::<Vec<_>>(), [2, 1]);
        assert_eq!(history.search("STAFF", 10).unwrap().len(), 1);
        assert_eq!(history.search("orders", 1).unwrap().len(), 1);
        let full = (0..u64::try_from(MAX_ENTRIES).unwrap()).map(|at| entry("VALUES (1)", at)).collect();
        crate::store::write(&history.path, &super::HistoryFile { format: crate::store::FORMAT, entries: full }).unwrap();
        history.record(entry("VALUES (2)", 5000)).unwrap();
        let entries = history.search("", usize::MAX).unwrap();
        assert_eq!((entries.len(), entries[0].at), (MAX_ENTRIES, 5000));
        history.clear().unwrap();
        assert_eq!(history.search("", 10).unwrap(), Vec::new());
    }

    /// [RULE] R-SEC-1: a statement that changes who may do what, as one
    /// naming a password, is never kept; one empty or too long is refused.
    #[test]
    fn a_password_is_never_kept() {
        let history = History::new(&scratch("history-secret"));
        assert!(!history.record(entry("CREATE USER BOB PASSWORD 'secret'", 1)).unwrap());
        assert!(!history.record(entry("alter user bob password 'secret'", 1)).unwrap());
        assert_eq!(history.search("", 10).unwrap(), Vec::new());
        assert_eq!(history.record(entry("", 1)).unwrap_err().sqlstate, "TB910");
        assert_eq!(history.record(entry(&"x".repeat(super::MAX_STATEMENT_BYTES + 1), 1)).unwrap_err().sqlstate, "TB910");
    }

    /// [RULE] R-FMT-2 [STUDIO history.json]: the manual's example of the
    /// file is one Studio reads.
    #[test]
    fn the_manuals_example_is_read() {
        let history = History::new(&scratch("history-manual"));
        std::fs::write(&history.path, crate::testing::manual_json("appendix/d-files.md", "history.json")).unwrap();
        assert_eq!(history.search("staff", 10).unwrap()[0].rows, Some(3));
    }
}
