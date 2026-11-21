//! Saving text the user asked for to a file (RULES.md D34): the platform's
//! own save dialog, opened by the backend, so the webview reaches no file
//! system (R-SEC-5); the file written is the one the user chose.

// `tauri::command`'s expansion of an async command holds an `unreachable!`
// of its own, which no code here writes.
#![allow(clippy::unreachable, reason = "tauri::command's expansion of an async command")]

use std::sync::Arc;

use tauri::{AppHandle, Runtime, State};
use tauri_plugin_dialog::DialogExt;
use turborel_studio_core::connections::manager::MAX_SQL_BYTES;
use turborel_studio_core::connections::values::{ExportFormat, from_base64};
use turborel_studio_core::error::{Result, StudioError};
use turborel_studio_core::events::ConnectionId;
use turborel_studio_core::worksheet::folders::Opened;

use crate::state::Studio;

/// The longest text saved at once, in bytes.
const MAX_TEXT_BYTES: usize = 64 * 1024 * 1024;
/// The longest name suggested for the file, in characters.
const MAX_NAME_CHARS: usize = 255;

/// Asks where to save `text`, suggesting `name`, and writes it there: the
/// path written, or none if the user cancelled. The file chosen may be
/// written again this session, as a worksheet saved to it is
/// (RULES.md D36).
#[tauri::command]
pub(crate) async fn save_text_file<R: Runtime>(
    app: AppHandle<R>,
    studio: State<'_, Studio>,
    name: String,
    text: String,
) -> Result<Option<String>> {
    if text.len() > MAX_TEXT_BYTES || name.chars().count() > MAX_NAME_CHARS || name.contains(['/', '\\', '\0']) {
        return Err(StudioError::misuse(format!("[DESIGN] a file saved is at most {MAX_TEXT_BYTES} bytes, its name a name alone")));
    }
    let files = Arc::clone(&studio.files);
    tauri::async_runtime::spawn_blocking(move || {
        let Some(chosen) = app.dialog().file().set_file_name(name).blocking_save_file() else {
            return Ok(None);
        };
        let path = chosen.into_path().map_err(|e| StudioError::misuse(format!("[DESIGN] the path chosen is not a file's: {e}")))?;
        std::fs::write(&path, text).map_err(|e| StudioError::misuse(format!("[DESIGN] cannot write {}: {e}", path.display())))?;
        files.choose(&path)?;
        Ok(Some(path.display().to_string()))
    })
    .await
    .map_err(|e| StudioError::misuse(format!("[DESIGN] the request did not finish: {e}")))?
}

/// The extension of a model's file, and its filter's name (RULES.md D46).
const MODEL_FILES: (&str, &str) = ("json", "Turborel Studio model");
/// The longest file of octets saved at once, in bytes.
const MAX_OCTETS_BYTES: usize = 64 * 1024 * 1024;

/// Asks where to save `octets`, Base64, suggesting `name`, and writes them
/// there, as an image of a diagram is saved: the path written, or none if
/// the user cancelled.
#[tauri::command]
pub(crate) async fn save_binary_file<R: Runtime>(
    app: AppHandle<R>,
    studio: State<'_, Studio>,
    name: String,
    octets: String,
) -> Result<Option<String>> {
    if octets.len() > MAX_OCTETS_BYTES || name.chars().count() > MAX_NAME_CHARS || name.contains(['/', '\\', '\0']) {
        return Err(StudioError::misuse(format!("[DESIGN] a file saved is at most {MAX_OCTETS_BYTES} bytes, its name a name alone")));
    }
    let bytes = from_base64(&octets)?;
    let files = Arc::clone(&studio.files);
    tauri::async_runtime::spawn_blocking(move || {
        let Some(chosen) = app.dialog().file().set_file_name(name).blocking_save_file() else {
            return Ok(None);
        };
        let path = chosen.into_path().map_err(|e| StudioError::misuse(format!("[DESIGN] the path chosen is not a file's: {e}")))?;
        std::fs::write(&path, bytes).map_err(|e| StudioError::misuse(format!("[DESIGN] cannot write {}: {e}", path.display())))?;
        files.choose(&path)?;
        Ok(Some(path.display().to_string()))
    })
    .await
    .map_err(|e| StudioError::misuse(format!("[DESIGN] the request did not finish: {e}")))?
}

