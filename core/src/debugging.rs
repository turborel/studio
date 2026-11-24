//! The routine debugger (RULES.md D73): a second connection, the debugger,
//! attached to the session of a connection the user works in, its target,
//! by turborel-client's debugger on a server and by the `turborel` crate's
//! own embedded (Turborel's `user/11-debugging.md`, D1003 to D1036). What a
//! worker is asked of it, and what it answers, as the window is told it:
//! breakpoints by line of a routine's text, a pause's call stack with each
//! frame's parameters, variables and cursors, and how the target goes on.

mod calls;
mod text;

use serde::{Deserialize, Serialize};
use turborel::catalog::QualifiedName;
use turborel::db::DebugTarget;
use turborel::debugger::{Action, CursorShown, Event, Frame, Kind, Named, Paused, Reason};

use crate::connections::cells::cell;

pub(crate) use calls::{embedded_call, server_call};
pub use text::{RoutineText, aligned, routine_text};

/// The longest a worker waits for the debugger's next event at a time, so
/// a request behind it waits no longer.
pub const MAX_WAIT_MS: u64 = 1_000;

/// What kind of routine a breakpoint or a frame is of.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RoutineKind {
    /// An SQL-invoked procedure.
    Procedure,
    /// An SQL-invoked function.
    Function,
    /// A trigger's triggered action.
    Trigger,
}

impl From<RoutineKind> for Kind {
    fn from(k: RoutineKind) -> Kind {
        match k {
            RoutineKind::Procedure => Kind::Procedure,
            RoutineKind::Function => Kind::Function,
            RoutineKind::Trigger => Kind::Trigger,
        }
    }
}

impl From<Kind> for RoutineKind {
    fn from(k: Kind) -> RoutineKind {
        match k {
            Kind::Procedure => RoutineKind::Procedure,
            Kind::Function => RoutineKind::Function,
            Kind::Trigger => RoutineKind::Trigger,
        }
    }
}

/// How a paused target goes on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Step {
    /// To the next statement, into a routine it invokes too.
    Into,
    /// To the next statement of this frame, or of the one it returns to.
    Over,
    /// To the next statement of the frame this one returns to.
    Out,
    /// To the next breakpoint.
    Continue,
}

impl From<Step> for Action {
    fn from(s: Step) -> Action {
        match s {
            Step::Into => Action::Into,
            Step::Over => Action::Over,
            Step::Out => Action::Out,
            Step::Continue => Action::Continue,
        }
    }
}

/// A breakpoint asked for: at line `line` of the routine's text, where
/// `condition`, if given, is true of the paused frame.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakAt {
    /// The routine's kind.
    pub kind: RoutineKind,
    /// Its schema.
    pub schema: String,
    /// Its specific name, or a trigger's name.
    pub name: String,
    /// The line, from 1.
    pub line: u32,
    /// A `<search condition>` over the frame's parameters and variables.
    pub condition: Option<String>,
}

/// A routine or trigger the debugger shows the text of.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineOf {
    /// Its kind.
    pub kind: RoutineKind,
    /// Its schema.
    pub schema: String,
    /// A routine's specific name, or a trigger's name.
    pub name: String,
    /// A trigger's table.
    pub table: Option<String>,
}

/// The session a debugger attaches to.
#[derive(Debug, Clone)]
pub enum Target {
    /// A server's connection, by the ID INFORMATION_SCHEMA.CONNECTIONS shows.
    Server(u64),
    /// An embedded database's session, by what another thread holds of it.
    Embedded(DebugTarget),
}

/// What a debugger's worker is asked.
#[derive(Debug, Clone)]
pub enum DebugCall {
    /// This connection's ID, which a debugger attaches to it by.
    Id,
    /// Attach to the target's session.
    Attach(Target),
    /// Detach, the target going on as if never debugged.
    Detach,
    /// Set a breakpoint.
    Break(BreakAt),
    /// Clear a breakpoint, by its number.
    Clear(u32),
    /// The breakpoints set.
    Breakpoints,
    /// Let the paused target go on.
    Resume(Step),
    /// Pause the running target at its next statement.
    Interrupt,
    /// The target's pause, if it is paused.
    Stack,
    /// The next event, waited for at most so many milliseconds.
    Wait(u64),
}

/// What the window asks of a debugger, by its `ask`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", tag = "ask")]
pub enum DebugAsk {
    /// Set a breakpoint.
    Break(BreakAt),
    /// Clear a breakpoint.
    Clear {
        /// Its number.
        number: u32,
    },
    /// The breakpoints set.
    Breakpoints,
    /// Let the paused target go on.
    Resume {
        /// How.
        step: Step,
    },
    /// Pause the running target.
    Interrupt,
    /// The target's pause.
    Stack,
    /// The next event.
    Wait {
        /// At most so many milliseconds, at most `MAX_WAIT_MS`.
        ms: u64,
    },
}

impl From<DebugAsk> for DebugCall {
    fn from(ask: DebugAsk) -> DebugCall {
        match ask {
            DebugAsk::Break(b) => DebugCall::Break(b),
            DebugAsk::Clear { number } => DebugCall::Clear(number),
            DebugAsk::Breakpoints => DebugCall::Breakpoints,
            DebugAsk::Resume { step } => DebugCall::Resume(step),
            DebugAsk::Interrupt => DebugCall::Interrupt,
            DebugAsk::Stack => DebugCall::Stack,
            DebugAsk::Wait { ms } => DebugCall::Wait(ms),
        }
    }
}

