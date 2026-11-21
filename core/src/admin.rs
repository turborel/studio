//! Administration (RULES.md D57): the server and its sessions read of
//! Turborel's own views of the Information Schema, each a fixed query; and
//! each act of administration a statement written by the backend of what
//! the window asks, its names checked as identifiers by Turborel's own
//! lexer and its values written as literals, run through the guards
//! (D29) as any statement is. A password is a secret: it reaches no file,
//! history nor log, and no confirmation shows it.

use serde::{Deserialize, Serialize};
use turborel::lexer::{Tok, lex};

use crate::connections::manager::{ConnectionManager, RunAnswer};
use crate::error::{Result, StudioError};
use crate::events::ConnectionId;
use crate::secret::Secret;

/// The most rows of a view read.
const MAX_ROWS: u32 = 10_000;
/// The longest value of a setting, in characters.
const MAX_VALUE_CHARS: usize = 4096;

/// A view of the server, its database and its sessions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum View {
    /// The connections the server serves.
    Connections,
    /// The attributes each connection's client gave.
    ConnectionAttributes,
    /// The server's counters.
    Server,
    /// The database's background jobs.
    Jobs,
    /// The database's files.
    Files,
    /// Whether each kind of file is in the formats the settings name.
    FileFormats,
    /// The memory budget's reservations.
    MemoryReservations,
    /// The backups of the database's history.
    Backups,
    /// The log's segments archived.
    ArchivedSegments,
    /// The restore points.
    RestorePoints,
    /// The members of the replica group.
    Replicas,
    /// The settings, as the session sees them.
    Settings,
    /// The extensions created, and their plug-ins' processes and calls.
    Extensions,
    /// The statements run since the database opened, the costliest first.
    StatementStatistics,
    /// Each base table's engine, rows, bytes and last change.
    TableStatistics,
    /// Each index's method, searches, entries, height and bytes.
    IndexStatistics,
}

impl View {
    /// The view's query: its columns, in order, of every row.
    pub fn query(self) -> &'static str {
        match self {
            View::Connections => {
                "SELECT ID, USER_NAME, PEER, SECURE, STATE, APPLICATION, STATEMENT_TEXT, STATEMENT_BEGAN, TRANSACTION_BEGAN, WAITING_ON, LOCK_NAME, LOCK_HOLDER FROM INFORMATION_SCHEMA.CONNECTIONS ORDER BY ID"
            }
            View::ConnectionAttributes => {
                "SELECT CONNECTION_ID, ATTRIBUTE_NAME, ATTRIBUTE_VALUE FROM INFORMATION_SCHEMA.CONNECTION_ATTRIBUTES ORDER BY CONNECTION_ID, ATTRIBUTE_NAME"
            }
            View::Server => {
                "SELECT WORKERS_BUSY, STATEMENTS_WAITING, CONNECTIONS, REFUSED, CLOSED_UNTOLD, COMMITTED, ROLLED_BACK FROM INFORMATION_SCHEMA.SERVER"
            }
            View::Jobs => "SELECT LABEL, STATE, THREADED, RUNS, RESTARTS, LAST_ERROR FROM INFORMATION_SCHEMA.JOBS ORDER BY LABEL",
            View::Files => "SELECT PATH, KIND, CLASS, IS_OPEN, READS, WRITES, SYNCS FROM INFORMATION_SCHEMA.FILES ORDER BY KIND, PATH",
            View::FileFormats => "SELECT KIND, IS_SETTLED, BEHIND FROM INFORMATION_SCHEMA.FILE_FORMATS ORDER BY KIND",
            View::MemoryReservations => "SELECT RESERVED_BY, BYTES FROM INFORMATION_SCHEMA.MEMORY_RESERVATIONS ORDER BY RESERVED_BY",
            View::Backups => {
                "SELECT BACKUP_ID, LOCATION, KIND, PARENT_ID, TIMELINE, START_POSITION, STOP_POSITION, BYTES, STATE, LABEL, STARTED, ENDED FROM INFORMATION_SCHEMA.BACKUPS ORDER BY STARTED DESC"
            }
            View::ArchivedSegments => {
                "SELECT LOCATION, TIMELINE, FIRST_POSITION, LAST_POSITION, BYTES, ARCHIVED FROM INFORMATION_SCHEMA.ARCHIVED_SEGMENTS ORDER BY ARCHIVED DESC"
            }
            View::RestorePoints => "SELECT POINT_NAME, \"POSITION\", CREATED FROM INFORMATION_SCHEMA.RESTORE_POINTS ORDER BY CREATED DESC",
            View::Replicas => {
                "SELECT MEMBER, ADDRESS, IS_SELF, ROLE, EPOCH, VIEW_NUMBER, IS_CONNECTED, LAST_HEARD_MS FROM INFORMATION_SCHEMA.REPLICAS ORDER BY MEMBER"
            }
            View::Settings => {
                "SELECT SETTING_NAME, SETTING_VALUE, VALUE_SOURCE, DEFAULT_VALUE, VALUE_KIND, IS_SESSION_SETTABLE, TAKES_EFFECT, DESCRIPTION, STARTED_VALUE, IS_PENDING FROM INFORMATION_SCHEMA.SETTINGS ORDER BY SETTING_NAME"
            }
            View::StatementStatistics => {
                "SELECT STATEMENT_TEXT, USER_NAME, CALLS, TOTAL_MICROS, MEAN_MICROS, MAX_MICROS, ROW_COUNT, ROWS_READ, BYTES_SPILLED, LAST_RUN, STATEMENT_ID FROM INFORMATION_SCHEMA.STATEMENT_STATISTICS ORDER BY TOTAL_MICROS DESC, STATEMENT_ID"
            }
            View::TableStatistics => {
                "SELECT TABLE_SCHEMA, TABLE_NAME, ENGINE_NAME, ROW_COUNT, BYTES, BYTES_ESTIMATED, LAST_CHANGED, LAST_COMPACTED FROM INFORMATION_SCHEMA.TABLE_STATISTICS ORDER BY TABLE_SCHEMA, TABLE_NAME"
            }
            View::IndexStatistics => {
                "SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, METHOD_NAME, SEARCHES, ENTRIES_READ, ENTRY_COUNT, HEIGHT, BYTES FROM INFORMATION_SCHEMA.INDEX_STATISTICS ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME"
            }
            View::Extensions => {
                "SELECT EXTENSION_NAME, VERSION, DIRECTORY, SIGNER, PROCESSES_RUNNING, PROCESSES_STARTED, PROCESSES_FAILED, CALLS, CALLS_FAILED FROM INFORMATION_SCHEMA.EXTENSIONS ORDER BY EXTENSION_NAME"
            }
        }
    }

    /// The view's columns, as its query names them.
    pub fn columns(self) -> Vec<String> {
        let query = self.query();
        let list = query.strip_prefix("SELECT ").and_then(|q| q.split(" FROM ").next()).unwrap_or_default();
        list.split(", ").map(|c| c.trim_matches('"').to_owned()).collect()
    }
}

