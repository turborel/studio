//! Opening, making and closing embedded databases (`[DOC
//! client/03-embedding.md The database]`, `[DOC operator/03-databases.md
//! Opening and closing]`).

use std::io::Write;

use turborel::db::{Database, OpenOptions, Opened};
use turborel_studio_core::connections::outcome::Outcome;
use turborel_studio_core::connections::session::Transport;
use turborel_studio_core::embedded::{EmbeddedSpec, Place, held_elsewhere, is_database, is_empty};

use crate::child;
use crate::{OWNER, Scratch, open, run, spec};

/// The cells of the first column of `sql`'s rows on `id`.
fn column(manager: &turborel_studio_core::connections::manager::ConnectionManager, id: u64, sql: &str) -> Vec<Option<String>> {
    let Outcome::Rows { page, .. } = run(manager, id, sql).unwrap().outcome else { panic!("{sql} gave no rows") };
    page.rows.into_iter().map(|r| r.into_iter().next().unwrap()).collect()
}

/// How the engine opens `dir` now, the database then closed.
fn opened_as(dir: &std::path::Path) -> Opened {
    let db = Database::new();
    let fs = db.file_system().unwrap();
    let opened = db.open_files(&fs, dir, &OpenOptions::default()).unwrap();
    db.close().unwrap();
    opened
}

/// [DESIGN] D59 [DOC client/03-embedding.md The database] New Database
/// makes a database in a new directory, owned by the identifier given,
/// with its schema; the session says it is embedded; what it keeps is
/// there when it is opened again.
pub fn a_new_database_is_made_and_opened_again(scratch: &Scratch) {
    let dir = scratch.path("new");
    let (manager, _) = scratch.manager();
    let opened = open(&manager, &spec(&dir, true)).unwrap();
    assert_eq!(opened.told, None);
    assert_eq!(opened.session.transport, Transport::Embedded);
    assert!(opened.session.server.ends_with("(embedded)"), "{}", opened.session.server);
    assert_eq!((opened.session.authorization.as_str(), opened.session.owner), (OWNER, true));
    assert_eq!(opened.session.schema.as_deref(), Some(OWNER));
    let id = opened.connection;
    manager.set_autocommit(id, true).unwrap();
    run(&manager, id, "CREATE TABLE KEPT (N INTEGER)").unwrap();
    run(&manager, id, "INSERT INTO KEPT VALUES (1), (2), (3)").unwrap();
    manager.close(id).unwrap();
    assert!(is_database(&dir));
    let again = open(&manager, &spec(&dir, false)).unwrap();
    assert_eq!(again.told, None);
    assert_eq!(column(&manager, again.connection, "SELECT N FROM KEPT ORDER BY N"), [Some("1".into()), Some("2".into()), Some("3".into())]);
    manager.close(again.connection).unwrap();
}

/// [DESIGN] D59 [DOC operator/03-databases.md A database's directory] Open
/// Database opens only a directory that holds a database, and makes
/// nothing of a mistyped path; New Database makes one only in an empty or
/// new directory; a directory open in Studio is not opened twice.
pub fn what_is_no_database_is_not_opened(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let missing = scratch.path("mistyped");
    let error = open(&manager, &spec(&missing, false)).unwrap_err();
    assert!(error.message.contains("there is no folder"), "{}", error.message);
    assert!(!missing.exists());
    let empty = scratch.path("empty");
    std::fs::create_dir_all(&empty).unwrap();
    let error = open(&manager, &spec(&empty, false)).unwrap_err();
    assert!(error.message.contains("holds no database: New Database"), "{}", error.message);
    assert!(is_empty(&empty), "opening made files in the directory");
    let full = scratch.path("full");
    std::fs::create_dir_all(&full).unwrap();
    std::fs::write(full.join("notes.txt"), "mine").unwrap();
    let error = open(&manager, &spec(&full, true)).unwrap_err();
    assert!(error.message.contains("is not empty"), "{}", error.message);
    let db = scratch.path("db");
    let opened = open(&manager, &spec(&db, true)).unwrap();
    let error = open(&manager, &spec(&db, false)).unwrap_err();
    assert!(error.message.contains("open in Studio already"), "{}", error.message);
    manager.close(opened.connection).unwrap();
    let error = open(&manager, &spec(&db, true)).unwrap_err();
    assert!(error.message.contains("holds a database already: Open Database"), "{}", error.message);
}

