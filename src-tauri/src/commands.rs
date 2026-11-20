//! The commands the webview calls (RULES.md D1, R-SEC-5). Each is listed in
//! `build.rs` and granted in `capabilities/main.json`; each hands its
//! arguments to the backend, which validates them before it does anything
//! (R-SEC-6).

pub(crate) mod connections;
mod preferences;
mod saved;

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
    tauri::generate_handler![
        app_info,
        connections::open_connection,
        connections::close_connection,
        connections::reconnect,
        connections::cancel_statement,
        connections::run_statement,
        connections::fetch_rows,
        connections::close_result,
        connections::session_state,
        connections::set_autocommit,
        connections::ping_connection,
        connections::list_threads,
        saved::list_saved_connections,
        saved::save_connection,
        saved::delete_saved_connection,
        saved::open_saved_connection,
        saved::keychain_status,
        preferences::load_settings,
        preferences::save_settings,
        preferences::load_layout,
        preferences::save_layout
    ]
}
