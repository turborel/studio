//! Embedded databases (RULES.md D59): a database held in Studio's own
//! process by the `turborel` crate's embedded library, kept in a directory
//! or in memory, opened beside the server connections behind the same
//! connection manager, each on a worker of its own (`embedded/worker.rs`),
//! so every part of Studio works on it unchanged.
//!
//! Opening and making are apart: Open takes a directory that holds a
//! database, and never makes one of a mistyped path; New takes an empty or
//! new directory. Before either, the directory's `lock` is looked at: a
//! database another process holds is refused, with a server found that may
//! serve it. A database is given the plug-ins `turboreld` gives one (LZ4,
//! the ciphers and hashes, the keys of its keys directory, its checksum
//! key, the SIMD kernels), so Studio opens what a server opens. One this
//! build of the engine cannot open is told so plainly; one recovered as it
//! opened is told too.

pub mod lobs;
pub mod transfer;
pub mod worker;

use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use turborel::db::{Database, OpenOptions, Opened, RecoveryReport};
use turborel_aes::{AesGcm, ChaCha20Poly1305, HmacSha256, KEY_BYTES, KeyDirectory, Keyring, Sha256, Sha512};

use crate::error::{Result, StudioError};
use crate::version::TURBOREL_COMMIT;

/// The directory's lock, as a server or a program holds it.
const LOCK: &str = "lock";
/// The files of which one marks a directory that holds a database: its catalog.
const CATALOG: [&str; 2] = ["catalog.0", "catalog.1"];
/// The TCP port a server listens on unless its settings name another.
pub const DEFAULT_PORT: u16 = 7422;
/// The longest a server is waited for as it is looked for.
const LOOK_WITHIN: Duration = Duration::from_millis(300);
/// The identifier a new database's owner takes, of no other found.
const DEFAULT_OWNER: &str = "STUDIO";
/// The longest identifier, in characters.
const MAX_IDENTIFIER: usize = 128;

/// Where an embedded database is kept.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Place {
    /// In a directory.
    Directory {
        /// The directory.
        path: PathBuf,
    },
    /// In memory, gone as it is closed.
    Memory,
}

/// What opens an embedded database.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmbeddedSpec {
    /// Where it is kept.
    pub place: Place,
    /// Whether it is made: of an empty or new directory, or in memory.
    #[serde(default)]
    pub create: bool,
    /// The keys directory of an encrypted database, as `turboreld --keys`.
    #[serde(default)]
    pub keys: Option<PathBuf>,
    /// The key of its checksums, as `turboreld --checksum-key`.
    #[serde(default)]
    pub checksum_key: Option<String>,
    /// The directories its extensions' plug-ins may be in, separated by
    /// `;`, as PLUGINS.DIRECTORIES, which the program embedding a database
    /// sets before it opens it; of none, no extension's plug-in loads.
    #[serde(default)]
    pub plugin_directories: Option<String>,
    /// The authorization identifier its session acts as: of none, its
    /// owner's; a new database's owner of one made.
    #[serde(default)]
    pub user: Option<String>,
}

/// An embedded database Studio holds open.
pub struct Embedded {
    /// The database.
    pub db: Database,
    /// Where it is kept.
    pub place: Place,
    /// The identifier its session acts as.
    pub user: String,
    /// What Studio tells of its opening: that it was recovered, or kept
    /// in memory.
    pub told: Option<String>,
    /// The plug-ins registered with it, and those it may need that are not.
    pub plug_ins: Vec<PlugIn>,
}

/// A plug-in an embedded database may need: registered by Studio as
/// `turboreld` registers it, or not, and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlugIn {
    /// Its name.
    pub name: String,
    /// What it gives: an encoding, a hash function, kernels, extensions.
    pub kind: String,
    /// Whether it is registered, and so loaded.
    pub loaded: bool,
    /// What it is for, or why it is not loaded.
    pub note: String,
}

/// A plug-in of `name` and `kind`, loaded or not, with `note`.
fn plug_in(name: &str, kind: &str, loaded: bool, note: &str) -> PlugIn {
    PlugIn { name: name.to_owned(), kind: kind.to_owned(), loaded, note: note.to_owned() }
}

