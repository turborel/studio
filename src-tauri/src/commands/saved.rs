//! The commands of saved connections (RULES.md D28, R-SEC-1): their list,
//! saving and deleting them, and opening one by its settings and the
//! password the keychain keeps, or the embedded database it names. The webview is told whether a password is
//! saved, never the password.

// `tauri::command`'s expansion of an async command holds an `unreachable!`
// of its own, which no code here writes.
#![allow(clippy::unreachable, reason = "tauri::command's expansion of an async command")]

use std::sync::Arc;

use tauri::State;
use turborel_studio_core::connections::manager::Opened;
use turborel_studio_core::error::{Result, StudioError};
use turborel_studio_core::guard::policy::Guards;
use turborel_studio_core::saved::{PasswordChange, SavedConnection, SavedConnections, SavedList};
use turborel_studio_core::secret::Secret;

use crate::commands::connections::environment;
use crate::commands::embedded::saved_directories;
use crate::state::{KeychainStatus, Studio};

/// Runs `work` with the saved connections on a blocking thread: the
/// keychain may wait on the user.
async fn saved<T: Send + 'static>(
    studio: &State<'_, Studio>,
    work: impl FnOnce(&SavedConnections) -> Result<T> + Send + 'static,
) -> Result<T> {
    let saved = Arc::clone(&studio.saved);
    tauri::async_runtime::spawn_blocking(move || work(&saved))
        .await
        .map_err(|e| StudioError::misuse(format!("[DESIGN] the request did not finish: {e}")))?
}

/// Every saved connection, and whether each has a password saved.
#[tauri::command]
pub(crate) async fn list_saved_connections(studio: State<'_, Studio>) -> Result<SavedList> {
    saved(&studio, SavedConnections::list).await
}

/// Saves a connection, new if its identifier is empty, its password as
/// `password` says.
/// An embedded database's directories must be ones the user chose, or
/// those it was saved with (RULES.md D59).
#[tauri::command]
pub(crate) async fn save_connection(
    studio: State<'_, Studio>,
    connection: SavedConnection,
    password: PasswordChange,
) -> Result<SavedConnection> {
    let files = Arc::clone(&studio.files);
    saved(&studio, move |s| {
        if let Some(now) = &connection.embedded {
            let before = if connection.id.is_empty() { None } else { s.get(&connection.id).ok().and_then(|c| c.embedded) };
            saved_directories(&files, before.as_ref(), now)?;
        }
        s.save(connection, password)
    })
    .await
}

/// Deletes a saved connection, and forgets its password.
#[tauri::command]
pub(crate) async fn delete_saved_connection(studio: State<'_, Studio>, id: String) -> Result<()> {
    saved(&studio, move |s| s.delete(&id)).await
}

/// Opens a saved connection: by its settings, proving the password given,
/// else the one the keychain keeps; or the embedded database it names,
/// opened, never made; its guards its environment's.
#[tauri::command]
pub(crate) async fn open_saved_connection(studio: State<'_, Studio>, id: String, password: Option<String>) -> Result<Opened> {
    let (saved, manager) = (Arc::clone(&studio.saved), Arc::clone(&studio.connections));
    tauri::async_runtime::spawn_blocking(move || {
        let connection = saved.get(&id)?;
        let guards = Guards { environment: connection.environment, read_only: connection.read_only };
        if let Some(embedded) = &connection.embedded {
            let opened = manager.open_embedded(&embedded.spec(), guards)?;
            saved.used(&id)?;
            return Ok(opened);
        }
        let password = match password {
            Some(text) => Some(Secret::new(text)),
            None => saved.password(&id)?,
        };
        let opened = manager.open((&connection.spec, guards), password.as_ref(), environment)?;
        saved.used(&id)?;
        Ok(opened)
    })
    .await
    .map_err(|e| StudioError::misuse(format!("[DESIGN] the request did not finish: {e}")))?
}

/// Whether the keychain is open, and why not if not.
#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri gives a command its state by value")]
pub(crate) fn keychain_status(studio: State<'_, Studio>) -> KeychainStatus {
    studio.keychain.clone()
}
