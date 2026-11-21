//! Turborel Studio's backend (RULES.md D1): everything the desktop
//! application does but draw. The Tauri application, `src-tauri`, is a thin
//! layer of commands over this crate, so what it does is tested here,
//! without a window, against a live `turboreld` where it needs one.

pub mod catalog;
pub mod connections;
pub mod error;
pub mod events;
pub mod failures;
pub mod files;
pub mod guard;
pub mod preferences;
pub mod saved;
pub mod secret;
pub mod secrets;
pub mod store;
pub mod version;
pub mod worksheet;

#[cfg(test)]
mod testing;
