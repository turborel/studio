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

/// The JSON example under the heading `heading` of the manual's page
/// `page`, a path under `doc/`: the first block of JSON after it.
pub(crate) fn manual_json(page: &str, heading: &str) -> String {
    let text = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("doc").join(page)).unwrap();
    let after = text.split_once(&format!("## {heading}\n")).unwrap().1;
    let block = after.split_once("```json\n").unwrap().1;
    block.split_once("```").unwrap().0.to_owned()
}
