//! The version, written once and held to everywhere it is carried.

use std::path::{Path, PathBuf};

use super::{TURBOREL_COMMIT, VERSION, app_info};

/// The repository's root, above this crate.
fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// The text of the repository's file `name`.
fn read(name: &str) -> String {
    std::fs::read_to_string(root().join(name)).unwrap()
}

/// [DESIGN] D5: the front end's package and Tauri's configuration carry
/// the workspace's version, so every part of a build says the same release.
#[test]
fn every_manifest_carries_the_workspace_version() {
    let package: serde_json::Value = serde_json::from_str(&read("package.json")).unwrap();
    assert_eq!(package["version"], VERSION);
    let tauri: serde_json::Value = serde_json::from_str(&read("src-tauri/tauri.conf.json")).unwrap();
    assert_eq!(tauri["version"], VERSION);
    assert_eq!(VERSION, "0.0.0");
}

/// [DESIGN] D10: the commit the About box names is the one every
/// Turborel crate is pinned to in the workspace's manifest.
#[test]
fn the_pinned_commit_is_the_manifests() {
    let manifest = read("Cargo.toml");
    let pins: Vec<&str> = manifest.lines().filter(|line| line.contains("github.com/turborel/turborel")).collect();
    assert_eq!(pins.len(), 6);
    assert!(pins.iter().all(|line| line.contains(&format!("rev = \"{TURBOREL_COMMIT}\""))));
    assert_eq!(app_info().turborel_commit, TURBOREL_COMMIT);
}

/// [RULE] R-UI-1: the home folder the window shortens paths by is the
/// environment's own.
#[test]
fn the_home_folder_is_the_environments() {
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).ok();
    assert_eq!(app_info().home, home.filter(|h| !h.is_empty()));
}