/// A view's rows, each cell as text, a null none.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewRows {
    /// The columns.
    pub columns: Vec<String>,
    /// The rows.
    pub rows: Vec<Vec<Option<String>>>,
    /// Whether the database has not the view, as REPLICAS of a node of no
    /// replica group, or the server's views of an embedded database.
    pub absent: bool,
}

/// The SQLCODE of a table not defined, as of REPLICAS on a node of no
/// replica group, or a server's view of an embedded database.
const NOT_DEFINED: i32 = -103;

/// The rows of `view` on `connection`; of a view the database has not,
/// as REPLICAS on a node of no replica group or CONNECTIONS of an
/// embedded database, none, and absent.
///
/// # Errors
///
/// The server's failure, as of a view a server that serves no connection
/// has not.
pub fn read(manager: &ConnectionManager, connection: ConnectionId, view: View) -> Result<ViewRows> {
    match manager.catalog(connection, view.query(), (&[], MAX_ROWS)) {
        Ok(rows) => Ok(ViewRows { columns: view.columns(), rows, absent: false }),
        Err(e) if e.sqlcode == NOT_DEFINED => Ok(ViewRows { columns: view.columns(), rows: Vec::new(), absent: true }),
        Err(e) => Err(e),
    }
}

/// A privilege on a table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Privilege {
    /// SELECT.
    Select,
    /// INSERT.
    Insert,
    /// UPDATE.
    Update,
    /// DELETE.
    Delete,
    /// REFERENCES.
    References,
    /// TRIGGER.
    Trigger,
}

impl Privilege {
    /// The privilege as written.
    fn sql(self) -> &'static str {
        match self {
            Privilege::Select => "SELECT",
            Privilege::Insert => "INSERT",
            Privilege::Update => "UPDATE",
            Privilege::Delete => "DELETE",
            Privilege::References => "REFERENCES",
            Privilege::Trigger => "TRIGGER",
        }
    }
}