/// [DESIGN] D59 [DOC operator/03-databases.md A database's directory] A
/// database another process holds is refused as open in another process,
/// its lock looked at first; once that process closes it, it opens.
pub fn a_database_another_process_holds_is_refused(scratch: &Scratch) {
    let dir = scratch.path("held");
    let (manager, _) = scratch.manager();
    let made = open(&manager, &spec(&dir, true)).unwrap();
    manager.close(made.connection).unwrap();
    let mut other = child::start("hold", &dir);
    assert!(held_elsewhere(&dir));
    let error = open(&manager, &spec(&dir, false)).unwrap_err();
    assert!(error.message.contains("is open in another process"), "{}", error.message);
    assert!(error.message.contains("server"), "{}", error.message);
    other.stdin.take().unwrap().flush().unwrap(); // Its input ends, and it closes the database.
    assert!(other.wait().unwrap().success());
    assert!(!held_elsewhere(&dir));
    let opened = open(&manager, &spec(&dir, false)).unwrap();
    manager.close(opened.connection).unwrap();
}

/// [DESIGN] D59 [DOC operator/03-databases.md Checkpoints] Closing a
/// connection of an embedded database closes the database: a checkpoint
/// is written, so it opens again as closed cleanly, and its lock is given
/// up.
pub fn closing_writes_a_checkpoint(scratch: &Scratch) {
    let dir = scratch.path("closed");
    let (manager, _) = scratch.manager();
    let id = open(&manager, &spec(&dir, true)).unwrap().connection;
    run(&manager, id, "CREATE TABLE KEPT (N INTEGER)").unwrap();
    run(&manager, id, "COMMIT").unwrap();
    assert!(held_elsewhere(&dir), "an open database holds its lock");
    manager.close(id).unwrap();
    assert!(!held_elsewhere(&dir));
    assert!(matches!(opened_as(&dir), Opened::Reopened));
}

/// [DESIGN] D59 [DOC operator/03-databases.md Recovery after a crash] A
/// database whose process was killed is recovered as it is opened again,
/// what it committed kept, and Studio says it was recovered.
pub fn a_killed_process_is_recovered(scratch: &Scratch) {
    let dir = scratch.path("killed");
    let (manager, _) = scratch.manager();
    let id = open(&manager, &spec(&dir, true)).unwrap().connection;
    manager.set_autocommit(id, true).unwrap();
    run(&manager, id, "CREATE TABLE KEPT (N INTEGER)").unwrap();
    run(&manager, id, "INSERT INTO KEPT VALUES (1)").unwrap();
    manager.close(id).unwrap();
    let mut other = child::start("crash", &dir);
    other.kill().unwrap();
    other.wait().unwrap();
    let opened = open(&manager, &spec(&dir, false)).unwrap();
    let told = opened.told.clone().unwrap_or_default();
    assert!(told.contains("was recovered as it opened"), "{told}");
    assert_eq!(column(&manager, opened.connection, "SELECT N FROM KEPT ORDER BY N"), [Some("1".into()), Some("2".into())]);
    manager.close(opened.connection).unwrap();
}