/// Asks which model to open, and reads it: none if the user cancelled.
#[tauri::command]
pub(crate) async fn open_model_file<R: Runtime>(app: AppHandle<R>, studio: State<'_, Studio>) -> Result<Option<Opened>> {
    let files = Arc::clone(&studio.files);
    tauri::async_runtime::spawn_blocking(move || {
        let (extension, label) = MODEL_FILES;
        let Some(path) = app.dialog().file().add_filter(label, &[extension]).blocking_pick_file() else { return Ok(None) };
        let path = path.into_path().map_err(|e| StudioError::misuse(format!("[DESIGN] the path chosen is not a file's: {e}")))?;
        files.choose(&path)?;
        files.read(&path).map(Some)
    })
    .await
    .map_err(|e| StudioError::misuse(format!("[DESIGN] the request did not finish: {e}")))?
}

/// How a query's rows are exported: CSV, or Turborel's native rows.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ExportKind {
    /// A header of the columns' names, then a record of each row.
    Csv,
    /// The protocol's own frames, every value as it was.
    Native,
}

/// The extension of each kind's file, and the name its filter shows.
const EXPORT_FILES: [(&str, &str); 2] = [("csv", "CSV"), ("rows", "Turborel native rows")];

/// A query's rows exported: the file, and how many rows.
#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct Exported {
    /// The file written.
    path: String,
    /// The rows written.
    rows: u64,
}

/// What to export: the query `sql` on `connection`, as `kind` says, to a
/// file the dialog suggests `name` for.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExportRequest {
    connection: ConnectionId,
    sql: String,
    kind: ExportKind,
    name: String,
}

/// Asks where to export the rows of `request`'s query, and runs it, its
/// rows written to the file as they come: the file and the rows, or none
/// if the user cancelled (RULES.md D39).
#[tauri::command]
pub(crate) async fn export_query<R: Runtime>(
    app: AppHandle<R>,
    studio: State<'_, Studio>,
    request: ExportRequest,
) -> Result<Option<Exported>> {
    let ExportRequest { connection, sql, kind, name } = request;
    if sql.len() > MAX_SQL_BYTES || name.chars().count() > MAX_NAME_CHARS || name.contains(['/', '\\', '\0']) {
        return Err(StudioError::misuse(format!(
            "[DESIGN] a query exported is at most {MAX_SQL_BYTES} bytes, its file's name a name alone"
        )));
    }
    let manager = Arc::clone(&studio.connections);
    tauri::async_runtime::spawn_blocking(move || {
        let ((extension, label), format) = match kind {
            ExportKind::Csv => (EXPORT_FILES[0], ExportFormat::Csv),
            ExportKind::Native => (EXPORT_FILES[1], ExportFormat::Native),
        };
        let dialog = app.dialog().file().add_filter(label, &[extension]).set_file_name(format!("{name}.{extension}"));
        let Some(chosen) = dialog.blocking_save_file() else {
            return Ok(None);
        };
        let path = chosen.into_path().map_err(|e| StudioError::misuse(format!("[DESIGN] the path chosen is not a file's: {e}")))?;
        let rows = manager.export(connection, &sql, (&path, format))?;
        Ok(Some(Exported { path: path.display().to_string(), rows }))
    })
    .await
    .map_err(|e| StudioError::misuse(format!("[DESIGN] the request did not finish: {e}")))?
}

/// The longest title or body of a notification, in characters.
const MAX_NOTICE_CHARS: usize = 500;

/// Tells the user, by the platform's notification, that a run they began
/// has finished, as the window asks while it is in the background.
#[tauri::command]
#[expect(clippy::needless_pass_by_value, reason = "a command's arguments are its own, as Tauri gives them")]
pub(crate) fn notify_finished<R: Runtime>(app: AppHandle<R>, title: String, body: String) -> Result<()> {
    use tauri_plugin_notification::NotificationExt;
    if title.chars().count() > MAX_NOTICE_CHARS || body.chars().count() > MAX_NOTICE_CHARS {
        return Err(StudioError::misuse(format!("[DESIGN] a notification is at most {MAX_NOTICE_CHARS} characters")));
    }
    app.notification().builder().title(title).body(body).show().map_err(|e| StudioError::misuse(format!("[DESIGN] cannot notify: {e}")))
}
