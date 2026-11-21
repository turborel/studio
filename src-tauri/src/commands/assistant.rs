//! The assistant's commands (RULES.md D55): its settings and keys, the
//! window told only whether a key is saved; each saved connection's policy,
//! exported and imported by the platform's dialog; the log; and each
//! conversation asked, its questions answered and forgotten. Every model
//! call is the backend's.
#![allow(clippy::unreachable, reason = "tauri::command's expansion of an async command")]

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_dialog::DialogExt;
use turborel_studio_core::assistant::audit::AuditEntry;
use turborel_studio_core::assistant::policy::{ConnectionPolicy, PolicyFile};
use turborel_studio_core::assistant::service::Asked;
use turborel_studio_core::assistant::settings::{AssistantSettings, CLAUDE_MODELS, KeysSaved, Provider};
use turborel_studio_core::assistant::turn::Prompt;
use turborel_studio_core::error::{Result, StudioError};
use turborel_studio_core::secret::Secret;

use crate::state::Studio;

/// The longest text the window sends of a prompt's part, in bytes.
const MAX_PROMPT_BYTES: usize = 1024 * 1024;
/// The longest key or password, in characters.
const MAX_SECRET_CHARS: usize = 4096;
/// The longest policy file imported, in bytes.
const MAX_POLICY_BYTES: u64 = 4 * 1024 * 1024;

/// Runs `work` off the window's thread.
async fn off<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| StudioError::misuse(format!("[DESIGN] the request did not finish: {e}")))?
}

/// The assistant's settings, whether each key is saved, and Claude's models.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettingsView {
    settings: AssistantSettings,
    keys: KeysSaved,
    claude_models: Vec<&'static str>,
}

/// The assistant's settings.
#[tauri::command]
pub(crate) async fn assistant_settings(studio: State<'_, Studio>) -> Result<SettingsView> {
    let service = Arc::clone(&studio.assistant);
    off(move || {
        Ok(SettingsView {
            settings: service.assistant.settings()?,
            keys: service.assistant.keys_saved()?,
            claude_models: CLAUDE_MODELS.to_vec(),
        })
    })
    .await
}

/// Keeps the assistant's settings.
#[tauri::command]
pub(crate) async fn save_assistant_settings(studio: State<'_, Studio>, settings: AssistantSettings) -> Result<()> {
    let service = Arc::clone(&studio.assistant);
    off(move || service.assistant.keep(&settings)).await
}

/// A secret of the window's, bounded.
fn bounded_secret(text: Option<String>) -> Result<Option<Secret>> {
    match text {
        Some(t) if t.chars().count() > MAX_SECRET_CHARS => Err(StudioError::misuse("[DESIGN] a key is at most 4096 characters")),
        Some(t) => Ok(Some(Secret::new(t))),
        None => Ok(None),
    }
}

/// Keeps `provider`'s key in the keychain, or forgets it of none.
#[tauri::command]
pub(crate) async fn set_assistant_key(studio: State<'_, Studio>, provider: Provider, key: Option<String>) -> Result<KeysSaved> {
    let service = Arc::clone(&studio.assistant);
    let key = bounded_secret(key)?;
    off(move || {
        service.assistant.set_key(provider, key.as_ref())?;
        service.assistant.keys_saved()
    })
    .await
}

/// The environment of saved connection `saved`.
fn environment(studio: &Studio, saved: &str) -> Result<turborel_studio_core::saved::Environment> {
    let list = studio.saved.list()?;
    let found = list.connections.into_iter().find(|v| v.connection.id == saved);
    Ok(found.map(|v| v.connection.environment).unwrap_or_default())
}

/// Saved connection `saved`'s policy.
#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri gives a command its state by value")]
pub(crate) fn assistant_policy(studio: State<'_, Studio>, saved: String) -> Result<ConnectionPolicy> {
    studio.assistant.policies.of(Some(&saved), environment(&studio, &saved)?)
}

/// Keeps saved connection `saved`'s policy.
#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri gives a command its state by value")]
pub(crate) fn save_assistant_policy(studio: State<'_, Studio>, saved: String, policy: ConnectionPolicy) -> Result<()> {
    studio.assistant.policies.keep(&saved, policy).map(|_| ())
}

