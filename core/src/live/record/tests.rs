//! The tests of a session's record (RULES.md D67): kept and read back,
//! sealed or not, only as the workspace changes, its owner's alone.

use serde_json::json;

use super::{Entry, Head, Recorder, key, list, read};
use crate::secrets::{MemorySecrets, SecretStore};

/// A workspace shared of one tab of `text`, the presenter pointing at `x`.
fn state(text: &str, x: f64) -> serde_json::Value {
    json!({"tabs": [{"id": "w1", "kind": "worksheet", "title": "Q", "environment": null, "values": true, "text": text, "selection": null, "results": null, "messages": [], "plan": [], "document": null}], "active": "w1", "pointer": {"tab": 0, "x": x, "y": 0.5}, "copy": false})
}

/// [DESIGN] D67: a record keeps each workspace as it was shared, only as
/// its tabs change, not where the presenter points; each suggestion, who
/// came and went, and its end; read back whole, its head first.
#[test]
fn a_record_is_kept_and_read_back() {
    let dir = crate::testing::scratch("live/record");
    let mut recorder = Recorder::start(&dir, ("0f".repeat(16).as_str(), "Ann"), None).unwrap();
    recorder.shared(&state("SELECT 1", 0.1), None).unwrap();
    recorder.shared(&state("SELECT 1", 0.9), None).unwrap();
    recorder.shared(&state("SELECT 2", 0.9), Some("Bo")).unwrap();
    recorder.keep(&Entry::Suggested { at: 5, by: "Bo".into(), tab: "w1".into(), sql: "SELECT 3".into() }).unwrap();
    recorder.keep(&Entry::Ended { at: 6 }).unwrap();
    let path = recorder.path().to_owned();
    drop(recorder);
    let read = read(&path, None).unwrap();
    assert_eq!((read.head.presenter.as_str(), read.head.sealed, read.head.version), ("Ann", false, 1));
    let texts: Vec<_> = read
        .entries
        .iter()
        .filter_map(|e| {
            if let Entry::Shared { state, by, .. } = e {
                Some((state["tabs"][0]["text"].as_str().unwrap().to_owned(), by.clone()))
            } else {
                None
            }
        })
        .collect();
    assert_eq!(texts, [("SELECT 1".to_owned(), None), ("SELECT 2".to_owned(), Some("Bo".to_owned()))]);
    assert_eq!(read.entries.len(), 4);
    let listed = list(&dir).unwrap();
    assert_eq!(listed[0].head, Head { started: read.head.started, ..read.head.clone() });
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    }
    assert_eq!(list(&dir.join("none")).unwrap(), []);
}

/// [DESIGN] D67: a record sealed under the keychain's key holds no text
/// of what was shared, and is read back only of that key: of none or
/// another, refused, saying so.
#[test]
fn a_sealed_record_is_read_only_of_its_key() {
    let dir = crate::testing::scratch("live/record-sealed");
    let secrets = MemorySecrets::default();
    let made = key(&secrets).unwrap();
    assert_eq!(key(&secrets).unwrap(), made, "the key is kept, and taken again");
    let mut recorder = Recorder::start(&dir, ("ab".repeat(16).as_str(), "Ann"), Some(&made)).unwrap();
    recorder.shared(&state("SELECT SALARY FROM STAFF", 0.0), None).unwrap();
    let path = recorder.path().to_owned();
    drop(recorder);
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(!text.contains("SALARY"), "{text}");
    let read_back = read(&path, Some(&made)).unwrap();
    assert!(read_back.head.sealed);
    assert!(matches!(&read_back.entries[0], Entry::Shared { state, .. } if state["tabs"][0]["text"] == "SELECT SALARY FROM STAFF"));
    assert!(read(&path, None).unwrap_err().message.contains("holds no key"));
    let other = key(&MemorySecrets::default()).unwrap();
    assert!(read(&path, Some(&other)).unwrap_err().message.contains("not the one it was sealed with"));
    secrets.set(super::KEY_ENTRY, &crate::secret::Secret::new("short")).unwrap();
    assert!(key(&secrets).is_err());
}
