//! The commands of Studio's settings and the dock's layout (RULES.md
//! R-FMT-1): each read from, and written to, a file of format 1 in the
//! application's configuration, its user's alone.

// `tauri::command`'s expansion of an async command holds an `unreachable!`
// of its own, which no code here writes.
#![allow(clippy::unreachable, reason = "tauri::command's expansion of an async command")]

use tauri::State;
use turborel_studio_core::error::Result;
use turborel_studio_core::preferences::{Layout, Settings};

use crate::state::Studio;

/// Studio's settings, the defaults if none are saved.
#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri gives a command its state by value")]
pub(crate) fn load_settings(studio: State<'_, Studio>) -> Result<Settings> {
    Settings::load(&studio.config)
}

/// Saves Studio's settings, each within its bounds.
#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri gives a command its state by value")]
pub(crate) fn save_settings(studio: State<'_, Studio>, settings: Settings) -> Result<()> {
    settings.save(&studio.config)
}

/// The dock's layout, if one is saved.
#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri gives a command its state by value")]
pub(crate) fn load_layout(studio: State<'_, Studio>) -> Result<Option<serde_json::Value>> {
    Ok(Layout::load(&studio.config)?.map(|layout| layout.dock))
}

/// Saves the dock's layout, as the dock gives it.
#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri gives a command its state by value")]
pub(crate) fn save_layout(studio: State<'_, Studio>, dock: serde_json::Value) -> Result<()> {
    Layout::save(&studio.config, dock)
}

/// Forgets the dock's layout, so the window is laid out afresh as it loads
/// again (RULES.md D49).
#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri gives a command its state by value")]
pub(crate) fn forget_layout(studio: State<'_, Studio>) -> Result<()> {
    Layout::forget(&studio.config)
}

/// What was told of Studio's files set aside since last asked, each once
/// (RULES.md D49).
#[tauri::command]
pub(crate) fn set_aside_notices() -> Vec<String> {
    turborel_studio_core::store::set_aside_notices()
}

/// Keeps `text`, a failure the window did not handle, in the failures' log
/// (RULES.md D49).
#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri gives a command its state by value")]
pub(crate) fn log_failure(studio: State<'_, Studio>, text: String) -> Result<()> {
    studio.failures.log(&text)
}
