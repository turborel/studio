//! Turborel Studio's application (RULES.md D1, D9): the window, its
//! capabilities and the commands its webview may call, each a thin layer
//! over `turborel_studio_core`, where the work is done and tested.

mod commands;
mod state;

use std::sync::Arc;

use tauri::{App, Builder, Manager, Runtime};
use turborel_studio_core::connections::manager::ConnectionManager;
use turborel_studio_core::connections::spool;
use turborel_studio_core::events::Hub;
use turborel_studio_core::files::private_dir;

use crate::state::{RESULTS_DIR, Studio, WebviewEvents};

/// Holds the application's state: the connection manager, its results
/// spooled in a folder of the application's cache that is the user's
/// alone, emptied of any a Studio before it left behind (R-SEC-2).
fn setup<R: Runtime>(app: &mut App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let results = app.path().app_cache_dir()?.join(RESULTS_DIR);
    manage(app, results)?;
    Ok(())
}

/// Holds the state, results spooled in `results`.
pub(crate) fn manage<R: Runtime>(app: &App<R>, results: std::path::PathBuf) -> turborel_studio_core::error::Result<()> {
    private_dir(&results)?;
    spool::clear_stale(&results)?;
    let hub = Arc::new(Hub::default());
    hub.listen(Arc::new(WebviewEvents(app.handle().clone())));
    app.manage(Studio { connections: Arc::new(ConnectionManager::new(results, hub)) });
    Ok(())
}

/// `builder` with everything Studio's application adds to Tauri's: its
/// state and its commands, on any runtime, so the tests build it on
/// Tauri's mock one.
pub(crate) fn studio<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder.setup(setup).invoke_handler(commands::handler())
}

/// The application's configuration, assets and capabilities, made once in
/// the crate, as macOS's embedded property list allows, for any runtime.
pub(crate) fn context<R: Runtime>() -> tauri::Context<R> {
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