/// A setting's value: a literal, or the default.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SettingValue {
    /// A value of the setting's kind, as `INFORMATION_SCHEMA.SETTINGS` writes it.
    Value {
        /// The value.
        value: String,
        /// Whether the setting's kind is an integer's, written unquoted.
        integer: bool,
    },
    /// The default: the database's of a session, the built-in of the database.
    Default,
}

/// A password, as the window sends it: never shown by `Debug`.
#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(transparent)]
pub struct Password(pub String);

impl std::fmt::Debug for Password {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Password(..)")
    }
}

/// An act of administration, as the window asks it. Each name is SQL as
/// written: an identifier, a delimited one, or a table's of one to three
/// parts.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Act {
    /// Ends another connection.
    EndConnection {
        /// Its ID, as CONNECTIONS shows it.
        id: u64,
    },
    /// Cancels another connection's statement.
    CancelConnection {
        /// Its ID.
        id: u64,
    },
    /// Sets a setting for the session.
    SetSession {
        /// The setting.
        name: String,
        /// Its value.
        value: SettingValue,
    },
    /// Sets a setting for the database.
    SetDatabase {
        /// The setting.
        name: String,
        /// Its value.
        value: SettingValue,
    },
    /// Makes a user.
    CreateUser {
        /// Its name.
        name: String,
        /// Its password.
        password: Password,
    },
    /// Gives a user a new password.
    ChangePassword {
        /// The user.
        name: String,
        /// The password.
        password: Password,
    },
    /// Lets a user create roles, or no more.
    AllowCreateRole {
        /// The user.
        name: String,
        /// Whether it may.
        allowed: bool,
    },
    /// Drops a user.
    DropUser {
        /// The user.
        name: String,
    },
    /// Makes a role.
    CreateRole {
        /// Its name.
        name: String,
    },
    /// Drops a role.
    DropRole {
        /// The role.
        name: String,
        /// CASCADE, else RESTRICT.
        cascade: bool,
    },
    /// Grants a role.
    GrantRole {
        /// The role.
        role: String,
        /// To whom: a user, a role or PUBLIC.
        grantee: String,
        /// WITH ADMIN OPTION.
        admin: bool,
    },
    /// Revokes a role.
    RevokeRole {
        /// The role.
        role: String,
        /// From whom.
        grantee: String,
        /// CASCADE, else RESTRICT.
        cascade: bool,
    },
    /// Grants privileges on a table.
    GrantPrivileges {
        /// The privileges.
        privileges: Vec<Privilege>,
        /// The table.
        table: String,
        /// To whom.
        grantee: String,
        /// WITH GRANT OPTION.
        grant_option: bool,
    },
    /// Revokes privileges on a table.
    RevokePrivileges {
        /// The privileges.
        privileges: Vec<Privilege>,
        /// The table.
        table: String,
        /// From whom.
        grantee: String,
        /// CASCADE, else RESTRICT.
        cascade: bool,
    },
}

/// A misuse of `what`.
fn refused(what: &str) -> StudioError {
    StudioError::misuse(format!("[DESIGN] {what}"))
}

/// `text`, checked as at most `parts` identifiers, each between periods: as written.
fn name(text: &str, parts: usize) -> Result<&str> {
    let bad = || refused(&format!("{text} is not a name: write an identifier, or a delimited one in double quotes"));
    let tokens = lex(text).map_err(|_| bad())?;
    let mut identifiers = 0usize;
    let mut want_identifier = true;
    for token in tokens.iter().map(|t| &t.tok).filter(|t| **t != Tok::End) {
        match (want_identifier, token) {
            (true, Tok::Identifier(_)) => identifiers = identifiers.saturating_add(1),
            (false, Tok::Delimiter(".")) => {}
            _ => return Err(bad()),
        }
        want_identifier = !want_identifier;
    }
    if want_identifier || identifiers > parts {
        return Err(bad());
    }
    Ok(text.trim())
}

/// `text` as a character string literal.
fn literal(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

/// `grantee` checked: PUBLIC, or a name.
fn grantee(text: &str) -> Result<String> {
    if text.trim().eq_ignore_ascii_case("PUBLIC") { Ok("PUBLIC".to_owned()) } else { name(text, 1).map(str::to_owned) }
}

/// `value` as SET writes it.
fn setting(value: &SettingValue) -> Result<String> {
    match value {
        SettingValue::Default => Ok("DEFAULT".to_owned()),
        SettingValue::Value { value, integer: true } => {
            let digits = value.strip_prefix('-').unwrap_or(value);
            if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
                return Err(refused("the setting takes a whole number"));
            }
            Ok(value.clone())
        }
        SettingValue::Value { value, integer: false } => {
            if value.chars().count() > MAX_VALUE_CHARS || value.chars().any(char::is_control) {
                return Err(refused("a setting's value is at most 4096 characters, none of them control"));
            }
            Ok(literal(value))
        }
    }
}

