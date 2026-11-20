//! The commands the webview calls (RULES.md D1, R-SEC-5). Each is listed in
//! `build.rs` and granted in `capabilities/main.json`; each validates its
//! arguments before it does anything (R-SEC-6).

use tauri::Runtime;
use tauri::ipc::Invoke;
use turborel_studio_core::version::{AppInfo, app_info as info};

/// What the About box shows: Studio's version and the Turborel commit its
/// client is built from.
#[tauri::command]
fn app_info() -> AppInfo {
    info()
}

/// The handler of every command, for the application's builder.
pub(crate) fn handler<R: Runtime>() -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![app_info]
}
