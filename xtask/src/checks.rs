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
    citations::check_headings(&tracked)?;
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

/// The platforms Studio is built for, as `deny.toml`'s graph names them.
fn targets() -> Result<Vec<String>> {
    let deny = std::fs::read_to_string(command::root().join("deny.toml"))?;
    let list = deny.split_once("targets = [").and_then(|(_, rest)| rest.split_once(']')).map(|(list, _)| list).unwrap_or_default();
    let found: Vec<String> = list.split('"').skip(1).step_by(2).map(str::to_owned).collect();
    if found.is_empty() {
        return fail("deny.toml names no targets");
    }
    Ok(found)
}

/// The crate ring is in no part of the tree of any platform Studio is built
/// for (RULES.md R-SEC-10, D23): TLS and its cryptography are rustls on
/// aws-lc-rs, as Turborel's own. quinn's protocol crate names ring for
/// `wasm32-unknown-unknown` alone, a target Studio is never built for.
fn no_ring() -> Result<()> {
    for target in targets()? {
        let (_, text) = output("cargo", &["tree", "--workspace", "--locked", "--target", &target, "-i", "ring"])?;
        if text.lines().any(|line| line.starts_with("ring v")) {
            return fail(format!("ring is in the tree of {target}:\n{text}"));
        }
    }
    say("==> no ring in the tree of any platform built");
    Ok(())
}

/// Installs the front end's packages from the lock file if none are.
fn node_modules() -> Result<()> {
    if command::root().join(Path::new("node_modules")).is_dir() {
        return Ok(());
    }
    run(NPM, &["ci", "--no-fund", "--no-audit"], &[])
}
