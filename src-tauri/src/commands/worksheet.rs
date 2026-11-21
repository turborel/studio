//! The commands of worksheets (RULES.md D36): a script split and judged,
//! a statement's parameters, the history, the worksheets and favourite
//! queries kept, and the `.sql` files the user chose or a project holds.

// `tauri::command`'s expansion of an async command holds an `unreachable!`
// of its own, which no code here writes.
#![allow(clippy::unreachable, reason = "tauri::command's expansion of an async command")]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Runtime, State};
use tauri_plugin_dialog::DialogExt;
use turborel_studio_core::error::{Result, StudioError};
use turborel_studio_core::events::ConnectionId;
use turborel_studio_core::guard::policy::Confirm;
use turborel_studio_core::worksheet::files::{Query, Worksheet};
use turborel_studio_core::worksheet::folders::{Opened, SQL_EXTENSION};
use turborel_studio_core::worksheet::history::Entry;
use turborel_studio_core::worksheet::scope::{Scope, scope};
use turborel_studio_core::worksheet::script::{Piece, byte_at, key_words, pieces};

use crate::commands::connections::blocking;
use crate::state::Studio;

/// The most history entries given at once.
const MAX_HISTORY_GIVEN: usize = 1000;
/// The longest text the history is searched for, in characters.
const MAX_SEARCH_CHARS: usize = 256;
/// What the dialog's filter of worksheets' files is called.
const SQL_FILES: &str = "SQL";

/// Runs `work` on Tauri's pool of blocking threads.
async fn off_the_window<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| StudioError::misuse(format!("[DESIGN] the request did not finish: {e}")))?
}

/// The reserved words of Turborel's SQL, as its lexer reads them.
#[tauri::command]
pub(crate) fn sql_words() -> Vec<&'static str> {
    key_words().to_vec()
}

/// The statements of `text`, each with its place and class.
#[tauri::command]
pub(crate) async fn split_script(text: String) -> Result<Vec<Piece>> {
    off_the_window(move || pieces(&text)).await
}

/// What the statement `text` reads, the cursor `cursor` UTF-16 code units
/// into it, for completion (RULES.md D40).
#[tauri::command]
pub(crate) async fn statement_scope(text: String, cursor: usize) -> Result<Scope> {
    off_the_window(move || Ok(scope(&text, byte_at(&text, cursor)))).await
}

/// What connection `connection`'s guards would ask of `sql` before it
/// runs, if anything.
#[tauri::command]
pub(crate) async fn judge_script(studio: State<'_, Studio>, connection: ConnectionId, sql: String) -> Result<Option<Confirm>> {
    blocking(&studio, move |m| m.judge(connection, &sql)).await
}

/// The types of a statement's dynamic parameters, in order.
#[tauri::command]
pub(crate) async fn statement_parameters(studio: State<'_, Studio>, connection: ConnectionId, sql: String) -> Result<Vec<String>> {
    blocking(&studio, move |m| m.parameters(connection, &sql)).await
}

/// The history's entries holding `text`, the latest first.
#[tauri::command]
pub(crate) async fn search_history(studio: State<'_, Studio>, text: String, limit: usize) -> Result<Vec<Entry>> {
    if text.chars().count() > MAX_SEARCH_CHARS || limit > MAX_HISTORY_GIVEN {
        return Err(StudioError::misuse(format!("[DESIGN] the history is searched for at most {MAX_SEARCH_CHARS} characters")));
    }
    let history = Arc::clone(&studio.history);
    off_the_window(move || history.search(&text, limit)).await
}

/// Keeps `entry` in the history, unless it changes who may do what:
/// whether it was kept.
#[tauri::command]
pub(crate) async fn record_history(studio: State<'_, Studio>, entry: Entry) -> Result<bool> {
    let history = Arc::clone(&studio.history);
    off_the_window(move || history.record(entry)).await
}

/// Forgets the history.
#[tauri::command]
pub(crate) async fn clear_history(studio: State<'_, Studio>) -> Result<()> {
    let history = Arc::clone(&studio.history);
    off_the_window(move || history.clear()).await
}

