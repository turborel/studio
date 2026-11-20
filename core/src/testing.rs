//! What the backend's unit tests share (RULES.md R-TEST-7): a scratch
//! directory of each test's own, under the build's target directory.

use std::path::{Path, PathBuf};

/// An empty directory for the test `name`, under `target/test-scratch`.
pub(crate) fn scratch(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("target").join("test-scratch").join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}
