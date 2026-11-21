//! Saved connections, in a file of the test's own and secrets in memory.

use std::sync::Arc;

use super::{Environment, MAX_RECENT, PasswordChange, SavedConnection, SavedConnections};
use crate::connections::spec::ConnectionSpec;
use crate::secrets::{MemorySecrets, SecretStore};

/// Saved connections in `test`'s directory, and their secrets.
fn saved(test: &str) -> (SavedConnections, Arc<MemorySecrets>, std::path::PathBuf) {
    let path = crate::testing::scratch(&format!("saved/{test}")).join(super::FILE);
    let secrets = Arc::new(MemorySecrets::default());
    (SavedConnections::new(path.clone(), secrets.clone()), secrets, path)
}

/// A new connection named `name`.
fn connection(name: &str) -> SavedConnection {
    SavedConnection {
        id: String::new(),
        name: name.into(),
        folder: vec!["Team".into()],
        spec: ConnectionSpec { host: Some("db.example".into()), user: Some("ann".into()), ..ConnectionSpec::default() },
        environment: Environment::Production,
        colour: None,
        read_only: true,
        pinned: false,
        favourites: Vec::new(),
    }
}

/// [RULE] R-SEC-1 [RULE] R-FMT-1: a connection is saved with no password
/// in its file, the password in the keychain, and the list says only
/// that one is saved.
#[test]
fn the_password_is_kept_in_the_keychain_alone() {
    let (saved, secrets, path) = saved("password");
    let made = saved.save(connection("Orders"), PasswordChange::Save("ann's secret".into())).unwrap();
    assert_eq!(made.id.len(), 32);
    let file = std::fs::read_to_string(&path).unwrap();
    assert!(!file.contains("ann's secret"));
    assert!(file.contains("\"format\": 1"));
    assert_eq!(secrets.get(&format!("connection:{}", made.id)).unwrap().unwrap().expose(), "ann's secret");
    let list = saved.list().unwrap();
    assert!(list.connections[0].password_saved);
    assert!(!serde_json::to_string(&list).unwrap().contains("ann's secret"));
    saved.save(made.clone(), PasswordChange::Forget).unwrap();
    assert!(!saved.list().unwrap().connections[0].password_saved);
}

/// [RULE] R-FMT-1: a connection saved again replaces the one of its
/// identifier, and its password is kept unless the save says.
#[test]
fn a_save_replaces_and_keeps_the_password() {
    let (saved, _, _) = saved("replace");
    let made = saved.save(connection("Orders"), PasswordChange::Save("x".into())).unwrap();
    let renamed = SavedConnection { name: "Orders (EU)".into(), ..made.clone() };
    saved.save(renamed, PasswordChange::Keep).unwrap();
    let list = saved.list().unwrap();
    assert_eq!(list.connections.len(), 1);
    assert_eq!(list.connections[0].connection.name, "Orders (EU)");
    assert!(list.connections[0].password_saved);
    assert_eq!(saved.get(&made.id).unwrap().environment, Environment::Production);
}

/// [RULE] R-SEC-1: a connection deleted takes its password with it.
#[test]
fn a_deleted_connection_forgets_its_password() {
    let (saved, secrets, _) = saved("delete");
    let made = saved.save(connection("Orders"), PasswordChange::Save("x".into())).unwrap();
    saved.used(&made.id).unwrap();
    saved.delete(&made.id).unwrap();
    assert_eq!(secrets.get(&format!("connection:{}", made.id)).unwrap(), None);
    assert_eq!(saved.list().unwrap().recent, Vec::<String>::new());
    assert!(saved.delete(&made.id).is_err());
}

/// [DESIGN] D28: the latest used come first, at most ten kept.
#[test]
fn recent_connections_are_the_latest_used() {
    let (saved, _, _) = saved("recent");
    let ids: Vec<String> = (0..12).map(|n| saved.save(connection(&format!("C{n}")), PasswordChange::Keep).unwrap().id).collect();
    for id in &ids {
        saved.used(id).unwrap();
    }
    saved.used(&ids[3]).unwrap();
    let recent = saved.list().unwrap().recent;
    assert_eq!(recent.len(), MAX_RECENT);
    assert_eq!(recent[0], ids[3]);
    assert_eq!(recent[1], ids[11]);
}

/// [RULE] R-SEC-6: a connection's fields are refused past their bounds.
#[test]
fn bad_fields_are_refused() {
    let (saved, _, _) = saved("bounds");
    for bad in [
        SavedConnection { name: " ".into(), ..connection("x") },
        SavedConnection { colour: Some("red".into()), ..connection("x") },
        SavedConnection { folder: vec![String::new()], ..connection("x") },
        SavedConnection { folder: vec!["f".into(); 9], ..connection("x") },
        SavedConnection { id: "unknown".into(), ..connection("x") },
        SavedConnection {
            favourites: vec![crate::catalog::model::ObjectRef { kind: "TABLE".into(), schema: String::new(), name: "T".into() }],
            ..connection("x")
        },
    ] {
        assert_eq!(saved.save(bad, PasswordChange::Keep).unwrap_err().sqlstate, "TB910");
    }
}

/// [RULE] R-FMT-2 [STUDIO connections.json]: the manual's example of the
/// file is one Studio reads.
#[test]
fn the_manuals_example_is_read() {
    let (saved, _, path) = saved("manual");
    std::fs::write(&path, crate::testing::manual_json("appendix/d-files.md", "connections.json")).unwrap();
    let list = saved.list().unwrap();
    assert_eq!(list.connections[0].connection.name, "Orders");
    assert_eq!(list.connections[0].connection.folder, ["Team", "EU"]);
    assert_eq!(list.connections[0].connection.favourites[0].name, "ORDERS");
    assert_eq!(list.recent.len(), 1);
}

/// [DESIGN] D49: the saved connections an earlier build left are read.
#[test]
fn an_earlier_builds_connections_are_read() {
    let dir = crate::testing::earlier_app_data("saved/earlier");
    let saved = SavedConnections::new(dir.join("connections.json"), Arc::new(MemorySecrets::default()));
    let list = saved.list().unwrap();
    assert_eq!(list.connections.len(), 1);
    assert!(dir.join("connections.json").exists());
}
