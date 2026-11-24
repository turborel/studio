//! A debugger's calls, as its worker makes them (RULES.md D73): on a
//! server's connection by turborel-client's debugger, granted `debugger`;
//! on an embedded database's session by the `turborel` crate's own,
//! attached to another session of the same database.

use std::time::Duration;

use turborel::catalog::QualifiedName;
use turborel::db::{Debugger, Session};
use turborel_client::agent::Connected;

use crate::debugging::{BreakAt, BreakpointView, DebugAnswer, DebugCall, DebugEvent, MAX_WAIT_MS, PauseView, Target};
use crate::error::{Result, StudioError};

/// The routine `b` names.
fn routine(b: &BreakAt) -> QualifiedName {
    QualifiedName { auth: b.schema.clone(), ident: b.name.clone() }
}

/// At most `ms` milliseconds, at most `MAX_WAIT_MS`.
fn within(ms: u64) -> Duration {
    Duration::from_millis(ms.min(MAX_WAIT_MS))
}

/// The refusal of a call that needs an attached debugger, of a session
/// none is attached to.
fn not_attached() -> StudioError {
    StudioError::misuse("[DESIGN] the debugger is not attached")
}

/// `call` made on the server's connection `connection`.
///
/// # Errors
///
/// The server's: SQLSTATE 42000 of a routine its user holds no DEBUG on,
/// 08003 of a connection of no such ID, TBD01 of a request the target's
/// state refuses; a connection failure.
pub(crate) fn server_call(connection: &mut Connected, call: DebugCall) -> Result<DebugAnswer> {
    let answer = match call {
        DebugCall::Id => DebugAnswer::Id { id: connection.debug_id()? },
        DebugCall::Attach(Target::Server(id)) => connection.debug_attach(id).map(|()| DebugAnswer::Done)?,
        DebugCall::Attach(Target::Embedded(_)) => {
            return Err(StudioError::misuse("[DESIGN] a server's debugger attaches to a server's session"));
        }
        DebugCall::Detach => connection.debug_detach().map(|()| DebugAnswer::Done)?,
        DebugCall::Break(b) => {
            let set = connection.debug_break((b.kind.into(), &routine(&b)), b.line, b.condition.as_deref())?;
            DebugAnswer::Breakpoint(BreakpointView::of(set.number, &set.routine, set.line, set.condition))
        }
        DebugCall::Clear(n) => connection.debug_clear(n).map(|()| DebugAnswer::Done)?,
        DebugCall::Breakpoints => DebugAnswer::Breakpoints {
            breakpoints: connection
                .debug_breakpoints()?
                .into_iter()
                .map(|b| BreakpointView::of(b.number, &b.routine, b.line, b.condition))
                .collect(),
        },
        DebugCall::Resume(step) => connection.debug_resume(step.into()).map(|()| DebugAnswer::Done)?,
        DebugCall::Interrupt => connection.debug_interrupt().map(|()| DebugAnswer::Done)?,
        DebugCall::Stack => DebugAnswer::Stack { paused: connection.debug_stack()?.as_ref().map(PauseView::from) },
        DebugCall::Wait(ms) => DebugAnswer::Event { event: connection.debug_wait(Some(within(ms)))?.as_ref().map(DebugEvent::from) },
    };
    Ok(answer)
}

/// `call` made by `session`, an embedded database's, `debugger` its
/// debugger once attached.
///
/// # Errors
///
/// The database's: SQLCODE -104 of a routine its user holds no DEBUG on,
/// -103 of no such routine or line, TBD01 of a request the target's state
/// refuses; and of a call that needs a debugger none is attached.
pub(crate) fn embedded_call(session: &Session, debugger: &mut Option<Debugger>, call: DebugCall) -> Result<DebugAnswer> {
    let attached = |d: &Option<Debugger>| -> Result<()> { if d.is_some() { Ok(()) } else { Err(not_attached()) } };
    let answer = match call {
        DebugCall::Id => return Err(StudioError::misuse("[DESIGN] an embedded session is attached to by its handle, not an ID")),
        DebugCall::Attach(Target::Embedded(target)) => {
            if debugger.is_some() {
                return Err(StudioError::misuse("[DESIGN] the debugger is attached already"));
            }
            *debugger = Some(session.attach(&target)?);
            DebugAnswer::Done
        }
        DebugCall::Attach(Target::Server(_)) => {
            return Err(StudioError::misuse("[DESIGN] an embedded debugger attaches to an embedded session"));
        }
        DebugCall::Detach => {
            attached(debugger)?;
            if let Some(d) = debugger.take() {
                d.detach();
            }
            DebugAnswer::Done
        }
        DebugCall::Break(b) => {
            let d = debugger.as_ref().ok_or_else(not_attached)?;
            let set = d.break_at(session, (b.kind.into(), &routine(&b)), b.line, b.condition.as_deref())?;
            DebugAnswer::Breakpoint(BreakpointView::of(set.number, &set.routine, set.line, set.condition))
        }
        DebugCall::Clear(n) => debugger.as_ref().ok_or_else(not_attached)?.clear(n).map(|()| DebugAnswer::Done)?,
        DebugCall::Breakpoints => DebugAnswer::Breakpoints {
            breakpoints: debugger
                .as_ref()
                .ok_or_else(not_attached)?
                .breakpoints()?
                .into_iter()
                .map(|b| BreakpointView::of(b.number, &b.routine, b.line, b.condition))
                .collect(),
        },
        DebugCall::Resume(step) => debugger.as_ref().ok_or_else(not_attached)?.resume(step.into()).map(|()| DebugAnswer::Done)?,
        DebugCall::Interrupt => debugger.as_ref().ok_or_else(not_attached)?.interrupt().map(|()| DebugAnswer::Done)?,
        DebugCall::Stack => {
            DebugAnswer::Stack { paused: debugger.as_ref().ok_or_else(not_attached)?.paused()?.as_ref().map(PauseView::from) }
        }
        DebugCall::Wait(ms) => {
            let event = debugger.as_ref().ok_or_else(not_attached)?.wait(session, within(ms))?;
            DebugAnswer::Event { event: event.as_ref().map(DebugEvent::from) }
        }
    };
    Ok(answer)
}
