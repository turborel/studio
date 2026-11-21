//! The platform's plug-ins Studio uses from its backend alone (RULES.md
//! R-SEC-5, D38, D66): each added without the script it would give the webview,
//! as the webview is granted none of their commands. The notification
//! plug-in's script asks, as the page loads, whether notifications are
//! permitted, a command the capability refuses.

use tauri::plugin::{Plugin, TauriPlugin};
use tauri::webview::PageLoadPayload;
use tauri::{AppHandle, RunEvent, Runtime, Url, Webview, Window};

/// A plug-in, all of it but the script it gives each webview, of its
/// configuration `C`.
pub(crate) struct BackendOnly<R: Runtime, C: serde::de::DeserializeOwned = ()>(pub(crate) TauriPlugin<R, C>);

impl<R: Runtime, C: serde::de::DeserializeOwned> Plugin<R> for BackendOnly<R, C> {
    fn name(&self) -> &'static str {
        self.0.name()
    }

    fn initialize(&mut self, app: &AppHandle<R>, config: serde_json::Value) -> Result<(), Box<dyn std::error::Error>> {
        self.0.initialize(app, config)
    }

    // The trait's second form of the script reads this one, so is none too.
    fn initialization_script(&self) -> Option<String> {
        None
    }

    fn window_created(&mut self, window: Window<R>) {
        self.0.window_created(window);
    }

    fn webview_created(&mut self, webview: Webview<R>) {
        self.0.webview_created(webview);
    }

    fn on_navigation(&mut self, webview: &Webview<R>, url: &Url) -> bool {
        self.0.on_navigation(webview, url)
    }

    fn on_page_load(&mut self, webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
        self.0.on_page_load(webview, payload);
    }

    fn on_event(&mut self, app: &AppHandle<R>, event: &RunEvent) {
        self.0.on_event(app, event);
    }

    fn extend_api(&mut self, invoke: tauri::ipc::Invoke<R>) -> bool {
        self.0.extend_api(invoke)
    }
}

#[cfg(test)]
mod tests {
    use tauri::plugin::Plugin;
    use tauri::test::MockRuntime;

    use super::BackendOnly;

    /// [RULE] R-SEC-5: the notification plug-in gives the webview no script,
    /// so nothing in the page calls a command the capability refuses.
    #[test]
    fn the_plugins_give_no_script() {
        let inner: tauri::plugin::TauriPlugin<MockRuntime> = tauri_plugin_notification::init();
        assert!(inner.initialization_script().is_some());
        let wrapped = BackendOnly(inner);
        assert_eq!(wrapped.name(), "notification");
        assert!(wrapped.initialization_script().is_none());
        let dialog = BackendOnly::<MockRuntime>(tauri_plugin_dialog::init());
        assert!(dialog.initialization_script().is_none());
        let links = BackendOnly::<MockRuntime, _>(tauri_plugin_deep_link::init());
        assert_eq!(links.name(), "deep-link");
        assert!(links.initialization_script().is_none());
    }
}
