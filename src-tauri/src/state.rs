//! What the application holds while it runs (RULES.md D1, D24): the
//! connection manager, the saved connections and the folder of Studio's
//! files, and the sink that tells the backend's events to the webview.

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};
use turborel_studio_core::connections::manager::ConnectionManager;
use turborel_studio_core::events::{Event, EventSink};
use turborel_studio_core::saved::SavedConnections;
use turborel_studio_core::worksheet::files::Kept;
use turborel_studio_core::worksheet::folders::Files;
use turborel_studio_core::worksheet::history::History;

/// The name of the event every backend event is sent as.
pub const EVENT: &str = "studio:event";
/// The folder of the application's cache that results are spooled in.
pub const RESULTS_DIR: &str = "results";

/// Whether passwords can be kept in the keychain, and why not if not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeychainStatus {
    /// Whether the operating system's keychain is open.
    pub available: bool,
    /// Why not, if it is not: a password is then kept until Studio closes.
    pub reason: Option<String>,
}

/// The application's state.
pub struct Studio {
    /// Every open connection.
    pub connections: Arc<ConnectionManager>,
    /// The saved connections.
    pub saved: Arc<SavedConnections>,
    /// The folder of Studio's settings and layout, its user's alone.
    pub config: PathBuf,
    /// Whether the keychain is open.
    pub keychain: KeychainStatus,
    /// The history of what ran.
    pub history: Arc<History>,
    /// The worksheets and favourite queries kept.
    pub kept: Kept,
    /// The files worksheets may read and write.
    pub files: Arc<Files>,
    /// The window's failures' log.
    pub failures: Arc<turborel_studio_core::failures::Failures>,
    /// The assistant's conversations, settings, policies and log.
    pub assistant: Arc<turborel_studio_core::assistant::service::Service>,
    /// Live Sessions.
    pub live: Arc<turborel_studio_core::live::service::LiveService>,
    /// When the window was last asked how to end open transactions as the
    /// user quit, if it was (RULES.md D59).
    pub quit_asked: std::sync::Mutex<Option<std::time::Instant>>,
    /// The invitation's link the platform last opened Studio by, until the
    /// window takes it, as it may before its page has loaded (RULES.md D66).
    pub link: std::sync::Mutex<Option<turborel_studio_core::live::link::LinkOpened>>,
}

/// Tells the backend's events to the webview.
pub struct WebviewEvents<R: Runtime>(pub AppHandle<R>);

impl<R: Runtime> EventSink for WebviewEvents<R> {
    fn emit(&self, event: Event) {
        // A window closing as an event is sent needs it no more.
        let _ = self.0.emit(EVENT, event);
    }
}
