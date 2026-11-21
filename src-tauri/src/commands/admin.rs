//! Administration's commands (RULES.md D57): a view of the server read,
//! and an act run through the connection's guards, its statement written
//! by the backend; a password reaches no file, history nor log.
#![allow(clippy::unreachable, reason = "tauri::command's expansion of an async command")]

use tauri::State;
use turborel_studio_core::admin::{Act, View, ViewRows, read, run};
use turborel_studio_core::connections::manager::RunAnswer;
use turborel_studio_core::error::Result;
use turborel_studio_core::events::ConnectionId;

use crate::commands::connections::blocking;
use crate::state::Studio;

/// The rows of `view` on `connection`.
#[tauri::command]
pub(crate) async fn admin_view(studio: State<'_, Studio>, connection: ConnectionId, view: View) -> Result<ViewRows> {
    blocking(&studio, move |m| read(m, connection, view)).await
}

/// Runs `act` on `connection` through its guards: what it gave, or what to
/// confirm, unless `confirmed`.
#[tauri::command]
pub(crate) async fn admin_act(studio: State<'_, Studio>, connection: ConnectionId, act: Act, confirmed: bool) -> Result<RunAnswer> {
    blocking(&studio, move |m| run(m, connection, &act, confirmed)).await
}