/// `privileges`, written: none refused.
fn privileges(privileges: &[Privilege]) -> Result<String> {
    if privileges.is_empty() {
        return Err(refused("choose a privilege at least"));
    }
    let written: Vec<&str> = privileges.iter().map(|p| p.sql()).collect();
    Ok(written.join(", "))
}

/// `password`, checked: of 1 to 1024 characters, none control.
fn password(password: &str) -> Result<Secret> {
    let count = password.chars().count();
    if !(1..=1024).contains(&count) || password.chars().any(char::is_control) {
        return Err(refused("a password is 1 to 1024 characters, none of them control"));
    }
    Ok(Secret::new(literal(password)))
}

/// The drop behaviour of `cascade`.
fn behaviour(cascade: bool) -> &'static str {
    if cascade { "CASCADE" } else { "RESTRICT" }
}

impl Act {
    /// The statement of the act, a secret, as it holds a password.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of a name that is no identifier, a value not of its
    /// kind, a password out of its bounds, or no privilege chosen.
    pub fn statement(&self) -> Result<Secret> {
        let plain = |s: String| Ok(Secret::new(s));
        match self {
            Act::EndConnection { id } => plain(format!("END CONNECTION {id}")),
            Act::CancelConnection { id } => plain(format!("CANCEL CONNECTION {id}")),
            Act::SetSession { name: n, value } => plain(format!("SET {} = {}", name(n, 8)?, setting(value)?)),
            Act::SetDatabase { name: n, value } => plain(format!("SET DATABASE {} = {}", name(n, 8)?, setting(value)?)),
            Act::CreateUser { name: n, password: p } => {
                Ok(Secret::new(format!("CREATE USER {} PASSWORD {}", name(n, 1)?, password(&p.0)?.expose())))
            }
            Act::ChangePassword { name: n, password: p } => {
                Ok(Secret::new(format!("ALTER USER {} PASSWORD {}", name(n, 1)?, password(&p.0)?.expose())))
            }
            Act::AllowCreateRole { name: n, allowed } => {
                plain(format!("ALTER USER {} {}CREATE ROLE", name(n, 1)?, if *allowed { "" } else { "NO " }))
            }
            Act::DropUser { name: n } => plain(format!("DROP USER {}", name(n, 1)?)),
            Act::CreateRole { name: n } => plain(format!("CREATE ROLE {}", name(n, 1)?)),
            Act::DropRole { name: n, cascade } => plain(format!("DROP ROLE {} {}", name(n, 1)?, behaviour(*cascade))),
            Act::GrantRole { role, grantee: g, admin } => {
                plain(format!("GRANT {} TO {}{}", name(role, 1)?, grantee(g)?, if *admin { " WITH ADMIN OPTION" } else { "" }))
            }
            Act::RevokeRole { role, grantee: g, cascade } => {
                plain(format!("REVOKE {} FROM {} {}", name(role, 1)?, grantee(g)?, behaviour(*cascade)))
            }
            Act::GrantPrivileges { privileges: p, table, grantee: g, grant_option } => plain(format!(
                "GRANT {} ON TABLE {} TO {}{}",
                privileges(p)?,
                name(table, 3)?,
                grantee(g)?,
                if *grant_option { " WITH GRANT OPTION" } else { "" }
            )),
            Act::RevokePrivileges { privileges: p, table, grantee: g, cascade } => {
                plain(format!("REVOKE {} ON TABLE {} FROM {} {}", privileges(p)?, name(table, 3)?, grantee(g)?, behaviour(*cascade)))
            }
        }
    }
}

/// Runs `act` on `connection` through its guards: what it gave, or what
/// to confirm, unless `confirmed`.
///
/// # Errors
///
/// SQLCODE -910 of an act out of its bounds; the guards' refusal, or the
/// server's.
pub fn run(manager: &ConnectionManager, connection: ConnectionId, act: &Act, confirmed: bool) -> Result<RunAnswer> {
    let statement = act.statement()?;
    manager.run(connection, statement.expose(), confirmed)
}

#[cfg(test)]
mod tests;
