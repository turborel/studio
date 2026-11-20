//! Running the tools each check is made of, from the repository's root,
//! and telling what runs.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::error::{Result, fail};

/// The program npm is, by platform: on Windows a command script.
pub const NPM: &str = if cfg!(windows) { "npm.cmd" } else { "npm" };

/// The most of a command's arguments shown as it runs, in characters.
const SHOWN: usize = 160;

/// The repository's root: the checks tool's manifest's parent.
pub fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().map_or_else(|| PathBuf::from("."), Path::to_path_buf)
}

/// Writes a line for the person running the tool.
#[allow(clippy::print_stdout, reason = "the checks tool's one place of output, a program for people")]
pub fn say(line: &str) {
    println!("{line}");
}

/// Runs `program` with `args` at the root, with `env` added, failing
/// unless it succeeds.
pub fn run(program: &str, args: &[&str], env: &[(&str, &str)]) -> Result<()> {
    let shown = args.join(" ");
    let shown: String = shown.chars().take(SHOWN).collect();
    say(&format!("==> {program} {shown}"));
    let mut command = Command::new(program);
    command.args(args).current_dir(root());
    for (name, value) in env {
        command.env(name, value);
    }
    let status = command.status().map_err(|e| crate::error::Error(format!("cannot run {program}: {e}")))?;
    if status.success() { Ok(()) } else { fail(format!("{program} {} failed: {status}", args.join(" "))) }
}

/// Runs `program` with `args` at the root and gives what it wrote, with
/// whether it succeeded.
pub fn output(program: &str, args: &[&str]) -> Result<(bool, String)> {
    let out = Command::new(program)
        .args(args)
        .current_dir(root())
        .output()
        .map_err(|e| crate::error::Error(format!("cannot run {program}: {e}")))?;
    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&out.stderr));
    Ok((out.status.success(), text))
}

/// Points git at `.githooks/`, the repository's own hooks.
pub fn install_hooks() -> Result<()> {
    run("git", &["config", "core.hooksPath", ".githooks"], &[])
}
