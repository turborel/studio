//! The commands the webview calls (RULES.md D1, R-SEC-5). Each is listed in
//! `build.rs` and granted in `capabilities/main.json`; each hands its
//! arguments to the backend, which validates them before it does anything
//! (R-SEC-6).

mod catalog;
pub(crate) mod connections;
pub(crate) mod data;
mod files;
mod preferences;
mod saved;
mod worksheet;

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
#[expect(clippy::too_many_lines, reason = "R-SIZE-1 deviation: generate_handler! takes every command in one list, a line each")]
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
        connections::result_value,
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
        preferences::save_layout,
        preferences::forget_layout,
        preferences::set_aside_notices,
        preferences::log_failure,
        catalog::catalog_schemas,
        catalog::catalog_objects,
        catalog::catalog_table,
        catalog::catalog_routine,
        catalog::catalog_type,
        catalog::catalog_graphs,
        catalog::catalog_usage,
        catalog::catalog_security,
        catalog::catalog_dependencies,
        catalog::catalog_search,
        catalog::catalog_definition,
        files::save_text_file,
        files::export_query,
        files::save_binary_file,
        files::open_model_file,
        data::choose_import_file,
        data::preview_import,
        data::import_rows,
        files::notify_finished,
        worksheet::sql_words,
        worksheet::split_script,
        worksheet::statement_scope,
        worksheet::judge_script,
        worksheet::statement_parameters,
        worksheet::search_history,
        worksheet::record_history,
        worksheet::clear_history,
        worksheet::load_worksheets,
        worksheet::keep_worksheets,
        worksheet::list_queries,
        worksheet::keep_query,
        worksheet::forget_query,
        worksheet::open_sql_file,
        worksheet::read_sql_file,
        worksheet::write_sql_file,
        worksheet::project_folders,
        worksheet::add_project_folder,
        worksheet::remove_project_folder,
        worksheet::project_files
    ]
}