/// [DESIGN] D59 [DOC client/03-embedding.md The database] An in-memory
/// database is told as not saved and shown as in memory; nothing of it is
/// left once it is closed.
pub fn an_in_memory_database_is_not_saved(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let memory = EmbeddedSpec { place: Place::Memory, create: true, keys: None, checksum_key: None, plugin_directories: None, user: None };
    let opened = open(&manager, &memory).unwrap();
    assert!(opened.told.unwrap().contains("nothing of it is saved"));
    assert_eq!(opened.session.transport, Transport::InMemory);
    let id = opened.connection;
    run(&manager, id, "CREATE TABLE SCRATCH (N INTEGER)").unwrap();
    run(&manager, id, "INSERT INTO SCRATCH VALUES (7)").unwrap();
    assert_eq!(column(&manager, id, "SELECT N FROM SCRATCH"), [Some("7".into())]);
    manager.close(id).unwrap();
    let again = open(&manager, &memory).unwrap();
    let error = run(&manager, again.connection, "SELECT N FROM SCRATCH").unwrap_err();
    assert_eq!(error.sqlcode, -103);
    manager.close(again.connection).unwrap();
}

/// [DESIGN] D59 [DOC client/03-embedding.md Engines and other plug-ins]
/// The plug-ins an embedded database is given are listed, and those it is
/// not given are explained: no checksum key, no plug-in directories, no
/// host plug-in started.
pub fn plug_ins_are_listed(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let dir = scratch.path("plug-ins");
    let opened = open(&manager, &spec(&dir, true)).unwrap();
    let info = manager.embedded(opened.connection).unwrap().unwrap();
    assert_eq!(info.place, Place::Directory { path: dir });
    let loaded: Vec<&str> = info.plug_ins.iter().filter(|p| p.loaded).map(|p| p.name.as_str()).collect();
    assert_eq!(loaded, ["SIMD", "LZ4", "AES-256-GCM", "CHACHA20-POLY1305", "SHA-256", "SHA-512"]);
    let explained: Vec<&str> = info.plug_ins.iter().filter(|p| !p.loaded).map(|p| p.note.as_str()).collect();
    assert_eq!(explained.len(), 3);
    assert!(explained.iter().all(|n| n.starts_with("not ")), "{explained:?}");
    manager.close(opened.connection).unwrap();
}

/// [DESIGN] D55 D59: the assistant's connection of a saved embedded
/// database is a session more of it, beside the user's own, READ ONLY;
/// the database stays open while either session does, and closes with
/// the last, so it opens again after.
pub fn the_assistant_opens_a_session_beside_the_users(scratch: &Scratch) {
    use turborel_studio_core::assistant::policy::ConnectionPolicy;
    use turborel_studio_core::assistant::toolbox::open_session;
    use turborel_studio_core::saved::{Environment, SavedConnection, SavedEmbedded};
    let dir = scratch.path("beside");
    let (manager, _) = scratch.manager();
    let users = open(&manager, &spec(&dir, true)).unwrap();
    run(&manager, users.connection, "CREATE TABLE NOTES (ID INTEGER PRIMARY KEY)").unwrap();
    run(&manager, users.connection, "INSERT INTO NOTES VALUES (1), (2)").unwrap();
    run(&manager, users.connection, "COMMIT").unwrap();
    let embedded = SavedEmbedded { directory: dir.clone(), keys: None, checksum_key: None, plugin_directories: None, user: None };
    let saved = SavedConnection {
        id: "beside".into(),
        name: "beside".into(),
        folder: Vec::new(),
        spec: turborel_studio_core::connections::spec::ConnectionSpec::default(),
        environment: Environment::Development,
        colour: None,
        read_only: false,
        pinned: false,
        favourites: Vec::new(),
        embedded: Some(embedded),
    };
    let assistants = open_session(&manager, &saved, (None, None), &ConnectionPolicy::default()).unwrap();
    assert_ne!(assistants.connection, users.connection);
    assert_eq!(column(&manager, assistants.connection, "SELECT COUNT(*) FROM NOTES"), [Some("2".to_owned())]);
    assert!(run(&manager, assistants.connection, "INSERT INTO NOTES VALUES (3)").is_err(), "the assistant's session wrote");
    manager.close(users.connection).unwrap();
    assert_eq!(column(&manager, assistants.connection, "SELECT COUNT(*) FROM NOTES"), [Some("2".to_owned())]);
    manager.close(assistants.connection).unwrap();
    let again = open(&manager, &spec(&dir, false)).unwrap();
    manager.close(again.connection).unwrap();
}
