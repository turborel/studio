//! Studio's own files (RULES.md R-FMT-1, R-SEC-2, R-SAFE-3, D49): each a
//! JSON document of format version 1, read with its size bounded and its
//! version checked, and written whole to a file its owner's alone, through a
//! file beside it renamed into place, so a crash leaves the old file or the
//! new, never a part. A file that does not fit, as one an earlier build
//! wrote, is set aside beside itself, told, and read as none, so Studio
//! starts clean of it.

use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::path::Path;

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::error::{Result, StudioError};

/// The one format version of every file Studio writes, during the alpha
/// (R-FMT-1).
pub const FORMAT: u32 = 1;
/// The key of a file's format version.
pub const FORMAT_KEY: &str = "format";
/// The suffix of the file a write goes through before it is renamed.
const PARTIAL: &str = ".partial";

/// A failure of the file `path`: `what`.
fn failed(path: &Path, what: &dyn std::fmt::Display) -> StudioError {
    StudioError::misuse(format!("[DESIGN] {}: {what}", path.display()))
}

/// The suffix of a file set aside, before the instant it was, in
/// nanoseconds since 1970.
const SET_ASIDE: &str = ".set-aside-";

/// What was told of the files set aside, until the window reads it.
static TOLD: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// Whether a notice holds `text`, for the tests, which run together.
#[cfg(test)]
fn told(text: &str) -> bool {
    TOLD.lock().is_ok_and(|t| t.iter().any(|n| n.contains(text)))
}

/// What was told of the files set aside since it was last read, each once.
pub fn set_aside_notices() -> Vec<String> {
    TOLD.lock().map(|mut told| std::mem::take(&mut *told)).unwrap_or_default()
}

/// Sets the file `path` aside, as `why` says it does not fit: renamed
/// beside itself, the instant it was set aside its suffix, and told.
///
/// # Errors
///
/// SQLCODE -910 if it cannot be renamed.
pub fn set_aside(path: &Path, why: &str) -> Result<()> {
    let second = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or_default();
    let mut aside = path.as_os_str().to_owned();
    aside.push(format!("{SET_ASIDE}{second}"));
    let aside = std::path::PathBuf::from(aside);
    std::fs::rename(path, &aside).map_err(|e| failed(path, &e))?;
    let notice = format!("{} did not fit, so Studio set it aside as {} and started without it: {why}", path.display(), aside.display());
    if let Ok(mut told) = TOLD.lock() {
        told.push(notice);
    }
    Ok(())
}

/// The document of the file `path`, if there is one: at most `max` bytes,
/// of format version 1. A file that does not fit, too long, not JSON of
/// its shape, or of another format version, is set aside and read as none.
///
/// # Errors
///
/// SQLCODE -910 if it cannot be read, or set aside.
pub fn read<T: DeserializeOwned>(path: &Path, max: u64) -> Result<Option<T>> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(failed(path, &e)),
    };
    let mut bytes = Vec::new();
    file.take(max.saturating_add(1)).read_to_end(&mut bytes).map_err(|e| failed(path, &e))?;
    match fitting(&bytes, max) {
        Ok(document) => Ok(Some(document)),
        Err(why) => set_aside(path, &why).map(|()| None),
    }
}

/// The document of `bytes`, if they fit: at most `max` of them, JSON of
/// its shape, of format version 1; else why not.
fn fitting<T: DeserializeOwned>(bytes: &[u8], max: u64) -> std::result::Result<T, String> {
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > max {
        return Err(format!("longer than {max} bytes"));
    }
    let json: serde_json::Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    let format = json.get(FORMAT_KEY).and_then(serde_json::Value::as_u64);
    if format != Some(u64::from(FORMAT)) {
        return Err(format!("of format {format:?}, where Studio reads format {FORMAT} alone"));
    }
    serde_json::from_value(json).map_err(|e| e.to_string())
}

