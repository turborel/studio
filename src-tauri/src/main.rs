//! Turborel Studio's program: it starts the application and reports why,
//! if it cannot.

// A Windows release build is a windowed program, with no console.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::ExitCode;

fn main() -> ExitCode {
    match turborel_studio::run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            #[allow(clippy::print_stderr, reason = "the program's one report of a failure to start, before any window")]
            {
                eprintln!("turborel-studio: {error}");
            }
            ExitCode::FAILURE
        }
    }
}
