//! What the application holds while it runs (RULES.md D1, D24): the
//! connection manager, and the sink that tells its events to the webview.

use std::sync::Arc;

use tauri::{AppHandle, Emitter, Runtime};
use turborel_studio_core::connections::manager::ConnectionManager;
use turborel_studio_core::events::{Event, EventSink};

/// The name of the event every backend event is sent as.
pub const EVENT: &str = "studio:event";
/// The folder of the application's cache that results are spooled in.
pub const RESULTS_DIR: &str = "results";

/// The application's state.
pub struct Studio {
    /// Every open connection.
    pub connections: Arc<ConnectionManager>,
}

/// Tells the backend's events to the webview.
pub struct WebviewEvents<R: Runtime>(pub AppHandle<R>);

impl<R: Runtime> EventSink for WebviewEvents<R> {
    fn emit(&self, event: Event) {
        // A window closing as an event is sent needs it no more.
        let _ = self.0.emit(EVENT, event);
    }
}
