//! The commands of connections and statements (RULES.md D1, D24): each
//! hands its arguments to the connection manager, which validates them
//! (R-SEC-6), on Tauri's pool of blocking threads, so the window never
//! waits on a server.

// `tauri::command`'s expansion of an async command holds an `unreachable!`
// of its own, which no code here writes.
#![allow(clippy::unreachable, reason = "tauri::command's expansion of an async command")]

use std::sync::Arc;

use tauri::State;
use turborel_studio_core::connections::manager::{ConnectionManager, Opened, RunAnswer, ThreadInfo};
use turborel_studio_core::connections::outcome::ResultId;
use turborel_studio_core::connections::pages::Page;
use turborel_studio_core::connections::session::SessionState;
use turborel_studio_core::connections::spec::ConnectionSpec;
use turborel_studio_core::error::{Result, StudioError};
use turborel_studio_core::events::ConnectionId;
use turborel_studio_core::guard::policy::Guards;
use turborel_studio_core::secret::Secret;

use crate::state::Studio;

/// Runs `work` with the manager on a blocking thread, and gives its result.
pub(crate) async fn blocking<T: Send + 'static>(
    studio: &State<'_, Studio>,
    work: impl FnOnce(&ConnectionManager) -> Result<T> + Send + 'static,
) -> Result<T> {
    let manager = Arc::clone(&studio.connections);
    tauri::async_runtime::spawn_blocking(move || work(&manager))
        .await
        .map_err(|e| StudioError::misuse(format!("[DESIGN] the request did not finish: {e}")))?
}

/// The process's environment, as turborel-client reads it.
pub(crate) fn environment(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

/// Opens a connection as `spec` says, proving `password` if given. The
/// password goes one way, from the dialog to the backend, and is never
/// given back (R-SEC-1).
#[tauri::command]
pub(crate) async fn open_connection(
    studio: State<'_, Studio>,
    spec: ConnectionSpec,
    guards: Guards,
    password: Option<String>,
) -> Result<Opened> {
    let password = password.map(Secret::new);
    blocking(&studio, move |m| m.open((&spec, guards), password.as_ref(), environment)).await
}

/// Ends a connection.
#[tauri::command]
pub(crate) async fn close_connection(studio: State<'_, Studio>, connection: ConnectionId) -> Result<()> {
    blocking(&studio, move |m| m.close(connection)).await
}

/// Connects a connection again, by the settings it was made by.
#[tauri::command]
pub(crate) async fn reconnect(studio: State<'_, Studio>, connection: ConnectionId) -> Result<SessionState> {
    blocking(&studio, move |m| m.reconnect(connection)).await
}

/// Cancels the statement a connection runs.
#[tauri::command]
pub(crate) async fn cancel_statement(studio: State<'_, Studio>, connection: ConnectionId) -> Result<()> {
    blocking(&studio, move |m| m.cancel(connection)).await
}

/// Runs a statement through its connection's guards: one they ask about
/// runs only once `confirmed` (RULES.md D29).
#[tauri::command]
pub(crate) async fn run_statement(studio: State<'_, Studio>, connection: ConnectionId, sql: String, confirmed: bool) -> Result<RunAnswer> {
    blocking(&studio, move |m| m.run(connection, &sql, confirmed)).await
}

/// Rows of a result.
#[tauri::command]
pub(crate) async fn fetch_rows(
    studio: State<'_, Studio>,
    connection: ConnectionId,
    result: ResultId,
    from: u64,
    count: u32,
) -> Result<Page> {
    blocking(&studio, move |m| m.rows(connection, result, (from, count))).await
}

/// Closes a result.
#[tauri::command]
pub(crate) async fn close_result(studio: State<'_, Studio>, connection: ConnectionId, result: ResultId) -> Result<()> {
    blocking(&studio, move |m| m.close_result(connection, result)).await
}

/// A connection's session.
#[tauri::command]
pub(crate) async fn session_state(studio: State<'_, Studio>, connection: ConnectionId) -> Result<SessionState> {
    blocking(&studio, move |m| m.session(connection)).await
}

/// Makes each statement its own transaction, or not.
#[tauri::command]
pub(crate) async fn set_autocommit(studio: State<'_, Studio>, connection: ConnectionId, on: bool) -> Result<SessionState> {
    blocking(&studio, move |m| m.set_autocommit(connection, on)).await
}

/// Asks whether a connection's server answers.
#[tauri::command]
pub(crate) async fn ping_connection(studio: State<'_, Studio>, connection: ConnectionId) -> Result<()> {
    blocking(&studio, move |m| m.ping(connection)).await
}

/// The connections' worker threads, by name (R-SAFE-5).
#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri gives a command its state by value")]
pub(crate) fn list_threads(studio: State<'_, Studio>) -> Vec<ThreadInfo> {
    studio.connections.threads()
}
