//! `coverage` (RULES.md D7, R-COV): the Rust crates' line and region
//! coverage by every test, measured with rustc's source-based coverage
//! (`-C instrument-coverage`) and the LLVM tools of the pinned toolchain,
//! held to their floors; then the front end's, by Vitest's V8 coverage,
//! held to the floors in `vite.config.ts`.

use std::path::{Path, PathBuf};

use crate::command::{NPM, output, root, run, say};
use crate::error::{Error, Result, fail};

/// The floor of the Rust crates' line coverage, in percent (D7).
pub const FLOOR_LINES: f64 = 84.0;
/// The floor of their region coverage, in percent (D7).
pub const FLOOR_REGIONS: f64 = 88.0;
/// The packages whose tests are run; the checks tool is not the product.
const EXCLUDED: &str = "xtask";
/// The sources measured, relative to the root.
const MEASURED: [&str; 2] = ["core/src", "src-tauri/src"];
/// Where the instrumented build and its profiles go.
const TARGET: &str = "target/coverage";

/// Measures both halves and holds each to its floors.
pub fn coverage() -> Result<()> {
    rust()?;
    run(NPM, &["run", "--silent", "coverage"], &[])?;
    say("coverage: both halves are above their floors");
    Ok(())
}

/// The Rust crates' coverage, held to `FLOOR_LINES` and `FLOOR_REGIONS`.
fn rust() -> Result<()> {
    let target = root().join(TARGET);
    let profiles = target.join("profiles");
    let _ = std::fs::remove_dir_all(&profiles); // None there is the same as none left.
    std::fs::create_dir_all(&profiles)?;
    let pattern = profiles.join("%p-%m.profraw");
    let env = [
        ("RUSTFLAGS", "-C instrument-coverage"),
        ("CARGO_TARGET_DIR", TARGET),
        ("LLVM_PROFILE_FILE", pattern.to_str().unwrap_or_default()),
    ];
    let test = ["test", "--workspace", "--exclude", EXCLUDED, "--locked"];
    run("cargo", &test, &env)?;
    let objects = test_objects(&env)?;
    let merged = target.join("merged.profdata");
    let tools = llvm_tools()?;
    let mut merge = vec!["merge".to_owned(), "-sparse".to_owned(), "-o".to_owned(), path_text(&merged)];
    for entry in std::fs::read_dir(&profiles)? {
        merge.push(path_text(&entry?.path()));
    }
    run(&path_text(&tools.join(tool("llvm-profdata"))), &merge.iter().map(String::as_str).collect::<Vec<_>>(), &[])?;
    let (lines, regions) = totals(&tools, &merged, &objects)?;
    say(&format!("==> Rust coverage: lines {lines:.2} % (floor {FLOOR_LINES}), regions {regions:.2} % (floor {FLOOR_REGIONS})"));
    if lines < FLOOR_LINES || regions < FLOOR_REGIONS {
        return fail("the Rust crates' coverage is below its floor (R-COV-2)");
    }
    Ok(())
}

/// The test executables the instrumented build made.
fn test_objects(env: &[(&str, &str)]) -> Result<Vec<String>> {
    let mut command = std::process::Command::new("cargo");
    command.args(["test", "--workspace", "--exclude", EXCLUDED, "--locked", "--no-run", "--message-format=json"]).current_dir(root());
    for (name, value) in env {
        command.env(name, value);
    }
    let out = command.output()?;
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(text
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|m| m.get("profile").and_then(|p| p.get("test")).and_then(serde_json::Value::as_bool) == Some(true))
        .filter_map(|m| m.get("executable").and_then(serde_json::Value::as_str).map(str::to_owned))
        .collect())
}

/// The line and region percentages of the measured sources.
fn totals(tools: &Path, merged: &Path, objects: &[String]) -> Result<(f64, f64)> {
    let mut args = vec!["export".to_owned(), "-summary-only".to_owned(), format!("-instr-profile={}", path_text(merged))];
    // The first test executable is llvm-cov's positional binary, the rest
    // objects, then the sources measured.
    let Some((first, rest)) = objects.split_first() else { return fail("the instrumented build made no test executable") };
    args.push(first.clone());
    args.extend(rest.iter().map(|object| format!("-object={object}")));
    args.extend(MEASURED.iter().map(|dir| path_text(&root().join(dir))));
    let (ok, text) = output(&path_text(&tools.join(tool("llvm-cov"))), &args.iter().map(String::as_str).collect::<Vec<_>>())?;
    if !ok {
        return fail(format!("llvm-cov export failed: {text}"));
    }
    let start = text.find('{').unwrap_or_default();
    let json: serde_json::Value =
        serde_json::from_str(text.get(start..).unwrap_or_default()).map_err(|e| Error(format!("llvm-cov: {e}")))?;
    let percent = |kind: &str| json.pointer(&format!("/data/0/totals/{kind}/percent")).and_then(serde_json::Value::as_f64);
    match (percent("lines"), percent("regions")) {
        (Some(lines), Some(regions)) => Ok((lines, regions)),
        _ => fail("llvm-cov gave no totals"),
    }
}

/// The directory of the pinned toolchain's LLVM tools (its `llvm-tools`
/// component, which `rust-toolchain.toml` names).
fn llvm_tools() -> Result<PathBuf> {
    let (_, sysroot) = output("rustc", &["--print", "sysroot"])?;
    let (_, version) = output("rustc", &["-vV"])?;
    let host = version.lines().find_map(|l| l.strip_prefix("host: ")).ok_or_else(|| Error("rustc names no host".into()))?;
    Ok(PathBuf::from(sysroot.trim()).join("lib").join("rustlib").join(host.trim()).join("bin"))
}

/// The file name of the LLVM tool `name` on this platform.
fn tool(name: &str) -> String {
    format!("{name}{}", std::env::consts::EXE_SUFFIX)
}

/// A path as text, for a tool's arguments.
fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
