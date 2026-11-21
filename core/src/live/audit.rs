//! Live Sessions' log (RULES.md D56), local alone: each session begun and
//! ended, invitation made, guest asked, admitted, refused, joined, left and
//! removed, role and grant changed, and suggestion made, a line each in
//! `live-sessions-audit.jsonl` (D55's log of JSON lines). It holds no
//! workspace, nor a secret.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::jsonl::{Entry, Log, now};
use crate::store::FORMAT;

/// The log's file.
pub const AUDIT_FILE: &str = "live-sessions-audit.jsonl";
/// The longest detail kept, in characters.
const MAX_DETAIL_CHARS: usize = 4096;

/// An entry of the log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveEntry {
    /// The entry's format.
    pub format: u32,
    /// When, in seconds since 1970.
    pub time: u64,
    /// What happened, as `started` or `admitted`.
    pub what: String,
    /// Who it was of, a participant's name, if one.
    pub who: Option<String>,
    /// More of it, as a suggestion's SQL, at most 4096 characters.
    pub detail: Option<String>,
}

impl Entry for LiveEntry {
    fn format(&self) -> u32 {
        self.format
    }
}

impl LiveEntry {
    /// An entry of now, of `what`, of `who`, with `detail`.
    pub fn of(what: &str, who: Option<&str>, detail: Option<&str>) -> LiveEntry {
        LiveEntry {
            format: FORMAT,
            time: now(),
            what: what.to_owned(),
            who: who.map(str::to_owned),
            detail: detail.map(|d| d.chars().take(MAX_DETAIL_CHARS).collect()),
        }
    }
}

/// Live Sessions' log.
pub type Audit = Log<LiveEntry>;

/// Live Sessions' log of `dir`.
pub fn audit(dir: &Path) -> Audit {
    Log::new(dir, AUDIT_FILE, "Live Sessions' log")
}