/// A breakpoint set, as the window shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakpointView {
    /// Its number.
    pub number: u32,
    /// Its routine's schema.
    pub schema: String,
    /// Its routine's specific name, or its trigger's name.
    pub name: String,
    /// Its line, from 1.
    pub line: u32,
    /// Its condition, if it has one.
    pub condition: Option<String>,
}

impl BreakpointView {
    /// The breakpoint of `routine`, at `line`, of `condition`.
    pub(crate) fn of(number: u32, routine: &QualifiedName, line: u32, condition: Option<String>) -> BreakpointView {
        BreakpointView { number, schema: routine.auth.clone(), name: routine.ident.clone(), line, condition }
    }
}

/// A parameter or variable of a frame, and its value as the grid shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValueView {
    /// Its name.
    pub name: String,
    /// Its declared type.
    pub data_type: String,
    /// Its value's text, or none for null.
    pub value: Option<String>,
}

impl From<&Named> for ValueView {
    fn from(n: &Named) -> ValueView {
        ValueView { name: n.name.clone(), data_type: n.data_type.clone(), value: cell(&n.value) }
    }
}

/// A local cursor of a frame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorView {
    /// Its name.
    pub name: String,
    /// Whether it is open.
    pub open: bool,
    /// Its query, as written.
    pub query: String,
}

impl From<&CursorShown> for CursorView {
    fn from(c: &CursorShown) -> CursorView {
        CursorView { name: c.name.clone(), open: c.open, query: c.query.clone() }
    }
}

/// A frame of a paused target's call stack.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameView {
    /// Its routine's kind; none of a statement run directly.
    pub kind: Option<RoutineKind>,
    /// Its routine's schema.
    pub schema: Option<String>,
    /// Its routine's specific name, or its trigger's name.
    pub specific: Option<String>,
    /// Its routine's name.
    pub name: Option<String>,
    /// Whether the debugger may see into it; one it may not shows its name alone.
    pub visible: bool,
    /// Where its statement begins, in characters from the beginning of its routine's text.
    pub at: Option<u64>,
    /// That place's line, from 1.
    pub line: Option<u32>,
    /// That place's column, from 1.
    pub column: Option<u32>,
    /// Its parameters, or a trigger's transition variables.
    pub parameters: Vec<ValueView>,
    /// Its variables in scope, the outermost first.
    pub variables: Vec<ValueView>,
    /// Its local cursors in scope.
    pub cursors: Vec<CursorView>,
}

impl From<&Frame> for FrameView {
    fn from(f: &Frame) -> FrameView {
        let origin = f.origin.as_ref();
        FrameView {
            kind: origin.map(|o| o.kind.into()),
            schema: origin.map(|o| o.name.auth.clone()),
            specific: origin.map(|o| o.name.ident.clone()),
            name: origin.map(|o| o.shown.ident.clone()),
            visible: f.visible,
            at: f.at.and_then(|a| u64::try_from(a).ok()),
            line: f.line.map(|(l, _)| l),
            column: f.line.map(|(_, c)| c),
            parameters: f.parameters.iter().map(ValueView::from).collect(),
            variables: f.variables.iter().map(ValueView::from).collect(),
            cursors: f.cursors.iter().map(CursorView::from).collect(),
        }
    }
}

/// A pause: the breakpoint it is at, if any, and the call stack, the
/// innermost frame first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PauseView {
    /// The breakpoint's number, if it paused at one; none at a step's end.
    pub breakpoint: Option<u32>,
    /// The frames, the paused statement's first.
    pub frames: Vec<FrameView>,
}

impl From<&Paused> for PauseView {
    fn from(p: &Paused) -> PauseView {
        let breakpoint = match p.reason {
            Reason::Breakpoint(n) => Some(n),
            Reason::Step => None,
        };
        PauseView { breakpoint, frames: p.frames.iter().rev().map(FrameView::from).collect() }
    }
}

/// What the debugger hears of its target, as the window is told it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum DebugEvent {
    /// It paused.
    Paused(PauseView),
    /// It went on by itself, paused past DEBUGGER.PAUSE_TIMEOUT_MS.
    TimedOut,
    /// Its statement was cancelled while it was paused.
    Cancelled,
    /// Its session ended, and the debugger is detached.
    Ended,
}

impl From<&Event> for DebugEvent {
    fn from(e: &Event) -> DebugEvent {
        match e {
            Event::Paused(p) => DebugEvent::Paused(p.into()),
            Event::TimedOut => DebugEvent::TimedOut,
            Event::Cancelled => DebugEvent::Cancelled,
            Event::Ended => DebugEvent::Ended,
        }
    }
}

/// What a debugger's worker answers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum DebugAnswer {
    /// A connection's ID.
    Id {
        /// The ID.
        id: u64,
    },
    /// Done.
    Done,
    /// A breakpoint set.
    Breakpoint(BreakpointView),
    /// The breakpoints set.
    Breakpoints {
        /// Each.
        breakpoints: Vec<BreakpointView>,
    },
    /// The target's pause, if it is paused.
    Stack {
        /// The pause.
        paused: Option<PauseView>,
    },
    /// The next event, if one came in time.
    Event {
        /// The event.
        event: Option<DebugEvent>,
    },
}

#[cfg(test)]
mod tests;