/// The worksheets, as last kept.
#[tauri::command]
pub(crate) async fn load_worksheets(studio: State<'_, Studio>) -> Result<Vec<Worksheet>> {
    let kept = studio.kept.clone();
    off_the_window(move || kept.worksheets()).await
}

/// Keeps `worksheets` in place of those kept.
#[tauri::command]
pub(crate) async fn keep_worksheets(studio: State<'_, Studio>, worksheets: Vec<Worksheet>) -> Result<()> {
    let kept = studio.kept.clone();
    off_the_window(move || kept.keep_worksheets(worksheets)).await
}

/// The favourite queries.
#[tauri::command]
pub(crate) async fn list_queries(studio: State<'_, Studio>) -> Result<Vec<Query>> {
    let kept = studio.kept.clone();
    off_the_window(move || kept.queries()).await
}

/// Keeps a favourite query: the queries then.
#[tauri::command]
pub(crate) async fn keep_query(studio: State<'_, Studio>, query: Query) -> Result<Vec<Query>> {
    let kept = studio.kept.clone();
    off_the_window(move || kept.keep_query(query)).await
}

/// Forgets a favourite query: the queries then.
#[tauri::command]
pub(crate) async fn forget_query(studio: State<'_, Studio>, id: String) -> Result<Vec<Query>> {
    let kept = studio.kept.clone();
    off_the_window(move || kept.forget_query(&id)).await
}

/// A path the dialog chose, as a path of the platform's.
fn chosen(path: tauri_plugin_dialog::FilePath) -> Result<PathBuf> {
    path.into_path().map_err(|e| StudioError::misuse(format!("[DESIGN] the path chosen is not a file's: {e}")))
}

/// Asks which `.sql` file to open, and reads it; none if the user
/// cancelled.
#[tauri::command]
pub(crate) async fn open_sql_file<R: Runtime>(app: AppHandle<R>, studio: State<'_, Studio>) -> Result<Option<Opened>> {
    let files = Arc::clone(&studio.files);
    off_the_window(move || {
        let Some(path) = app.dialog().file().add_filter(SQL_FILES, &[SQL_EXTENSION]).blocking_pick_file() else { return Ok(None) };
        let path = chosen(path)?;
        files.choose(&path)?;
        files.read(&path).map(Some)
    })
    .await
}

/// Reads `path`, a file chosen this session or a project's.
#[tauri::command]
pub(crate) async fn read_sql_file(studio: State<'_, Studio>, path: String) -> Result<Opened> {
    let files = Arc::clone(&studio.files);
    off_the_window(move || files.read(Path::new(&path))).await
}

/// Writes `text` to `path`, a file chosen this session or a project's.
#[tauri::command]
pub(crate) async fn write_sql_file(studio: State<'_, Studio>, path: String, text: String) -> Result<()> {
    let files = Arc::clone(&studio.files);
    off_the_window(move || files.write(Path::new(&path), &text)).await
}

/// The project folders.
#[tauri::command]
pub(crate) async fn project_folders(studio: State<'_, Studio>) -> Result<Vec<String>> {
    let files = Arc::clone(&studio.files);
    off_the_window(move || files.projects()).await
}

/// Asks which folder to keep as a project, and keeps it: the folders
/// then, or none if the user cancelled.
#[tauri::command]
pub(crate) async fn add_project_folder<R: Runtime>(app: AppHandle<R>, studio: State<'_, Studio>) -> Result<Option<Vec<String>>> {
    let files = Arc::clone(&studio.files);
    off_the_window(move || {
        let Some(folder) = app.dialog().file().blocking_pick_folder() else { return Ok(None) };
        files.add_project(&chosen(folder)?).map(Some)
    })
    .await
}

/// Lets a project folder go: the folders then.
#[tauri::command]
pub(crate) async fn remove_project_folder(studio: State<'_, Studio>, folder: String) -> Result<Vec<String>> {
    let files = Arc::clone(&studio.files);
    off_the_window(move || files.remove_project(&folder)).await
}

/// The `.sql` files of a project folder, by their paths within it.
#[tauri::command]
pub(crate) async fn project_files(studio: State<'_, Studio>, folder: String) -> Result<Vec<String>> {
    let files = Arc::clone(&studio.files);
    off_the_window(move || files.listed(&folder)).await
}