/// The plug-ins a database `spec` opens is given, and those it is not.
fn plug_ins_of(spec: &EmbeddedSpec) -> Vec<PlugIn> {
    let keys = if spec.keys.is_some() {
        "with the keys of the keys directory given"
    } else {
        "with no keys: give the keys directory of an encrypted database"
    };
    let mut list = vec![
        plug_in("SIMD", "kernels", true, "the vector kernels of this machine's processor"),
        plug_in("LZ4", "encoding", true, "compression of pages and columns"),
        plug_in("AES-256-GCM", "encoding", true, keys),
        plug_in("CHACHA20-POLY1305", "encoding", true, keys),
        plug_in("SHA-256", "hash function", true, "checksums"),
        plug_in("SHA-512", "hash function", true, "checksums"),
    ];
    list.push(match &spec.checksum_key {
        Some(_) => plug_in("HMAC-SHA-256", "hash function", true, "keyed checksums, by the checksum key given"),
        None => {
            plug_in("HMAC-SHA-256", "hash function", false, "not loaded: give the checksum key of a database whose checksums are keyed")
        }
    });
    list.push(match &spec.plugin_directories {
        Some(dirs) => {
            plug_in("Extensions", "plug-in programs", true, &format!("loaded from {dirs}, as INFORMATION_SCHEMA.EXTENSIONS shows"))
        }
        None => plug_in(
            "Extensions",
            "plug-in programs",
            false,
            "not loaded: no plug-in directories are named, so an extension's functions fail until they are",
        ),
    });
    list.push(plug_in(
        "Host plug-ins",
        "PLUGINS.HOST",
        false,
        "not started: Studio starts no host plug-in; a database whose files, log or keys a host plug-in keeps opens on its server",
    ));
    list
}

impl Embedded {
    /// Closes the database: a checkpoint written, and its directory's lock
    /// given up. One in memory is let go.
    ///
    /// # Errors
    ///
    /// The engine's, as of a transaction still open.
    pub fn close(&self) -> Result<()> {
        match self.place {
            Place::Directory { .. } => self.db.close().map_err(StudioError::from),
            Place::Memory => Ok(()),
        }
    }

    /// Whether it is kept in memory.
    pub fn in_memory(&self) -> bool {
        self.place == Place::Memory
    }
}

/// A misuse of `message`.
fn refused(message: impl Into<String>) -> StudioError {
    StudioError::misuse(format!("[DESIGN] {}", message.into()))
}

/// Whether `dir` holds a database: its catalog.
pub fn is_database(dir: &Path) -> bool {
    CATALOG.iter().any(|f| dir.join(f).is_file())
}

/// Whether `dir` is new or empty but for hidden files, as a new database's.
pub fn is_empty(dir: &Path) -> bool {
    match std::fs::read_dir(dir) {
        Ok(entries) => entries.flatten().all(|e| e.file_name().to_string_lossy().starts_with('.')),
        Err(e) => e.kind() == std::io::ErrorKind::NotFound,
    }
}

/// Whether another process holds `dir`'s lock now, as a server or a
/// program that opened the database does (`File::try_lock`, as the
/// engine takes it).
pub fn held_elsewhere(dir: &Path) -> bool {
    let Ok(file) = std::fs::File::open(dir.join(LOCK)) else { return false };
    match file.try_lock() {
        Ok(()) => {
            let _ = file.unlock(); // Given back at once: it was only looked at.
            false
        }
        Err(_) => true,
    }
}

/// A server that may serve the database in `dir`: a Unix socket in its
/// directory, or one listening on this machine's default port.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum FoundServer {
    /// A Unix socket.
    Socket {
        /// Its path.
        path: String,
    },
    /// A TCP port of this machine.
    Port {
        /// The port.
        port: u16,
    },
}

/// A server's Unix socket in `dir`, if one is there.
#[cfg(unix)]
fn socket_in(dir: &Path) -> Option<FoundServer> {
    use std::os::unix::fs::FileTypeExt;
    let socket = std::fs::read_dir(dir).ok()?.flatten().find(|e| e.file_type().is_ok_and(|t| t.is_socket()))?;
    Some(FoundServer::Socket { path: socket.path().display().to_string() })
}

/// None: a server's named pipe is no file of the database's folder.
#[cfg(not(unix))]
fn socket_in(_: &Path) -> Option<FoundServer> {
    None
}

