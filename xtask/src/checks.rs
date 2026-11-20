//! `verify`, `rules` and `audit`: every check a change must pass (RULES.md
//! D4), fastest first, stopping at the first that fails.

use std::path::Path;

use crate::command::{self, NPM, output, run, say};
use crate::error::{Result, fail};
use crate::{citations, docs, files, ipc};

/// Every check: the repository's rules, formatting, types, lints and
/// every test, Rust's and TypeScript's.
pub fn verify() -> Result<()> {
    rules()?;
    node_modules()?;
    run("cargo", &["fmt", "--all", "--check"], &[])?;
    run(NPM, &["run", "--silent", "format"], &[])?;
    run(NPM, &["run", "--silent", "typecheck"], &[])?;
    run(NPM, &["run", "--silent", "lint"], &[])?;
    run("cargo", &["clippy", "--workspace", "--all-targets", "--locked", "--", "-D", "warnings"], &[])?;
    run("cargo", &["test", "--workspace", "--locked"], &[("RUST_BACKTRACE", "1")])?;
    run(NPM, &["run", "--silent", "test"], &[])?;
    say("verify: every check passed");
    Ok(())
}

/// The repository's own rules, which no linter holds.
pub fn rules() -> Result<()> {
    let tracked = files::tracked()?;
    files::check_sources(&tracked)?;
    docs::check_manual(&tracked)?;
    citations::check_tests(&tracked)?;
    ipc::check_commands()?;
    say("rules: the repository's rules hold");
    Ok(())
}

/// The supply chain (RULES.md R-SEC-8): advisories, licenses and sources by
/// cargo deny; npm audit of what ships; no ring in the tree.
pub fn audit() -> Result<()> {
    run("cargo", &["deny", "--locked", "check"], &[])?;
    run(NPM, &["audit", "--omit=dev"], &[])?;
    no_ring()?;
    say("audit: the supply chain is clean");
    Ok(())
}

/// The crate ring is in no part of the tree (RULES.md R-SEC-8): TLS and
/// its cryptography are rustls on aws-lc-rs, as Turborel's own.
fn no_ring() -> Result<()> {
    let (_, text) = output("cargo", &["tree", "--workspace", "--locked", "--target", "all", "-i", "ring"])?;
    if text.lines().any(|line| line.starts_with("ring v")) {
        return fail(format!("ring is in the tree:\n{text}"));
    }
    say("==> no ring in the tree");
    Ok(())
}

/// Installs the front end's packages from the lock file if none are.
fn node_modules() -> Result<()> {
    if command::root().join(Path::new("node_modules")).is_dir() {
        return Ok(());
    }
    run(NPM, &["ci", "--no-fund", "--no-audit"], &[])
}
