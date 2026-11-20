//! A connection's session as the status bar shows it
//! (`[CLIENT What the server tells]`, `[DOC client/05-protocol.md Status 'T']`):
//! the statuses the server told, with no round trip; whether a
//! transaction is active; and how the connection is secured (R-SEC-3).

use std::io::{Read, Write};

use serde::Serialize;
use turborel_client::connection::Connection;
use turborel_client::target::Target;

/// The status names Studio shows, as the server tells them.
pub mod status {
    /// The server's product and version.
    pub const SERVER_VERSION: &str = "SERVER_VERSION";
    /// The session's current authorization identifier.
    pub const AUTHORIZATION: &str = "AUTHORIZATION";
    /// The session's default schema.
    pub const SCHEMA: &str = "SCHEMA";
    /// YES if the session's transaction is READ ONLY.
    pub const READ_ONLY: &str = "READ_ONLY";
    /// YES if the server takes no changes, as a replica.
    pub const SERVER_READ_ONLY: &str = "SERVER_READ_ONLY";
    /// The database's catalog.
    pub const CATALOG: &str = "CATALOG";
    /// YES if the session's user is the database's owner.
    pub const OWNER: &str = "OWNER";
    /// The value of a status that is true.
    pub const YES: &str = "YES";
}

/// How a connection reaches its server (R-SEC-3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Transport {
    /// Over TLS.
    Tls,
    /// Over a Unix socket, or a named pipe on Windows: its machine alone.
    Local,
    /// Over plain TCP: not secure, as the status bar says plainly.
    Plain,
}

impl Transport {
    /// How `target` reaches its server.
    pub fn of(target: Option<&Target>) -> Transport {
        match target {
            Some(t) if t.is_tls() => Transport::Tls,
            Some(t) if t.is_plain_tcp() => Transport::Plain,
            Some(_) => Transport::Local,
            None => Transport::Plain,
        }
    }
}

/// A session's transaction, as the status bar shows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    /// Whether it is active.
    pub active: bool,
    /// Whether each statement is its own transaction.
    pub autocommit: bool,
    /// Whether it is READ ONLY.
    pub read_only: bool,
}

/// A connection's session, as the status bar shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    /// The server's product and version.
    pub server: String,
    /// The session's current authorization identifier.
    pub authorization: String,
    /// Its default schema, as told.
    pub schema: Option<String>,
    /// The database's catalog, as told.
    pub catalog: Option<String>,
    /// Its transaction.
    pub transaction: Transaction,
    /// Whether the server takes no changes, as a replica.
    pub server_read_only: bool,
    /// Whether the session's user is the database's owner.
    pub owner: bool,
    /// How the connection reaches the server.
    pub transport: Transport,
    /// Whether the connection is lost, and takes no more.
    pub lost: bool,
}

impl SessionState {
    /// The session of `connection`, as the server last told it.
    pub fn of<S: Read + Write>(connection: &Connection<S>) -> SessionState {
        let told = |name: &str| connection.setting(name).filter(|v| !v.is_empty()).map(str::to_owned);
        let yes = |name: &str| connection.setting(name) == Some(status::YES);
        SessionState {
            server: connection.server().to_owned(),
            authorization: connection.authorization().to_owned(),
            schema: told(status::SCHEMA),
            catalog: told(status::CATALOG),
            transaction: Transaction {
                active: connection.in_transaction(),
                autocommit: connection.autocommit(),
                read_only: yes(status::READ_ONLY),
            },
            server_read_only: yes(status::SERVER_READ_ONLY),
            owner: yes(status::OWNER),
            transport: Transport::of(connection.target()),
            lost: connection.is_lost(),
        }
    }
}
