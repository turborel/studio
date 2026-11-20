//! Studio's error (RULES.md R-ERR): every failure the backend gives the
//! front end, a server's kept whole, and Studio's own carrying the SQLCODE
//! and SQLSTATE turborel-client gives the same failure, or else those
//! every Turborel driver gives a misuse it raises itself.

use serde::Serialize;
use turborel_client::{Diagnostics, Failure};

/// The SQLCODE of a misuse Studio refuses itself, as every Turborel
/// driver refuses one turborel-client has no case for.
pub const MISUSE_SQLCODE: i32 = -910;
/// The SQLSTATE of such a misuse.
pub const MISUSE_SQLSTATE: &str = "TB910";
/// The SQLCODE of a connection failure, as turborel-client gives it.
pub const CONNECTION_SQLCODE: i32 = -919;
/// The SQLSTATE of a connection failure (`[CLIENT Timeouts]`).
pub const CONNECTION_SQLSTATE: &str = "08006";
/// The SQLSTATE of a connection that does not exist, which names another.
const ANOTHER_CONNECTION: &str = "08003";
/// The SQLSTATE of settings no connection can be made by
/// (`[CLIENT Where settings come from]`).
pub const UNABLE_TO_CONNECT: &str = "08001";

/// A failure, as the messages pane shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioError {
    /// Its SQLCODE.
    pub sqlcode: i32,
    /// Its SQLSTATE.
    pub sqlstate: String,
    /// What happened, in plain words.
    pub message: String,
    /// The rule of a standard it cites, if it does.
    pub rule: Option<String>,
    /// Where in the statement, in characters, if known.
    pub position: Option<u64>,
    /// Whether the session's transaction is still active after it.
    pub active: bool,
    /// What it is about, if the server said; boxed, so a result's error
    /// stays small.
    pub diagnostics: Option<Box<DiagnosticsView>>,
}

/// A failure's or a notice's diagnostics, as the server gave them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsView {
    /// `ERROR`, `FATAL`, `WARNING` or `NOTICE`.
    pub severity: Option<String>,
    /// More than the message says.
    pub detail: Option<String>,
    /// What may be done about it.
    pub hint: Option<String>,
    /// Where it was raised.
    pub context: Option<String>,
    /// The schema of what it is about.
    pub schema: Option<String>,
    /// The table or view it is about.
    pub table: Option<String>,
    /// The column it is about.
    pub column: Option<String>,
    /// The data type of the value it is about.
    pub data_type: Option<String>,
    /// The constraint broken.
    pub constraint: Option<String>,
}

impl From<&Diagnostics> for DiagnosticsView {
    fn from(d: &Diagnostics) -> DiagnosticsView {
        DiagnosticsView {
            severity: d.severity.clone(),
            detail: d.detail.clone(),
            hint: d.hint.clone(),
            context: d.context.clone(),
            schema: d.schema.clone(),
            table: d.table.clone(),
            column: d.column.clone(),
            data_type: d.data_type.clone(),
            constraint: d.constraint.clone(),
        }
    }
}

impl From<Failure> for StudioError {
    /// The server's failure, or turborel-client's, kept whole (R-ERR-2).
    fn from(f: Failure) -> StudioError {
        StudioError {
            diagnostics: f.diagnostics.as_deref().map(|d| Box::new(DiagnosticsView::from(d))),
            sqlcode: f.sqlcode,
            sqlstate: f.sqlstate,
            message: f.message,
            rule: f.rule,
            position: f.position,
            active: f.active,
        }
    }
}

impl From<turborel::error::SqlError> for StudioError {
    /// A failure of Turborel's own code run in Studio, as a value cast to
    /// a parameter's type: its SQLCODE, SQLSTATE, message and rule.
    fn from(e: turborel::error::SqlError) -> StudioError {
        StudioError {
            sqlcode: e.sqlcode(),
            sqlstate: e.sqlstate().as_str().to_owned(),
            message: e.msg,
            rule: e.rule,
            position: None,
            active: false,
            diagnostics: None,
        }
    }
}

impl StudioError {
    /// A failure Studio raises itself, of `sqlcode` and `sqlstate`.
    pub fn new(sqlcode: i32, sqlstate: &str, message: impl Into<String>) -> StudioError {
        StudioError {
            sqlcode,
            sqlstate: sqlstate.to_owned(),
            message: message.into(),
            rule: None,
            position: None,
            active: false,
            diagnostics: None,
        }
    }

    /// A misuse Studio refuses: an argument out of its bounds, or an object
    /// that is no more (SQLCODE -910, SQLSTATE TB910).
    pub fn misuse(message: impl Into<String>) -> StudioError {
        StudioError::new(MISUSE_SQLCODE, MISUSE_SQLSTATE, message)
    }

    /// A connection lost (SQLCODE -919, SQLSTATE 08006), as turborel-client
    /// gives one.
    pub fn lost(message: impl Into<String>) -> StudioError {
        StudioError::new(CONNECTION_SQLCODE, CONNECTION_SQLSTATE, message)
    }

    /// Whether the connection it came of takes no more, as
    /// turborel-client judges a failure that ends one: of class 08 but
    /// 08003, which names another connection, or a connection's failure of
    /// class 28.
    pub fn ends_connection(&self) -> bool {
        (self.sqlstate.starts_with("08") && self.sqlstate != ANOTHER_CONNECTION)
            || (self.sqlcode == CONNECTION_SQLCODE && self.sqlstate.starts_with("28"))
    }
}

impl std::fmt::Display for StudioError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SQLCODE {} (SQLSTATE {}): {}", self.sqlcode, self.sqlstate, self.message)
    }
}

impl std::error::Error for StudioError {}

/// The backend's results.
pub type Result<T> = std::result::Result<T, StudioError>;
