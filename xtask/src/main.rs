//! Turborel Studio's checks tool (RULES.md D4, D19), run as
//! `cargo xtask <command>`. Project automation is this program, never shell
//! scripts (R-PROC-5).

mod checks;
mod citations;
mod command;
mod coverage;
mod docs;
mod error;
mod files;
mod icon;
mod ipc;

use std::process::ExitCode;

use crate::error::Result;

/// The commands, each with what it does, as `cargo xtask` lists them.
const COMMANDS: [(&str, &str); 7] = [
    ("verify", "every check a change must pass: formatting, lints, types, the repository's rules and every test"),
    ("coverage", "the Rust and TypeScript tests' coverage, held to their floors (RULES.md D7); --files shows each file's"),
    ("audit", "the supply chain: cargo deny, npm audit of the shipped packages, and no ring in the tree"),
    ("rules", "the repository's own rules alone: sizes, markers, the manual, citations and the IPC's lists"),
    ("headings", "copy the headings of Turborel's manual from a checkout's doc/ (an argument) for citations"),
    ("icons", "make Tauri's icon set, src-tauri/icons, of artwork/studio-icon.png"),
    ("install-hooks", "point git at .githooks/, so each commit runs `cargo xtask verify` first"),
];

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let outcome = match args.first().map(String::as_str) {
        Some("verify") => checks::verify(),
        Some("coverage") => coverage::coverage(args.get(1).is_some_and(|a| a == "--files")),
        Some("audit") => checks::audit(),
        Some("rules") => checks::rules(),
        Some("headings") => citations::copy_headings(args.get(1).map(String::as_str)),
        Some("icons") => icon::icons(),
        Some("install-hooks") => command::install_hooks(),
        _ => {
            usage();
            return ExitCode::FAILURE;
        }
    };
    finish(outcome)
}

/// Reports `outcome`, and the exit code it gives.
fn finish(outcome: Result<()>) -> ExitCode {
    match outcome {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            command::say(&format!("xtask: {error}"));
            ExitCode::FAILURE
        }
    }
}

/// Lists the commands.
fn usage() {
    command::say("usage: cargo xtask <command>");
    for (name, what) in COMMANDS {
        command::say(&format!("  {name:<14} {what}"));
    }
}
