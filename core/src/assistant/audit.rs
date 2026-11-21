//! The assistant's audit log (RULES.md D55), local alone: of each request,
//! its time, provider, model and connection, the kinds of context sent,
//! its tool calls with their approvals, refusals and blocks, how it
//! stopped, and its tokens. A line of JSON each, of format 1, in `assistant-audit.jsonl`,
//! its owner's alone, begun again past 1 MiB; viewable and clearable. It
//! never holds a key, nor a row's value.

use std::io::Write as _;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::assistant::wire::Usage;
use crate::error::{Result, StudioError};
use crate::store::FORMAT;

/// The log's file.
pub const AUDIT_FILE: &str = "assistant-audit.jsonl";
/// The most bytes it holds before it is begun again.
const MAX_LOG_BYTES: u64 = 1024 * 1024;
/// The most entries read back.
const MAX_READ: usize = 1000;

/// A tool call, and what became of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRecord {
    /// Its tool.
    pub name: String,
    /// What became of it: ran, approved, refused by the user, blocked by a
    /// rule, or of input that did not fit.
    pub outcome: String,
}

/// An entry of the log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    /// The entry's format.
    pub format: u32,
    /// When, in seconds since 1970.
    pub time: u64,
    /// The provider: Claude, or the user's own.
    pub provider: String,
    /// The model.
    pub model: String,
    /// The connection, by its name.
    pub connection: String,
    /// The kinds of context sent: schema, sql, explain, rows.
    pub sent: Vec<String>,
    /// Its tool calls.
    pub tools: Vec<ToolRecord>,
    /// How it stopped.
    pub stop: String,
    /// Its tokens.
    pub usage: Usage,
}

/// The log, of a directory.
#[derive(Debug, Clone)]
pub struct Audit {
    path: PathBuf,
}

/// The seconds since 1970, now.
pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

impl Audit {
    /// The log of `dir`.
    pub fn new(dir: &Path) -> Audit {
        Audit { path: dir.join(AUDIT_FILE) }
    }

    /// Adds `entry`, the log begun again past its bound, the old let go.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the log cannot be written.
    pub fn add(&self, entry: &AuditEntry) -> Result<()> {
        let failed = |e: std::io::Error| StudioError::misuse(format!("[DESIGN] the assistant's log {}: {e}", self.path.display()));
        if std::fs::metadata(&self.path).is_ok_and(|m| m.len() > MAX_LOG_BYTES) {
            std::fs::remove_file(&self.path).map_err(failed)?;
        }
        let mut options = std::fs::OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&self.path).map_err(failed)?;
        let line = serde_json::to_string(entry).map_err(|e| StudioError::misuse(format!("[DESIGN] the assistant's log: {e}")))?;
        writeln!(file, "{line}").map_err(failed)
    }

    /// The entries, the latest first, at most `MAX_READ`; a line that is no
    /// entry, or of another format, passed over.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the log cannot be read.
    pub fn entries(&self) -> Result<Vec<AuditEntry>> {
        let text = match std::fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(StudioError::misuse(format!("[DESIGN] the assistant's log: {e}"))),
        };
        let entries = text.lines().rev().filter_map(|l| serde_json::from_str::<AuditEntry>(l).ok());
        Ok(entries.filter(|e| e.format == FORMAT).take(MAX_READ).collect())
    }

    /// Forgets every entry.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the log cannot be removed.
    pub fn clear(&self) -> Result<()> {
        match std::fs::remove_file(&self.path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(StudioError::misuse(format!("[DESIGN] the assistant's log: {e}"))),
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Audit, AuditEntry, ToolRecord};
    use crate::assistant::wire::Usage;

    /// An entry of `stop`.
    fn entry(stop: &str) -> AuditEntry {
        AuditEntry {
            format: crate::store::FORMAT,
            time: super::now(),
            provider: "claude".into(),
            model: "claude-opus-5-5".into(),
            connection: "local".into(),
            sent: vec!["schema".into()],
            tools: vec![ToolRecord { name: "run_query".into(), outcome: "approved".into() }],
            stop: stop.into(),
            usage: Usage::default(),
        }
    }

    /// [DESIGN] D55: entries are added a line each, read back the latest
    /// first, a line of none passed over, begun again past the bound, and
    /// cleared.
    #[test]
    fn the_log_keeps_and_clears() {
        let dir = crate::testing::scratch("assistant/audit");
        let audit = Audit::new(&dir);
        assert_eq!(audit.entries().unwrap(), Vec::new());
        audit.add(&entry("endTurn")).unwrap();
        audit.add(&entry("toolUse")).unwrap();
        audit.add(&AuditEntry { format: 2, ..entry("of another format") }).unwrap();
        std::fs::OpenOptions::new()
            .append(true)
            .open(dir.join(super::AUDIT_FILE))
            .map(|mut f| std::io::Write::write_all(&mut f, b"garbage\n"))
            .unwrap()
            .unwrap();
        let read = audit.entries().unwrap();
        assert_eq!(read.iter().map(|e| e.stop.as_str()).collect::<Vec<_>>(), ["toolUse", "endTurn"]);
        std::fs::write(dir.join(super::AUDIT_FILE), vec![b'x'; 1024 * 1024 + 1]).unwrap();
        audit.add(&entry("after")).unwrap();
        assert_eq!(audit.entries().unwrap().len(), 1);
        audit.clear().unwrap();
        audit.clear().unwrap();
        assert_eq!(audit.entries().unwrap(), Vec::new());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            audit.add(&entry("x")).unwrap();
            assert_eq!(std::fs::metadata(dir.join(super::AUDIT_FILE)).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }

    /// [STUDIO assistant-audit.jsonl]: the manual's line is read.
    #[test]
    fn the_manuals_log_line_is_read() {
        let dir = crate::testing::scratch("assistant/manual-audit");
        std::fs::write(dir.join(super::AUDIT_FILE), crate::testing::manual_json("appendix/d-files.md", "assistant-audit.jsonl")).unwrap();
        let read = Audit::new(&dir).entries().unwrap();
        assert_eq!((read.len(), read[0].usage.cache_read, read[0].tools[0].outcome.as_str()), (1, 4800, "approved"));
    }
}