/// Saves every policy to the file the platform's dialog chooses: its path, or none.
#[tauri::command]
pub(crate) async fn export_assistant_policy<R: Runtime>(app: AppHandle<R>, studio: State<'_, Studio>) -> Result<Option<String>> {
    let service = Arc::clone(&studio.assistant);
    off(move || {
        let file = service.policies.all()?;
        let text = serde_json::to_string_pretty(&file).map_err(|e| StudioError::misuse(format!("[DESIGN] the policy: {e}")))?;
        let Some(chosen) = app.dialog().file().set_file_name("assistant-policy.json").blocking_save_file() else { return Ok(None) };
        let path = chosen.into_path().map_err(|e| StudioError::misuse(format!("[DESIGN] the path chosen is not a file's: {e}")))?;
        std::fs::write(&path, text).map_err(|e| StudioError::misuse(format!("[DESIGN] cannot write {}: {e}", path.display())))?;
        Ok(Some(path.display().to_string()))
    })
    .await
}

/// Takes the policies of the file the platform's dialog chooses in place of
/// those kept: whether one was chosen.
#[tauri::command]
pub(crate) async fn import_assistant_policy<R: Runtime>(app: AppHandle<R>, studio: State<'_, Studio>) -> Result<bool> {
    let service = Arc::clone(&studio.assistant);
    off(move || {
        let Some(chosen) = app.dialog().file().add_filter("Assistant policy", &["json"]).blocking_pick_file() else { return Ok(false) };
        let path = chosen.into_path().map_err(|e| StudioError::misuse(format!("[DESIGN] the path chosen is not a file's: {e}")))?;
        if std::fs::metadata(&path).is_ok_and(|m| m.len() > MAX_POLICY_BYTES) {
            return Err(StudioError::misuse("[DESIGN] a policy file is at most 4 MiB"));
        }
        let text =
            std::fs::read_to_string(&path).map_err(|e| StudioError::misuse(format!("[DESIGN] cannot read {}: {e}", path.display())))?;
        let file: PolicyFile = serde_json::from_str(&text).map_err(|e| StudioError::misuse(format!("[DESIGN] no policy file: {e}")))?;
        service.policies.replace(&file)?;
        Ok(true)
    })
    .await
}

/// Keeps the password of saved connection `saved`'s assistant login, or forgets it of none.
#[tauri::command]
pub(crate) async fn set_assistant_login_password(studio: State<'_, Studio>, saved: String, password: Option<String>) -> Result<()> {
    let service = Arc::clone(&studio.assistant);
    let password = bounded_secret(password)?;
    off(move || service.set_login_password(&saved, password.as_ref())).await
}

/// The log's entries, the latest first.
#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri gives a command its state by value")]
pub(crate) fn assistant_audit(studio: State<'_, Studio>) -> Result<Vec<AuditEntry>> {
    studio.assistant.audit.entries()
}

/// Forgets every entry of the log.
#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri gives a command its state by value")]
pub(crate) fn clear_assistant_audit(studio: State<'_, Studio>) -> Result<()> {
    studio.assistant.audit.clear()
}

/// A question, and what the user chose to send with it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PromptView {
    text: String,
    sql: Option<String>,
    explain: Option<String>,
    rows: Option<String>,
}

/// Asks conversation `conversation`, of saved connection `saved` and
/// schema `schema`, of `prompt`; the turn is told by the backend's events.
#[tauri::command]
pub(crate) async fn assistant_ask(
    studio: State<'_, Studio>,
    conversation: String,
    saved: String,
    schema: Option<String>,
    prompt: PromptView,
) -> Result<()> {
    let too_long = [Some(&prompt.text), prompt.sql.as_ref(), prompt.explain.as_ref(), prompt.rows.as_ref()]
        .into_iter()
        .flatten()
        .any(|t| t.len() > MAX_PROMPT_BYTES);
    if too_long || prompt.text.trim().is_empty() {
        return Err(StudioError::misuse("[DESIGN] a question is 1 byte to 1 MiB, as each part sent with it"));
    }
    let service = Arc::clone(&studio.assistant);
    off(move || {
        let asked = Asked { saved, schema };
        service.ask(&conversation, &asked, Prompt { text: prompt.text, sql: prompt.sql, explain: prompt.explain, rows: prompt.rows })
    })
    .await
}

/// Answers the assistant's question `id`.
#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri gives a command its state by value")]
pub(crate) fn assistant_answer(studio: State<'_, Studio>, id: u64, yes: bool) {
    studio.assistant.answer(id, yes);
}

/// Forgets conversation `conversation`, its connection closed.
#[tauri::command]
pub(crate) async fn assistant_forget(studio: State<'_, Studio>, conversation: String) -> Result<()> {
    let service = Arc::clone(&studio.assistant);
    off(move || {
        service.forget(&conversation);
        Ok(())
    })
    .await
}