/// Writes `document` to `path`, its owner's alone, whole or not at all.
///
/// # Errors
///
/// SQLCODE -910 if it cannot be written.
pub fn write<T: Serialize>(path: &Path, document: &T) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(document).map_err(|e| failed(path, &e))?;
    let mut partial = path.as_os_str().to_owned();
    partial.push(PARTIAL);
    let partial = std::path::PathBuf::from(partial);
    let _ = std::fs::remove_file(&partial); // One a crash left is replaced.
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        /// Read and write for the owner alone (R-SEC-2).
        const OWNER_ONLY: u32 = 0o600;
        options.mode(OWNER_ONLY);
    }
    let mut file = options.open(&partial).map_err(|e| failed(&partial, &e))?;
    file.write_all(&bytes).and_then(|()| file.sync_all()).map_err(|e| failed(&partial, &e))?;
    drop(file);
    std::fs::rename(&partial, path).map_err(|e| failed(path, &e))
}

#[cfg(test)]
mod tests {
    use serde::{Deserialize, Serialize};

    use super::{FORMAT, read, write};

    /// A document of the tests'.
    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct Doc {
        format: u32,
        name: String,
    }

    /// [RULE] R-FMT-1: a document is written and read back, and a file not
    /// there is no document.
    #[test]
    fn a_document_is_read_back() {
        let dir = crate::testing::scratch("store/back");
        let path = dir.join("doc.json");
        assert_eq!(read::<Doc>(&path, 1024).unwrap(), None);
        let doc = Doc { format: FORMAT, name: "ann".into() };
        write(&path, &doc).unwrap();
        assert_eq!(read::<Doc>(&path, 1024).unwrap(), Some(doc));
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
    }

    /// [RULE] R-SEC-2: the file is its owner's alone.
    #[test]
    fn the_file_is_the_owners_alone() {
        let path = crate::testing::scratch("store/owner").join("doc.json");
        write(&path, &Doc { format: FORMAT, name: "ann".into() }).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }

    /// [RULE] R-FMT-1 [DESIGN] D49: a document of another format version,
    /// not JSON, or not of its shape, is set aside, told once, and read as
    /// none; the next read finds no file.
    #[test]
    fn a_file_that_does_not_fit_is_set_aside() {
        let dir = crate::testing::scratch("store/aside");
        let path = dir.join("doc.json");
        for bad in [&br#"{"format": 2, "name": "ann"}"#[..], b"{ not json", br#"{"format": 1, "name": 7}"#] {
            std::fs::write(&path, bad).unwrap();
            assert_eq!(read::<Doc>(&path, 1024).unwrap(), None);
            assert!(!path.exists());
        }
        assert!(super::told(&format!("{} did not fit", path.display())));
        assert!(super::told("of format Some(2)"));
        assert!(super::told("invalid type: integer `7`"));
        let aside =
            std::fs::read_dir(&dir).unwrap().filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().contains(".set-aside-")).count();
        assert_eq!(aside, 3);
    }
    /// [RULE] R-ERR-1: a file that cannot be read or written is Studio's
    /// error, naming it.
    #[test]
    fn a_file_that_cannot_be_used_is_refused() {
        let dir = crate::testing::scratch("store/unusable");
        assert!(read::<Doc>(&dir, 1024).unwrap_err().message.contains("store/unusable"));
        let missing = dir.join("no-such-folder").join("doc.json");
        assert_eq!(write(&missing, &Doc { format: FORMAT, name: "ann".into() }).unwrap_err().sqlstate, "TB910");
        std::fs::write(dir.join("bad.json"), b"{ not json").unwrap();
        assert_eq!(read::<Doc>(&dir.join("bad.json"), 1024).unwrap(), None);
    }

    /// [RULE] R-SAFE-3: a file longer than its bound is set aside before
    /// it is parsed.
    #[test]
    fn a_file_past_its_bound_is_set_aside() {
        let path = crate::testing::scratch("store/bound").join("doc.json");
        std::fs::write(&path, format!(r#"{{"format": 1, "name": "{}"}}"#, "a".repeat(100))).unwrap();
        assert_eq!(read::<Doc>(&path, 64).unwrap(), None);
        assert!(super::told("longer than 64 bytes"));
    }
}
