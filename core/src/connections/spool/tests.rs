//! The spool, in a directory of the test's own.

use super::{PREFIX, Spool, clear_stale};

/// The one file in `dir`.
fn only_file(dir: &std::path::Path) -> std::path::PathBuf {
    let files: Vec<_> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().path()).collect();
    assert_eq!(files.len(), 1);
    files.into_iter().next().unwrap()
}

/// [RULE] R-SAFE-1: pages are read back as they were written, in any order.
#[test]
fn pages_are_read_back_as_written() {
    let dir = crate::testing::scratch("spool/read_back");
    let mut spool = Spool::new(&dir).unwrap();
    assert_eq!(spool.append(b"first page").unwrap(), 0);
    assert_eq!(spool.append(b"second").unwrap(), 1);
    assert_eq!(spool.read(1).unwrap(), b"second");
    assert_eq!(spool.read(0).unwrap(), b"first page");
    assert_eq!(spool.pages(), 2);
    assert!(spool.read(2).is_err());
}

/// [RULE] R-SEC-2: the file holds no page in the clear, is its owner's
/// alone, and is removed with the spool.
#[test]
fn the_file_is_sealed_owner_only_and_removed() {
    let dir = crate::testing::scratch("spool/sealed");
    let mut spool = Spool::new(&dir).unwrap();
    spool.append(b"ann's salary is 9000").unwrap();
    let file = only_file(&dir);
    assert!(file.file_name().unwrap().to_string_lossy().starts_with(PREFIX));
    let bytes = std::fs::read(&file).unwrap();
    assert!(!bytes.windows(4).any(|w| w == b"9000"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
    }
    drop(spool);
    assert!(!file.exists());
}

/// [RULE] R-SAFE-1: a page changed on disk is refused, not read.
#[test]
fn a_changed_page_is_refused() {
    let dir = crate::testing::scratch("spool/changed");
    let mut spool = Spool::new(&dir).unwrap();
    spool.append(b"page").unwrap();
    let file = only_file(&dir);
    let mut bytes = std::fs::read(&file).unwrap();
    bytes[0] ^= 1;
    std::fs::write(&file, bytes).unwrap();
    assert_eq!(spool.read(0).unwrap_err().sqlstate, crate::error::MISUSE_SQLSTATE);
}

/// [RULE] R-SEC-2: spools a Studio left behind are removed, and nothing
/// else in the directory.
#[test]
fn stale_spools_are_cleared() {
    let dir = crate::testing::scratch("spool/stale");
    std::fs::write(dir.join(format!("{PREFIX}0123456789abcdef")), b"sealed pages").unwrap();
    std::fs::write(dir.join("other"), b"kept").unwrap();
    assert_eq!(clear_stale(&dir).unwrap(), 1);
    assert_eq!(only_file(&dir).file_name().unwrap(), "other");
}
