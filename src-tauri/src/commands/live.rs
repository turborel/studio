//! Live Sessions' commands (RULES.md D56): the settings and the log; a
//! session hosted, its invitations, guests, roles and choices; the
//! workspace shared, which the backend filters before it leaves; and a
//! session joined. What happens comes as the events `liveHost` and
//! `liveGuest`.
#![allow(clippy::unreachable, reason = "tauri::command's expansion of an async command")]

use std::sync::Arc;

use tauri::State;
use turborel_studio_core::error::{Result, StudioError};
use turborel_studio_core::live::audit::LiveEntry;
use turborel_studio_core::live::link::LinkOpened;
use turborel_studio_core::live::service::{InviteView, LiveService, Status};
use turborel_studio_core::live::settings::{LiveSettings, SessionChoices};
use turborel_studio_core::live::share::WorkspaceIn;

use crate::state::Studio;

/// The longest code pasted, in bytes.
const MAX_CODE_BYTES: usize = 8192;

/// Runs `work` on the service, off the window's thread.
async fn off<T: Send + 'static>(studio: &Studio, work: impl FnOnce(&LiveService) -> Result<T> + Send + 'static) -> Result<T> {
    let service = Arc::clone(&studio.live);
    tauri::async_runtime::spawn_blocking(move || work(&service))
        .await
        .map_err(|e| StudioError::misuse(format!("[DESIGN] the request did not finish: {e}")))?
}

/// Live Sessions' settings.
#[tauri::command]
pub(crate) async fn live_settings(studio: State<'_, Studio>) -> Result<LiveSettings> {
    off(&studio, |s| s.settings.read()).await
}

/// Keeps Live Sessions' settings.
#[tauri::command]
pub(crate) async fn save_live_settings(studio: State<'_, Studio>, settings: LiveSettings) -> Result<()> {
    off(&studio, move |s| s.settings.keep(&settings)).await
}

/// Live Sessions now.
#[tauri::command]
pub(crate) async fn live_status(studio: State<'_, Studio>) -> Result<Status> {
    off(&studio, LiveService::status).await
}

/// Hosts a session.
#[tauri::command]
pub(crate) async fn live_present(studio: State<'_, Studio>) -> Result<Status> {
    off(&studio, LiveService::present).await
}

/// A new invitation of the session hosted.
#[tauri::command]
pub(crate) async fn live_invite(studio: State<'_, Studio>) -> Result<InviteView> {
    off(&studio, LiveService::invite).await
}

/// Admits guest `id`, or refuses it.
#[tauri::command]
pub(crate) async fn live_answer(studio: State<'_, Studio>, id: u64, yes: bool) -> Result<()> {
    off(&studio, move |s| s.answer(id, yes)).await
}

/// Removes guest `id`.
#[tauri::command]
pub(crate) async fn live_remove(studio: State<'_, Studio>, id: u64) -> Result<()> {
    off(&studio, move |s| s.remove(id)).await
}

/// Grants guest `id` Suggest, or takes it back.
#[tauri::command]
pub(crate) async fn live_grant(studio: State<'_, Studio>, id: u64, suggest: bool) -> Result<()> {
    off(&studio, move |s| s.grant_suggest(id, suggest)).await
}

/// Hands the presenter's role to guest `id`, or takes it back of none.
#[tauri::command]
pub(crate) async fn live_hand_over(studio: State<'_, Studio>, id: Option<u64>) -> Result<()> {
    off(&studio, move |s| s.hand_over(id)).await
}

/// Sets the session's choices.
#[tauri::command]
pub(crate) async fn live_choose(studio: State<'_, Studio>, choices: SessionChoices) -> Result<()> {
    off(&studio, move |s| s.choose(choices)).await
}

/// Shares `workspace`, filtered, where this Studio presents.
#[tauri::command]
pub(crate) async fn live_publish(studio: State<'_, Studio>, workspace: WorkspaceIn) -> Result<()> {
    off(&studio, move |s| s.publish(workspace)).await
}

/// Ends the session hosted.
#[tauri::command]
pub(crate) async fn live_end(studio: State<'_, Studio>) -> Result<()> {
    off(&studio, LiveService::end).await
}

/// Joins the session of invitation `code`.
#[tauri::command]
pub(crate) async fn live_join(studio: State<'_, Studio>, code: String) -> Result<Status> {
    if code.len() > MAX_CODE_BYTES {
        return Err(StudioError::misuse("[DESIGN] an invitation's code is at most 8 KiB"));
    }
    off(&studio, move |s| s.join(&code)).await
}

/// Raises this Studio's hand, or lowers it.
#[tauri::command]
pub(crate) async fn live_hand(studio: State<'_, Studio>, up: bool) -> Result<()> {
    off(&studio, move |s| s.hand(up)).await
}

/// Suggests `sql` into the presenter's tab `tab`.
#[tauri::command]
pub(crate) async fn live_suggest(studio: State<'_, Studio>, tab: String, sql: String) -> Result<()> {
    off(&studio, move |s| s.suggest(&tab, &sql)).await
}

/// Leaves the session joined.
#[tauri::command]
pub(crate) async fn live_leave(studio: State<'_, Studio>) -> Result<()> {
    off(&studio, LiveService::leave).await
}

/// Live Sessions' log, the latest first.
#[tauri::command]
pub(crate) async fn live_audit(studio: State<'_, Studio>) -> Result<Vec<LiveEntry>> {
    off(&studio, |s| s.audit.entries()).await
}

/// Forgets Live Sessions' log.
#[tauri::command]
pub(crate) async fn clear_live_audit(studio: State<'_, Studio>) -> Result<()> {
    off(&studio, |s| s.audit.clear()).await
}

/// The invitation's link the platform last opened Studio by, taken, if one
/// is waiting (RULES.md D66).
#[tauri::command]
pub(crate) async fn take_live_link(studio: State<'_, Studio>) -> Result<Option<LinkOpened>> {
    Ok(studio.link.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take())
}
