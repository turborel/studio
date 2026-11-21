//! The commands of embedded databases (RULES.md D59): a database's
//! directory and its keys directory chosen by the platform's dialog and
//! looked at before anything is opened or made, so the webview names no
//! directory the user did not choose (R-SEC-5); the database opened or
//! made, or one in memory; what an embedded connection was given; and
//! Studio's quitting, each open transaction committed or rolled back as
//! the user answered, every database closed.

// `tauri::command`'s expansion of an async command holds an `unreachable!`
// of its own, which no code here writes.
#![allow(clippy::unreachable, reason = "tauri::command's expansion of an async command")]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_dialog::DialogExt;
use turborel_studio_core::connections::manager::{ConnectionManager, EmbeddedInfo, Opened, RunAnswer};
use turborel_studio_core::embedded::{DirectoryCheck, EmbeddedSpec, Place, check, os_user};
use turborel_studio_core::error::{Result, StudioError};
use turborel_studio_core::events::ConnectionId;
use turborel_studio_core::guard::policy::Guards;
use turborel_studio_core::saved::SavedEmbedded;
use turborel_studio_core::worksheet::folders::Files;

use crate::commands::connections::blocking;
use crate::state::Studio;

/// Runs `work` off the window's thread.
async fn off_the_window<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| StudioError::misuse(format!("[DESIGN] the request did not finish: {e}")))?
}

/// A directory chosen, and what it holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectoryChoice {
    /// Its path.
    path: String,
    /// What it holds.
    check: DirectoryCheck,
}

/// Asks the user for a folder, titled `title`: its path, chosen so it may
/// be used this session, or none if the user cancelled.
fn pick_folder<R: Runtime>(app: &AppHandle<R>, files: &Files, title: &str) -> Result<Option<PathBuf>> {
    let Some(path) = app.dialog().file().set_title(title).blocking_pick_folder() else { return Ok(None) };
    let path = path.into_path().map_err(|e| StudioError::misuse(format!("[DESIGN] the path chosen is not a folder's: {e}")))?;
    files.choose(&path)?;
    Ok(Some(path))
}

/// Asks which folder holds a database to open, or is to hold a new one:
/// its path, and what it holds.
#[tauri::command]
pub(crate) async fn choose_database_directory<R: Runtime>(
    app: AppHandle<R>,
    studio: State<'_, Studio>,
    title: String,
) -> Result<Option<DirectoryChoice>> {
    let files = Arc::clone(&studio.files);
    off_the_window(move || {
        let Some(path) = pick_folder(&app, &files, &title)? else { return Ok(None) };
        Ok(Some(DirectoryChoice { check: check(&path), path: path.display().to_string() }))
    })
    .await
}

/// Asks which folder holds an encrypted database's keys: its path, or
/// none if the user cancelled. Studio reads no key itself: the database's
/// keyring reads them as it needs them.
#[tauri::command]
pub(crate) async fn choose_keys_directory<R: Runtime>(app: AppHandle<R>, studio: State<'_, Studio>) -> Result<Option<String>> {
    let files = Arc::clone(&studio.files);
    off_the_window(move || Ok(pick_folder(&app, &files, "Keys Directory")?.map(|p| p.display().to_string()))).await
}

/// What the folder `path`, one chosen, holds now.
#[tauri::command]
pub(crate) async fn check_database_directory(studio: State<'_, Studio>, path: String) -> Result<DirectoryCheck> {
    let files = Arc::clone(&studio.files);
    off_the_window(move || Ok(check(&files.chosen(Path::new(&path))?))).await
}

/// `spec`, its directories each one the user chose this session.
fn chosen(files: &Files, spec: EmbeddedSpec) -> Result<EmbeddedSpec> {
    let place = match spec.place {
        Place::Directory { path } => Place::Directory { path: files.chosen(&path)? },
        Place::Memory => Place::Memory,
    };
    let keys = spec.keys.map(|k| files.chosen(&k)).transpose()?;
    Ok(EmbeddedSpec { place, keys, ..spec })
}

/// Opens or makes the embedded database `spec` says, its directories ones
/// the user chose, or one in memory, under `guards`.
#[tauri::command]
pub(crate) async fn open_embedded(studio: State<'_, Studio>, spec: EmbeddedSpec, guards: Guards) -> Result<Opened> {
    let files = Arc::clone(&studio.files);
    blocking(&studio, move |m| m.open_embedded(&chosen(&files, spec)?, guards)).await
}

/// Checks a saved embedded database's directories are ones the user chose
/// this session, or those it was saved with before (R-SEC-5).
pub(crate) fn saved_directories(files: &Files, before: Option<&SavedEmbedded>, now: &SavedEmbedded) -> Result<()> {
    if before.is_none_or(|b| b.directory != now.directory) {
        files.chosen(&now.directory)?;
    }
    if let Some(keys) = &now.keys
        && before.is_none_or(|b| b.keys.as_ref() != Some(keys))
    {
        files.chosen(keys)?;
    }
    Ok(())
}

/// What the embedded database of `connection` was given; none of a server's.
#[tauri::command]
pub(crate) async fn embedded_info(studio: State<'_, Studio>, connection: ConnectionId) -> Result<Option<EmbeddedInfo>> {
    blocking(&studio, move |m| m.embedded(connection)).await
}

/// The identifier a new database's owner is offered: this machine's user's.
#[tauri::command]
pub(crate) fn default_owner() -> String {
    os_user()
}

/// How quitting ends each open transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Ending {
    /// Committed.
    Commit,
    /// Rolled back.
    Rollback,
}

/// Ends each open transaction of `manager` as `ending` says, then every
/// connection, each embedded database closed with a checkpoint.
pub(crate) fn end_all(manager: &ConnectionManager, ending: Ending) -> Result<()> {
    let statement = match ending {
        Ending::Commit => "COMMIT",
        Ending::Rollback => "ROLLBACK",
    };
    let mut first_failure = None;
    for thread in manager.threads() {
        let active = manager.session(thread.connection).is_ok_and(|s| s.transaction.active);
        if active
            && let Err(e) = manager.run(thread.connection, statement, true).and_then(|a| match a {
                RunAnswer::Ran(_) => Ok(()),
                RunAnswer::Confirm(_) => Err(StudioError::misuse("[DESIGN] the transaction's end asked to be confirmed")),
            })
        {
            first_failure.get_or_insert(e);
        }
    }
    if let Some(e) = first_failure {
        return Err(e);
    }
    manager.close_all();
    Ok(())
}

/// Quits Studio: each open transaction ended as `ending` says, every
/// connection closed, each embedded database with a checkpoint. A commit
/// that fails is told, and Studio stays open.
#[tauri::command]
pub(crate) async fn quit_studio<R: Runtime>(app: AppHandle<R>, studio: State<'_, Studio>, ending: Ending) -> Result<()> {
    blocking(&studio, move |m| end_all(m, ending)).await?;
    app.exit(0);
    Ok(())
}
