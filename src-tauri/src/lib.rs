//! Turborel Studio's application (RULES.md D1, D9): the window, its
//! capabilities and the commands its webview may call, each a thin layer
//! over `turborel_studio_core`, where the work is done and tested.

mod commands;

use tauri::{Builder, Runtime};

/// `builder` with everything Studio's application adds to Tauri's: its
/// commands, on any runtime, so the tests build it on Tauri's mock one.
pub(crate) fn studio<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder.invoke_handler(commands::handler())
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
