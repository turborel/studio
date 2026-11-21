//! Embedded databases opened, made and told apart, in temporary folders.

use std::path::PathBuf;

use super::{EmbeddedSpec, Holds, Place, check, identifier, is_database, is_empty, open, os_user, plug_ins_of};

/// A directory of its own under the system's temporary directory.
fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("studio-embedded-unit-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir); // Left by an earlier run, if any.
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// What opens an in-memory database as `user`.
fn memory(user: Option<&str>) -> EmbeddedSpec {
    EmbeddedSpec {
        place: Place::Memory,
        create: true,
        keys: None,
        checksum_key: None,
        plugin_directories: None,
        user: user.map(str::to_owned),
    }
}

/// [DESIGN] D59 A new database's directory is empty or new, hidden files
/// aside; one that holds a catalog holds a database.
#[test]
fn an_empty_directory_and_a_database_are_told_apart() {
    let dir = scratch("empty");
    assert!(is_empty(&dir));
    assert!(is_empty(&dir.join("new")));
    assert_eq!(check(&dir.join("new")).holds, Holds::Nothing);
    std::fs::write(dir.join(".hidden"), "").unwrap();
    assert!(is_empty(&dir));
    assert!(!is_database(&dir));
    assert_eq!(check(&dir).holds, Holds::Empty);
    std::fs::write(dir.join("notes.txt"), "").unwrap();
    assert_eq!(check(&dir).holds, Holds::Other);
    std::fs::write(dir.join("catalog.0"), "").unwrap();
    assert!(!is_empty(&dir));
    assert!(is_database(&dir));
    let checked = check(&dir);
    assert_eq!((checked.holds, checked.held, checked.server), (Holds::Database, false, None));
    std::fs::remove_dir_all(&dir).unwrap();
}

/// [DESIGN] D59 A database's owner is named by a regular identifier, of
/// this machine's user if none is given.
#[test]
fn an_owner_is_named_by_an_identifier() {
    assert!(identifier("ADA_1"));
    for bad in ["", "1ADA", "ADA LOVELACE", "\"ADA\"", &"A".repeat(129)] {
        assert!(!identifier(bad), "{bad}");
    }
    assert!(identifier(&os_user()));
    let error = open(&memory(Some("not one"))).err().unwrap();
    assert!(error.message.contains("letters, digits and underscores"), "{}", error.message);
}

/// [DESIGN] D59 An in-memory database is owned by the identifier given,
/// with its schema, and told as not saved.
#[test]
fn an_in_memory_database_is_owned() {
    let held = open(&memory(Some("ADA"))).unwrap();
    assert!(held.in_memory());
    assert_eq!(held.user, "ADA");
    assert_eq!(held.db.owner().unwrap().as_deref(), Some("ADA"));
    assert!(held.told.as_deref().unwrap().contains("not"));
    held.close().unwrap();
}

/// [DESIGN] D59 What is given decides the plug-ins loaded: a checksum key
/// its keyed hash, plug-in directories the extensions' programs.
#[test]
fn what_is_given_loads_its_plug_ins() {
    let given = EmbeddedSpec { checksum_key: Some("K".into()), plugin_directories: Some("/srv/plug-ins".into()), ..memory(None) };
    let loaded = |spec: &EmbeddedSpec, name: &str| plug_ins_of(spec).iter().find(|p| p.name == name).unwrap().loaded;
    assert!(loaded(&given, "HMAC-SHA-256") && loaded(&given, "Extensions"));
    assert!(!loaded(&memory(None), "HMAC-SHA-256") && !loaded(&memory(None), "Extensions"));
    assert!(!loaded(&given, "Host plug-ins"));
}

/// [DESIGN] D59 A failure of the engine as a database opens is told
/// plainly: keys to give, a plug-in Studio does not register, or a build
/// that cannot open it, naming the engine's commit.
#[test]
fn a_database_not_opened_is_told_plainly() {
    use turborel::error::{Code, SqlError};
    let dir = std::path::Path::new("/data/d");
    let keys = super::not_opened(dir, SqlError::new(Code::Io, "no key named K in the keyring"));
    assert!(keys.message.contains("is encrypted: give its keys directory"), "{}", keys.message);
    let plug_in = super::not_opened(dir, SqlError::new(Code::Io, "encoding 9001 is not registered"));
    assert!(plug_in.message.contains("needs a plug-in Studio does not register"), "{}", plug_in.message);
    let build = super::not_opened(dir, SqlError::new(Code::Io, "the catalog is of format 2"));
    assert!(build.message.contains(crate::version::TURBOREL_COMMIT.get(..12).unwrap()), "{}", build.message);
    let report = turborel::db::RecoveryReport { committed: 3, not_committed: 1, ..Default::default() };
    assert!(super::recovered(&report).contains("3 committed transactions kept, 1 not committed undone"));
}

/// [DESIGN] D59 A keys directory and a checksum key are given as
/// `turboreld` gives them; with none, the keyring has no key.
#[test]
fn keys_are_given_as_a_server_gives_them() {
    use turborel_aes::Keyring;
    let dir = scratch("keys");
    let missing = EmbeddedSpec { keys: Some(dir.clone()), checksum_key: Some("CHECKS".into()), ..memory(None) };
    assert!(open(&missing).err().unwrap().message.contains("no key \"CHECKS\""));
    std::fs::write(dir.join("CHECKS"), "ab".repeat(32)).unwrap();
    let given = EmbeddedSpec {
        keys: Some(dir.clone()),
        checksum_key: Some("CHECKS".into()),
        plugin_directories: Some(dir.display().to_string()),
        ..memory(Some("ADA"))
    };
    let held = open(&given).unwrap();
    assert_eq!(held.plug_ins.iter().filter(|p| p.loaded).count(), 8);
    held.close().unwrap();
    assert!(super::NoKeys.name().starts_with("none"));
    assert_eq!(super::NoKeys.key("K").unwrap(), None);
    std::fs::remove_dir_all(&dir).unwrap();
}

/// [DESIGN] D59 A server's socket in a database's folder is found, to be
/// offered, and told in the refusal of a database another process holds.
#[cfg(unix)]
#[test]
fn a_servers_socket_is_found() {
    let dir = scratch("socket");
    let _listener = std::os::unix::net::UnixListener::bind(dir.join("s")).unwrap();
    let found = super::find_server(&dir);
    assert!(matches!(&found, Some(super::FoundServer::Socket { path }) if path.ends_with("/s")), "{found:?}");
    assert!(super::held(&dir).message.contains("A server's socket is in it"));
    std::fs::remove_dir_all(&dir).unwrap();
}
