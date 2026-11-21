//! Data brought in (RULES.md D43, D62, D63): a CSV, tab-separated, JSON or
//! Excel file the platform's dialog chooses, previewed, and its rows
//! imported into a table, or the import cancelled; a `.sql` file scanned, run and cancelled, and its log saved;
//! each through the backend, so the webview reaches no file system
//! (R-SEC-5): a file is read only if the user chose it this session.

// `tauri::command`'s expansion of an async command holds an `unreachable!`
// of its own, which no code here writes.
#![allow(clippy::unreachable, reason = "tauri::command's expansion of an async command")]

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Runtime, State};
use tauri_plugin_dialog::DialogExt;
use turborel_studio_core::connections::imports::{ImportSpec, Preview, Reading, preview};
use turborel_studio_core::connections::manager::ImportAnswer;
use turborel_studio_core::connections::manager::ddlmodel::DdlModel;
use turborel_studio_core::connections::manager::sqlfile::{FileAnswer, FileOptions, FileReport, log_text};
use turborel_studio_core::error::{Result, StudioError};
use turborel_studio_core::events::ConnectionId;
use turborel_studio_core::guard::policy::Confirm;
use turborel_studio_core::worksheet::sqlfile::Scan;

use crate::commands::connections::blocking;
use crate::state::Studio;

/// The extensions of the files offered for import, and their filter's name.
const IMPORT_FILES: (&str, [&str; 7]) =
    ("CSV, tab-separated text, JSON and Excel", ["csv", "tsv", "txt", "json", "ndjson", "jsonl", "xlsx"]);

/// The extensions of the files Run SQL File offers, and their filter's name.
const SQL_FILES: (&str, [&str; 1]) = ("SQL scripts", ["sql"]);

/// Runs `work` off the window's thread.
async fn off_the_window<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| StudioError::misuse(format!("[DESIGN] the request did not finish: {e}")))?
}

/// Asks which file to import: its path, chosen so it may be read this
/// session, or none if the user cancelled.
#[tauri::command]
pub(crate) async fn choose_import_file<R: Runtime>(app: AppHandle<R>, studio: State<'_, Studio>) -> Result<Option<String>> {
    let files = Arc::clone(&studio.files);
    off_the_window(move || {
        let (label, extensions) = IMPORT_FILES;
        let Some(path) = app.dialog().file().add_filter(label, &extensions).blocking_pick_file() else { return Ok(None) };
        let path = path.into_path().map_err(|e| StudioError::misuse(format!("[DESIGN] the path chosen is not a file's: {e}")))?;
        files.choose(&path)?;
        Ok(Some(path.display().to_string()))
    })
    .await
}

/// The first records of `path`, a file chosen, read as `reading` says.
#[tauri::command]
pub(crate) async fn preview_import(studio: State<'_, Studio>, path: String, reading: Reading) -> Result<Preview> {
    let files = Arc::clone(&studio.files);
    off_the_window(move || preview(&files.chosen(&PathBuf::from(path))?, &reading)).await
}

/// Imports the rows of `spec`'s file, one chosen, into its table on
/// `connection`, through its guards: what they ask, unless `confirmed`.
#[tauri::command]
pub(crate) async fn import_rows(
    studio: State<'_, Studio>,
    connection: ConnectionId,
    spec: ImportSpec,
    confirmed: bool,
) -> Result<ImportAnswer> {
    let path = studio.files.chosen(&spec.path)?;
    blocking(&studio, move |m| m.import(connection, ImportSpec { path, ..spec }, confirmed)).await
}

/// Cancels the import running on `connection`.
#[tauri::command]
pub(crate) async fn cancel_import(studio: State<'_, Studio>, connection: ConnectionId) -> Result<()> {
    blocking(&studio, move |m| m.cancel_import(connection)).await
}

/// Asks which `.sql` file to run: its path, chosen so it may be read this
/// session, or none if the user cancelled (RULES.md D62).
#[tauri::command]
pub(crate) async fn choose_sql_file<R: Runtime>(app: AppHandle<R>, studio: State<'_, Studio>) -> Result<Option<String>> {
    let files = Arc::clone(&studio.files);
    off_the_window(move || {
        let (label, extensions) = SQL_FILES;
        let Some(path) = app.dialog().file().add_filter(label, &extensions).blocking_pick_file() else { return Ok(None) };
        let path = path.into_path().map_err(|e| StudioError::misuse(format!("[DESIGN] the path chosen is not a file's: {e}")))?;
        files.choose(&path)?;
        Ok(Some(path.display().to_string()))
    })
    .await
}

/// What the `.sql` file `path`, one chosen, holds, and what `connection`'s
/// guards would ask of it.
#[tauri::command]
pub(crate) async fn scan_sql_file(studio: State<'_, Studio>, connection: ConnectionId, path: String) -> Result<(Scan, Option<Confirm>)> {
    let path = studio.files.chosen(&PathBuf::from(path))?;
    blocking(&studio, move |m| m.scan_file(connection, &path)).await
}

/// Runs the `.sql` file `path`, one chosen, on `connection` as `options`
/// say, through its guards: what they ask, unless `confirmed`.
#[tauri::command]
pub(crate) async fn run_sql_file(
    studio: State<'_, Studio>,
    connection: ConnectionId,
    path: String,
    options: FileOptions,
    confirmed: bool,
) -> Result<FileAnswer> {
    let path = studio.files.chosen(&PathBuf::from(path))?;
    blocking(&studio, move |m| m.run_file(connection, &path, options, confirmed)).await
}

/// Cancels the `.sql` file running on `connection`.
#[tauri::command]
pub(crate) async fn cancel_sql_file(studio: State<'_, Studio>, connection: ConnectionId) -> Result<()> {
    blocking(&studio, move |m| m.cancel_file(connection)).await
}

/// Saves the log of `report`, a run of `path`, one chosen, where the
/// platform's dialog chooses, beside the file at first: the path saved
/// to, or none if the user cancelled.
#[tauri::command]
pub(crate) async fn save_sql_file_log<R: Runtime>(
    app: AppHandle<R>,
    studio: State<'_, Studio>,
    path: String,
    report: FileReport,
) -> Result<Option<String>> {
    let source = studio.files.chosen(&PathBuf::from(path))?;
    let files = Arc::clone(&studio.files);
    off_the_window(move || {
        let name = source.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let mut dialog = app.dialog().file().set_file_name(format!("{name}.log"));
        if let Some(dir) = source.parent() {
            dialog = dialog.set_directory(dir);
        }
        let Some(chosen) = dialog.blocking_save_file() else { return Ok(None) };
        let path = chosen.into_path().map_err(|e| StudioError::misuse(format!("[DESIGN] the path chosen is not a file's: {e}")))?;
        std::fs::write(&path, log_text(&name, &report))
            .map_err(|e| StudioError::misuse(format!("[DESIGN] cannot write {}: {e}", path.display())))?;
        files.choose(&path)?;
        Ok(Some(path.display().to_string()))
    })
    .await
}

/// Imports the DDL script `path`, one chosen, into a model: its
/// definitions run in an in-memory database, its unqualified names of
/// `schema`; the database to read the model of, then close, and what was
/// left out (RULES.md D64).
#[tauri::command]
pub(crate) async fn ddl_model(studio: State<'_, Studio>, path: String, schema: String) -> Result<DdlModel> {
    let path = studio.files.chosen(&PathBuf::from(path))?;
    blocking(&studio, move |m| m.ddl_model(&path, &schema)).await
}
