//! Studio's own files (RULES.md R-FMT-1, R-SEC-2, R-SAFE-3): each a JSON
//! document of format version 1, read with its size bounded and its version
//! checked, and written whole to a file its owner's alone, through a file
//! beside it renamed into place, so a crash leaves the old file or the new,
//! never a part.

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

/// The document of the file `path`, if there is one: at most `max` bytes,
/// of format version 1.
///
/// # Errors
///
/// SQLCODE -910 if it cannot be read, is longer than `max`, is not JSON of
/// its shape, or is of another format version.
pub fn read<T: DeserializeOwned>(path: &Path, max: u64) -> Result<Option<T>> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(failed(path, &e)),
    };
    let mut bytes = Vec::new();
    file.take(max.saturating_add(1)).read_to_end(&mut bytes).map_err(|e| failed(path, &e))?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > max {
        return Err(failed(path, &format!("longer than {max} bytes")));
    }
    let json: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| failed(path, &e))?;
    let format = json.get(FORMAT_KEY).and_then(serde_json::Value::as_u64);
    if format != Some(u64::from(FORMAT)) {
        return Err(failed(path, &format!("of format {format:?}, where Studio reads format {FORMAT} alone")));
    }
    serde_json::from_value(json).map(Some).map_err(|e| failed(path, &e))
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

    /// [RULE] R-FMT-1: a document of another format version is refused,
    /// saying so.
    #[test]
    fn another_format_is_refused() {
        let path = crate::testing::scratch("store/format").join("doc.json");
        std::fs::write(&path, br#"{"format": 2, "name": "ann"}"#).unwrap();
        let error = read::<Doc>(&path, 1024).unwrap_err();
        assert!(error.message.contains("format Some(2)"), "{error}");
        std::fs::write(&path, br#"{"name": "ann"}"#).unwrap();
        assert!(read::<Doc>(&path, 1024).is_err());
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
        assert!(read::<Doc>(&dir.join("bad.json"), 1024).is_err());
    }

    /// [RULE] R-SAFE-3: a file longer than its bound is refused before it is
    /// parsed.
    #[test]
    fn a_file_past_its_bound_is_refused() {
        let path = crate::testing::scratch("store/bound").join("doc.json");
        std::fs::write(&path, format!(r#"{{"format": 1, "name": "{}"}}"#, "a".repeat(100))).unwrap();
        assert!(read::<Doc>(&path, 64).unwrap_err().message.contains("longer than 64 bytes"));
    }
}