/// A server found that may serve the database in `dir`.
pub fn find_server(dir: &Path) -> Option<FoundServer> {
    socket_in(dir).or_else(|| {
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, DEFAULT_PORT));
        TcpStream::connect_timeout(&address, LOOK_WITHIN).ok().map(|_| FoundServer::Port { port: DEFAULT_PORT })
    })
}

/// The refusal of a database another process holds, with the server found.
fn held(dir: &Path) -> StudioError {
    let found = match find_server(dir) {
        Some(FoundServer::Socket { path }) => format!(" A server's socket is in it, {path}: connect to the server there instead."),
        Some(FoundServer::Port { port }) => {
            format!(" A server answers on this machine's port {port}: connect to it there, if it serves this database.")
        }
        None => " Connect to the server that serves it, if one does.".to_owned(),
    };
    refused(format!("the database in {} is open in another process, a server or a program, which holds its lock.{found}", dir.display()))
}

/// What a directory holds, as a database's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Holds {
    /// It is not there: New Database makes it.
    Nothing,
    /// It is empty, hidden files aside: New Database makes one in it.
    Empty,
    /// A database: Open Database opens it.
    Database,
    /// Files of no database: neither opens nor makes one.
    Other,
}

/// What a directory chosen holds, as the dialogs of Open Database and
/// New Database look at it before either acts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryCheck {
    /// What it holds.
    pub holds: Holds,
    /// Whether another process holds its lock.
    pub held: bool,
    /// A server found that may serve it, of one held.
    pub server: Option<FoundServer>,
}

/// What `dir` holds: a server looked for only if another process holds it.
pub fn check(dir: &Path) -> DirectoryCheck {
    let holds = if is_database(dir) {
        Holds::Database
    } else if !dir.exists() {
        Holds::Nothing
    } else if is_empty(dir) {
        Holds::Empty
    } else {
        Holds::Other
    };
    let held = held_elsewhere(dir);
    DirectoryCheck { holds, held, server: if held { find_server(dir) } else { None } }
}

/// The keyring of no keys directory: it has none, and says how to give one.
struct NoKeys;

impl Keyring for NoKeys {
    fn name(&self) -> &'static str {
        "none: give the database its keys directory as it is opened"
    }
    fn key(&self, _: &str) -> turborel::error::Result<Option<[u8; KEY_BYTES]>> {
        Ok(None)
    }
}

/// Registers with `db` the plug-ins `turboreld` registers (RULES.md D59):
/// the SIMD kernels, LZ4, AES-256-GCM and ChaCha20-Poly1305 of `keys`,
/// SHA-256 and SHA-512, and HMAC-SHA-256 of `checksum_key` if named; and
/// the directories extensions' plug-ins may be in, if named.
fn register(db: &Database, spec: &EmbeddedSpec) -> Result<()> {
    let (keys, checksum_key) = (spec.keys.as_deref(), spec.checksum_key.as_deref());
    if let Some(dirs) = &spec.plugin_directories {
        db.set_setting("PLUGINS.DIRECTORIES", &turborel::value::Value::Char(dirs.clone()))?;
    }
    db.register_kernels(Box::new(turborel_simd::Simd::detect()))?;
    db.register_encoding(Box::new(turborel_lz4::Lz4))?;
    let keyring: Arc<dyn Keyring> = match keys {
        Some(dir) => Arc::new(KeyDirectory::new(dir)),
        None => Arc::new(NoKeys),
    };
    db.register_encoding(Box::new(AesGcm::new(Arc::clone(&keyring))))?;
    db.register_encoding(Box::new(ChaCha20Poly1305::new(Arc::clone(&keyring))))?;
    db.register_hash_function(Box::new(Sha256))?;
    db.register_hash_function(Box::new(Sha512))?;
    if let Some(name) = checksum_key {
        db.register_hash_function(Box::new(HmacSha256::new(Arc::clone(&keyring), name)?))?;
    }
    Ok(())
}

/// The identifier of this machine's user, as a new database's owner's:
/// upper case, of letters, digits and underscores, beginning with a letter.
pub fn os_user() -> String {
    let name = std::env::var("USER").or_else(|_| std::env::var("USERNAME")).unwrap_or_default();
    let cleaned: String = name.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_uppercase() } else { '_' }).collect();
    if cleaned.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) && cleaned.len() <= MAX_IDENTIFIER {
        cleaned
    } else {
        DEFAULT_OWNER.to_owned()
    }
}

