//! Saving text the user asked for to a file (RULES.md D34): the platform's
//! own save dialog, opened by the backend, so the webview reaches no file
//! system (R-SEC-5); the file written is the one the user chose.

// `tauri::command`'s expansion of an async command holds an `unreachable!`
// of its own, which no code here writes.
#![allow(clippy::unreachable, reason = "tauri::command's expansion of an async command")]

use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;
use turborel_studio_core::error::{Result, StudioError};

/// The longest text saved at once, in bytes.
const MAX_TEXT_BYTES: usize = 64 * 1024 * 1024;
/// The longest name suggested for the file, in characters.
const MAX_NAME_CHARS: usize = 255;

/// Asks where to save `text`, suggesting `name`, and writes it there: the
/// path written, or none if the user cancelled.
#[tauri::command]
pub(crate) async fn save_text_file<R: Runtime>(app: AppHandle<R>, name: String, text: String) -> Result<Option<String>> {
    if text.len() > MAX_TEXT_BYTES || name.chars().count() > MAX_NAME_CHARS || name.contains(['/', '\\', '\0']) {
        return Err(StudioError::misuse(format!("[DESIGN] a file saved is at most {MAX_TEXT_BYTES} bytes, its name a name alone")));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(chosen) = app.dialog().file().set_file_name(name).blocking_save_file() else {
            return Ok(None);
        };
        let path = chosen.into_path().map_err(|e| StudioError::misuse(format!("[DESIGN] the path chosen is not a file's: {e}")))?;
        std::fs::write(&path, text).map_err(|e| StudioError::misuse(format!("[DESIGN] cannot write {}: {e}", path.display())))?;
        Ok(Some(path.display().to_string()))
    })
    .await
    .map_err(|e| StudioError::misuse(format!("[DESIGN] the request did not finish: {e}")))?
}
