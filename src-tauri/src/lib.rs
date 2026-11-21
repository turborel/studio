//! Turborel Studio's application (RULES.md D1, D9): the window, its menu,
//! its capabilities and the commands its webview may call, each a thin
//! layer over `turborel_studio_core`, where the work is done and tested.

mod commands;
pub mod menu;
mod plugins;
mod state;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{App, Builder, Manager, Runtime};
use turborel_studio_core::assistant::service::Service;
use turborel_studio_core::connections::manager::ConnectionManager;
use turborel_studio_core::connections::spool;
use turborel_studio_core::events::Hub;
use turborel_studio_core::files::private_dir;
use turborel_studio_core::live::service::LiveService;
use turborel_studio_core::saved::{FILE as SAVED_FILE, SavedConnections};
use turborel_studio_core::secrets::{Keychain, MemorySecrets, SecretStore};
use turborel_studio_core::worksheet::files::Kept;
use turborel_studio_core::worksheet::folders::Files;
use turborel_studio_core::worksheet::history::History;

use crate::state::{KeychainStatus, RESULTS_DIR, Studio, WebviewEvents};

/// The folders the application keeps its files in.
pub(crate) struct Folders {
    /// Results spooled, in the application's cache.
    pub results: PathBuf,
    /// Settings, the layout and saved connections, in its configuration.
    pub config: PathBuf,
}

/// Holds the application's state, in the application's own folders, the
/// keychain the platform's.
fn setup<R: Runtime>(app: &mut App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let folders = Folders { results: app.path().app_cache_dir()?.join(RESULTS_DIR), config: app.path().app_config_dir()? };
    let (secrets, keychain): (Arc<dyn SecretStore>, KeychainStatus) = match Keychain::open() {
        Ok(keychain) => (Arc::new(keychain), KeychainStatus { available: true, reason: None }),
        Err(error) => (Arc::new(MemorySecrets::default()), KeychainStatus { available: false, reason: Some(error.message) }),
    };
    manage(app, &folders, (secrets, keychain))?;
    let menu = menu::build(app.handle())?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| menu::chosen(app, &event));
    Ok(())
}

/// Holds the state, in `folders`, its own alone, secrets kept as `secrets`
/// says (R-SEC-2): the results' folder emptied of any spool a Studio
/// before it left behind.
pub(crate) fn manage<R: Runtime>(
    app: &App<R>,
    folders: &Folders,
    (secrets, keychain): (Arc<dyn SecretStore>, KeychainStatus),
) -> turborel_studio_core::error::Result<()> {
    private_dir(&folders.results)?;
    private_dir(&folders.config)?;
    spool::clear_stale(&folders.results)?;
    let hub = Arc::new(Hub::default());
    hub.listen(Arc::new(WebviewEvents(app.handle().clone())));
    let connections = Arc::new(ConnectionManager::new(folders.results.clone(), hub.clone()));
    let saved = Arc::new(SavedConnections::new(folders.config.join(SAVED_FILE), Arc::clone(&secrets)));
    let assistant = Arc::new(Service::new(&folders.config, (Arc::clone(&saved), secrets), Arc::clone(&connections), hub.clone()));
    let live = Arc::new(LiveService::new(&folders.config, Arc::clone(&connections), hub)?);
    app.manage(Studio {
        connections,
        saved,
        assistant,
        live,
        config: folders.config.clone(),
        keychain,
        history: Arc::new(History::new(&folders.config)),
        kept: Kept::new(&folders.config),
        files: Arc::new(Files::new(&folders.config)),
        failures: Arc::new(turborel_studio_core::failures::Failures::new(&folders.config)),
    });
    Ok(())
}

/// `builder` with everything Studio's application adds to Tauri's: its
/// state and its commands, on any runtime, so the tests build it on
/// Tauri's mock one.
pub(crate) fn studio<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder
        .plugin(plugins::BackendOnly(tauri_plugin_dialog::init()))
        .plugin(plugins::BackendOnly(tauri_plugin_notification::init()))
        .setup(setup)
        .invoke_handler(commands::handler())
}

/// The application's configuration, assets and capabilities, made once in
/// the crate, as macOS's embedded property list allows, for any runtime.
pub fn context<R: Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}

/// Builds the application and runs it until its last window closes.
///
/// # Errors
///
/// Tauri's, if the application cannot be built or its window made.
pub fn run() -> Result<(), tauri::Error> {
    studio(Builder::default()).run(context())
}

#[cfg(test)]
mod tests;