/// Whether `name` is a regular identifier Studio names an owner by.
pub(crate) fn identifier(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_IDENTIFIER
        && name.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// What is told of a database recovered as it opened.
fn recovered(report: &RecoveryReport) -> String {
    format!(
        "The database stopped without closing, and was recovered as it opened: {} committed transactions kept, {} not committed undone.",
        report.committed, report.not_committed
    )
}

/// A failure of the engine as it opened `dir`, told plainly: of its keys,
/// of a plug-in Studio does not register, or of a build that cannot open it.
fn not_opened(dir: &Path, e: turborel::error::SqlError) -> StudioError {
    let mut error = StudioError::from(e);
    let message = error.message.clone();
    let lower = message.to_ascii_lowercase();
    error.message = if lower.contains("keyring") || lower.contains("no key") {
        format!(
            "the database in {} is encrypted: give its keys directory, and its checksum key if it has one. The engine said: {message}",
            dir.display()
        )
    } else if lower.contains("not registered") {
        format!(
            "the database in {} needs a plug-in Studio does not register, as a host plug-in's encoding or hash function: open it on its server. The engine said: {message}",
            dir.display()
        )
    } else {
        format!(
            "Studio's engine, Turborel at {}, cannot open the database in {}. A database made by another build of Turborel's alpha may not open with this one: open it with the build that made it. The engine said: {message}",
            TURBOREL_COMMIT.get(..12).unwrap_or(TURBOREL_COMMIT),
            dir.display()
        )
    };
    error
}

/// Makes `user` the owner of new database `db`, with no password, and its schema.
fn owned(db: &Database, user: &str) -> Result<()> {
    if db.owner()?.is_none() {
        // The first user of a database with no owner becomes its owner.
        db.create_user(user, b"")?;
    }
    db.schema(&format!("CREATE SCHEMA AUTHORIZATION {user}"))?;
    Ok(())
}

/// Opens or makes the database `spec` says.
///
/// # Errors
///
/// SQLCODE -910 of a directory that holds no database to open, or one not
/// empty to make one in; of a database another process holds; of keys not
/// given; of a database this build cannot open; of an identifier that is
/// not one.
pub fn open(spec: &EmbeddedSpec) -> Result<Embedded> {
    if spec.user.as_deref().is_some_and(|u| !identifier(u)) {
        return Err(refused("the identifier is letters, digits and underscores, beginning with a letter"));
    }
    let db = Database::new();
    register(&db, spec)?;
    let (told, made) = match &spec.place {
        Place::Memory => (Some("An in-memory database: nothing of it is saved, and it is gone as it is closed.".to_owned()), true),
        Place::Directory { path } => opened_dir(&db, path, spec.create)?,
    };
    let user = match (&spec.user, db.owner()?) {
        (Some(user), _) => user.clone(),
        (None, Some(owner)) => owner,
        (None, None) => os_user(),
    };
    if made {
        owned(&db, &user)?;
    }
    Ok(Embedded { db, place: spec.place.clone(), user, told, plug_ins: plug_ins_of(spec) })
}

/// Opens the database in `dir` into `db`, or makes it there if `create`:
/// what is told of it, and whether it was made.
fn opened_dir(db: &Database, dir: &Path, create: bool) -> Result<(Option<String>, bool)> {
    if create {
        if is_database(dir) {
            return Err(refused(format!("{} holds a database already: Open Database… opens it", dir.display())));
        }
        if !is_empty(dir) {
            return Err(refused(format!("{} is not empty: a new database is made in an empty or new folder", dir.display())));
        }
    } else {
        if !dir.is_dir() {
            return Err(refused(format!("there is no folder {}", dir.display())));
        }
        if !is_database(dir) {
            return Err(refused(format!("{} holds no database: New Database… makes one", dir.display())));
        }
    }
    if held_elsewhere(dir) {
        return Err(held(dir));
    }
    let fs = db.file_system()?;
    match db.open_files(&fs, dir, &OpenOptions::default()) {
        Ok(Opened::Created) => Ok((None, true)),
        Ok(Opened::Reopened) => Ok((None, false)),
        Ok(Opened::Recovered(report)) => Ok((Some(recovered(&report)), false)),
        Err(e) if e.to_string().contains("is locked") => Err(held(dir)),
        Err(e) => Err(not_opened(dir, e)),
    }
}

#[cfg(test)]
mod tests;
