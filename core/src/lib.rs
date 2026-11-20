//! Turborel Studio's backend (RULES.md D1): everything the desktop
//! application does but draw. The Tauri application, `src-tauri`, is a thin
//! layer of commands over this crate, so what it does is tested here,
//! without a window, against a live `turboreld` where it needs one.

pub mod version;
