//! The routine debugger's commands (RULES.md D73): a debugging connection
//! opened beside a connection and attached to its session, what it is
//! asked, its end, and the text of the routine or trigger it shows.
#![allow(clippy::unreachable, reason = "tauri::command's expansion of an async command")]

use tauri::State;
use turborel_studio_core::catalog::Catalog;
use turborel_studio_core::debugging::{DebugAnswer, DebugAsk, RoutineOf, RoutineText, routine_text};
use turborel_studio_core::error::Result;
use turborel_studio_core::events::ConnectionId;

use crate::commands::catalog::{MAX_NAME_CHARS, bounded};
use crate::commands::connections::blocking;
use crate::state::Studio;

/// The longest condition of a breakpoint, in characters.
const MAX_CONDITION_CHARS: usize = 4_096;

/// A debugging connection opened beside `connection`, attached to its
/// session: its number.
#[tauri::command]
pub(crate) async fn debug_start(studio: State<'_, Studio>, connection: ConnectionId) -> Result<ConnectionId> {
    blocking(&studio, move |m| m.debug_start(connection).map(|o| o.connection)).await
}

/// What debugging connection `debugger` answers `ask`.
#[tauri::command]
pub(crate) async fn debug_ask(studio: State<'_, Studio>, debugger: ConnectionId, ask: DebugAsk) -> Result<DebugAnswer> {
    if let DebugAsk::Break(b) = &ask {
        bounded("a schema", &b.schema, MAX_NAME_CHARS)?;
        bounded("a routine", &b.name, MAX_NAME_CHARS)?;
        if let Some(condition) = &b.condition {
            bounded("a condition", &condition.replace(['\n', '\t'], " "), MAX_CONDITION_CHARS)?;
        }
    }
    blocking(&studio, move |m| m.debug(debugger, ask.into())).await
}

/// Debugging connection `debugger` detached, its target going on, and closed.
#[tauri::command]
pub(crate) async fn debug_stop(studio: State<'_, Studio>, debugger: ConnectionId) -> Result<()> {
    blocking(&studio, move |m| m.debug_stop(debugger)).await
}

/// The text the debugger shows of `routine`: of a routine by its specific
/// name, or of a trigger on its table.
#[tauri::command]
pub(crate) async fn debug_text(studio: State<'_, Studio>, connection: ConnectionId, routine: RoutineOf) -> Result<RoutineText> {
    bounded("a schema", &routine.schema, MAX_NAME_CHARS)?;
    bounded("a routine", &routine.name, MAX_NAME_CHARS)?;
    if let Some(t) = &routine.table {
        bounded("a table", t, MAX_NAME_CHARS)?;
    }
    blocking(&studio, move |m| {
        routine_text(&Catalog::of(m, connection), (routine.kind, &routine.schema, &routine.name), routine.table.as_deref())
    })
    .await
}
