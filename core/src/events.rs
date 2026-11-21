//! What the backend tells the front end unasked (RULES.md D1): a notice
//! as it comes, a session's change, and a connection lost. The
//! application sends each to the webview; the tests keep them.

use std::sync::Mutex;

use serde::Serialize;

use crate::connections::session::SessionState;
use crate::error::{DiagnosticsView, StudioError};

/// A connection's number, as the manager gives it.
pub type ConnectionId = u64;

/// Something the front end is told.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Event {
    /// A warning or notice a statement raised (`[CLIENT What the server tells]`).
    #[serde(rename_all = "camelCase")]
    Notice {
        /// The connection.
        connection: ConnectionId,
        /// Its SQLSTATE.
        sqlstate: String,
        /// What it says.
        message: String,
        /// What it is about.
        diagnostics: DiagnosticsView,
    },
    /// A session changed, as by a statement or a reconnection.
    #[serde(rename_all = "camelCase")]
    Session {
        /// The connection.
        connection: ConnectionId,
        /// Its session now.
        session: SessionState,
    },
    /// How far a `.sql` file run on a connection has come (RULES.md D62).
    #[serde(rename_all = "camelCase")]
    SqlFile {
        /// The connection.
        connection: ConnectionId,
        /// How far it has come.
        progress: crate::connections::manager::sqlfile::FileProgress,
    },
    /// A connection was lost: it takes no more until it is reconnected.
    #[serde(rename_all = "camelCase")]
    Lost {
        /// The connection.
        connection: ConnectionId,
        /// Why.
        error: StudioError,
    },
    /// What happens in a turn of an assistant's conversation (RULES.md D55).
    #[serde(rename_all = "camelCase")]
    Assistant {
        /// The conversation.
        conversation: String,
        /// What happened.
        event: crate::assistant::turn::TurnEvent,
    },
    /// A question of an assistant's turn, which waits for the user's answer.
    #[serde(rename_all = "camelCase")]
    AssistantAsks {
        /// The conversation.
        conversation: String,
        /// The question's number, which the answer names.
        id: u64,
        /// The question.
        question: crate::assistant::turn::Question,
    },
    /// What happens at the session this Studio hosts (RULES.md D56).
    #[serde(rename_all = "camelCase")]
    LiveHost {
        /// What happened.
        event: turborel_studio_live::host::HostEvent,
    },
    /// What happens to this Studio as a guest of a session.
    #[serde(rename_all = "camelCase")]
    LiveGuest {
        /// What happened.
        event: turborel_studio_live::guest::GuestEvent,
    },
    /// The user asked to quit: the window asks how each open transaction
    /// ends, then quits (RULES.md D59).
    QuitAsked,
}

/// What the backend tells its events to.
pub trait EventSink: Send + Sync {
    /// Tells `event`.
    fn emit(&self, event: Event);
}

/// The one stream of the backend's events, told to every sink that
/// listens: the webview, and the tests' sinks (RULES.md D24).
#[derive(Default)]
pub struct Hub(std::sync::RwLock<Vec<std::sync::Arc<dyn EventSink>>>);

impl std::fmt::Debug for Hub {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Hub").finish_non_exhaustive()
    }
}

impl Hub {
    /// Adds `sink`, told every event from now on.
    pub fn listen(&self, sink: std::sync::Arc<dyn EventSink>) {
        if let Ok(mut sinks) = self.0.write() {
            sinks.push(sink);
        }
    }
}

impl EventSink for Hub {
    fn emit(&self, event: Event) {
        if let Ok(sinks) = self.0.read() {
            for sink in sinks.iter() {
                sink.emit(event.clone());
            }
        }
    }
}

/// A sink that keeps what it is told, for a test to read.
#[derive(Debug, Default)]
pub struct KeptEvents(Mutex<Vec<Event>>);

impl KeptEvents {
    /// The events told so far, taken.
    pub fn take(&self) -> Vec<Event> {
        self.0.lock().map(|mut kept| std::mem::take(&mut *kept)).unwrap_or_default()
    }
}

impl EventSink for KeptEvents {
    fn emit(&self, event: Event) {
        if let Ok(mut kept) = self.0.lock() {
            kept.push(event);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::{Event, EventSink, Hub, KeptEvents};
    use crate::error::StudioError;

    /// [DESIGN] D24: every sink listening to the hub is told each event, in
    /// the order told.
    #[test]
    fn the_hub_tells_every_sink() {
        let (first, second) = (Arc::new(KeptEvents::default()), Arc::new(KeptEvents::default()));
        let hub = Hub::default();
        hub.listen(first.clone());
        let lost = Event::Lost { connection: 1, error: StudioError::lost("lost") };
        hub.emit(lost.clone());
        hub.listen(second.clone());
        hub.emit(lost.clone());
        assert_eq!(first.take(), [lost.clone(), lost.clone()]);
        assert_eq!(second.take(), [lost]);
    }
}
