//! The assistant's audit log (RULES.md D55), local alone: of each request,
//! its time, provider, model and connection, the kinds of context sent,
//! its tool calls with their approvals, refusals and blocks, how it
//! stopped, and its tokens. A line of JSON each, of format 1, in `assistant-audit.jsonl`,
//! its owner's alone, begun again past 1 MiB; viewable and clearable. It
//! never holds a key, nor a row's value.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::assistant::wire::Usage;
use crate::jsonl::{Entry, Log};

/// The log's file.
pub const AUDIT_FILE: &str = "assistant-audit.jsonl";

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
/// The assistant's log, of a directory.
pub type Audit = Log<AuditEntry>;

/// The seconds since 1970, now.
pub use crate::jsonl::now;

impl Entry for AuditEntry {
    fn format(&self) -> u32 {
        self.format
    }
}

/// The assistant's log of `dir`.
pub fn audit(dir: &Path) -> Audit {
    Log::new(dir, AUDIT_FILE, "the assistant's log")
}

#[cfg(test)]
mod tests {
    use super::{AuditEntry, ToolRecord};
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
        let audit = super::audit(&dir);
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
        let read = super::audit(&dir).entries().unwrap();
        assert_eq!((read.len(), read[0].usage.cache_read, read[0].tools[0].outcome.as_str()), (1, 4800, "approved"));
    }
}
