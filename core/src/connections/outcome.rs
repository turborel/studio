//! What running a statement gives the front end (`[CLIENT Running
//! statements]`, `[CLIENT What the server tells]`): a query's result, its
//! columns and first page; or another statement's completion, the rows
//! it changed and the values it generated; with its warnings, the
//! server's time for it, and the session after it.

use serde::Serialize;
use turborel_client::{Completed, Timing};

use crate::connections::cells::ColumnInfo;
use crate::connections::pages::Page;
use crate::connections::session::SessionState;
use crate::error::StudioError;

/// A result's number, within its connection.
pub type ResultId = u64;

/// A statement's outcome.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Outcome {
    /// A query's result, open for more rows.
    #[serde(rename_all = "camelCase")]
    Rows {
        /// The result's number, to ask for its rows and close it by.
        result: ResultId,
        /// Its columns.
        columns: Vec<ColumnInfo>,
        /// Its first page.
        page: Page,
    },
    /// Any other statement's completion.
    #[serde(rename_all = "camelCase")]
    Done {
        /// Its SQLCODE, 0 or 100.
        sqlcode: i32,
        /// Its SQLSTATE, a warning's among them.
        sqlstate: String,
        /// The rows it inserted, updated, deleted or merged, if told.
        rows_affected: Option<u64>,
        /// The identity values an INSERT generated, as SQL writes them.
        generated: Vec<String>,
    },
}

impl Outcome {
    /// The completion `completed`, with what the connection told of it.
    pub fn done(completed: &Completed, rows_affected: Option<u64>, generated: &[String]) -> Outcome {
        Outcome::Done { sqlcode: completed.sqlcode, sqlstate: completed.sqlstate.clone(), rows_affected, generated: generated.to_vec() }
    }
}

/// The server's time for a statement, in microseconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerTime {
    /// From when a worker began it until its completion was ready.
    pub total: u64,
    /// The time it waited for a worker, before the whole.
    pub queued: u64,
    /// The time it waited for locks, in the whole.
    pub locks: u64,
}

impl From<Timing> for ServerTime {
    fn from(t: Timing) -> ServerTime {
        ServerTime { total: t.total, queued: t.queued, locks: t.locks }
    }
}

/// What running a statement gave.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ran {
    /// Its outcome.
    pub outcome: Outcome,
    /// Its warnings, granted `conditions`.
    pub warnings: Vec<StudioError>,
    /// The server's time for it, if told.
    pub server_time: Option<ServerTime>,
    /// The session after it.
    pub session: SessionState,
}
