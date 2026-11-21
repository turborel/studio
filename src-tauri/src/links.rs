//! Invitations' links (RULES.md D66): Studio's scheme,
//! `turborel-studio`, registered by the deep-link plug-in; each link the
//! platform opens Studio by read by the backend, kept until the window
//! takes it, and told the window, which opens the join dialog filled in.
//! Nothing joins until the user presses Join.

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_deep_link::DeepLinkExt;
use turborel_studio_core::events::Event;
use turborel_studio_core::live::link::opened;

use crate::state::{EVENT, Studio};

/// Brings the main window forward, as a link opened while Studio runs.
pub(crate) fn forward<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        // A window that will not come forward still gets the link.
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Takes in the link `url`: read, kept until the window takes it, and
/// told it.
pub(crate) fn taken_in<R: Runtime>(app: &AppHandle<R>, url: &str) {
    let opened = opened(url);
    if let Some(studio) = app.try_state::<Studio>() {
        *studio.link.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(opened.clone());
    }
    // A window not yet loaded takes the link as it starts.
    let _ = app.emit(EVENT, Event::LiveLink { opened });
    forward(app);
}

/// Listens for the links the platform opens Studio by: the one it was
/// started by, if one, and each after; the scheme registered where the
/// platform registers it as the application runs.
pub(crate) fn listen<R: Runtime>(app: &AppHandle<R>) {
    let links = app.deep_link();
    #[cfg(any(target_os = "linux", windows))]
    {
        // A build not installed, as one run in place, registers it here;
        // where it cannot, links open Studio as the installer registered it.
        let _ = links.register_all();
    }
    if let Ok(Some(urls)) = links.get_current() {
        for url in urls {
            taken_in(app, url.as_str());
        }
    }
    let handle = app.clone();
    links.on_open_url(move |event| {
        for url in event.urls() {
            taken_in(&handle, url.as_str());
        }
    });
}
