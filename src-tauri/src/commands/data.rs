//! Data brought in (RULES.md D43): a CSV or tab-separated file the
//! platform's dialog chooses, previewed, and its rows imported into a
//! table, each through the backend, so the webview reaches no file system
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
use turborel_studio_core::error::{Result, StudioError};
use turborel_studio_core::events::ConnectionId;

use crate::commands::connections::blocking;
use crate::state::Studio;

/// The extensions of the files offered for import, and their filter's name.
const IMPORT_FILES: (&str, [&str; 3]) = ("CSV and tab-separated text", ["csv", "tsv", "txt"]);

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
