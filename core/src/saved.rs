//! Saved connections (RULES.md R-FMT-1, R-SEC-1, R-SEC-2): each a name, a
//! folder, the settings it connects by, its environment and colour, and
//! whether it is read-only or pinned, kept in a file of format 1 that
//! holds no secret; its password, if saved, in the keychain alone.

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::catalog::model::ObjectRef;
use crate::connections::spec::{ConnectionSpec, MAX_PASSWORD_BYTES};
use crate::error::{Result, StudioError};
use crate::secret::Secret;
use crate::secrets::SecretStore;
use crate::store::{self, FORMAT};

/// The saved connections' file, in the application's configuration.
pub const FILE: &str = "connections.json";
/// The longest the file may be, in bytes.
pub const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;
/// The most connections kept.
pub const MAX_CONNECTIONS: usize = 1000;
/// The longest name of a connection or of a folder, in characters.
pub const MAX_NAME_CHARS: usize = 128;
/// The deepest a folder may be.
pub const MAX_FOLDER_DEPTH: usize = 8;
/// The most favourite objects of a connection.
pub const MAX_FAVOURITES: usize = 500;
/// The most connections kept as recent.
pub const MAX_RECENT: usize = 10;
/// The prefix of a saved connection's key in the keychain.
const KEY_PREFIX: &str = "connection:";

/// The environment a connection is of, which sets its guards and colour.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Environment {
    /// Development: no confirmation of writes.
    #[default]
    Development,
    /// Test: no confirmation of writes.
    Test,
    /// Production: each statement that writes asks first (R-SEC-7).
    Production,
}

/// A saved connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedConnection {
    /// Its identifier, made as it is first saved.
    pub id: String,
    /// Its name, as the explorer shows it.
    pub name: String,
    /// The folders it is in, outermost first.
    #[serde(default)]
    pub folder: Vec<String>,
    /// The settings it connects by, with no password.
    pub spec: ConnectionSpec,
    /// Its environment.
    #[serde(default)]
    pub environment: Environment,
    /// Its colour, `#RRGGBB`, if not its environment's.
    #[serde(default)]
    pub colour: Option<String>,
    /// Whether each of its transactions is begun READ ONLY.
    #[serde(default)]
    pub read_only: bool,
    /// Whether it is pinned at the top of the explorer.
    #[serde(default)]
    pub pinned: bool,
    /// Its favourite objects, pinned at the top of its catalog.
    #[serde(default)]
    pub favourites: Vec<ObjectRef>,
}

/// The file's document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Document {
    format: u32,
    connections: Vec<SavedConnection>,
    #[serde(default)]
    recent: Vec<String>,
}

/// A saved connection as the front end is given it: whether a password
/// is saved, never the password (R-SEC-1).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedView {
    /// The connection.
    pub connection: SavedConnection,
    /// Whether its password is in the keychain.
    pub password_saved: bool,
}

/// The saved connections, and their list as the explorer shows them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedList {
    /// Every saved connection.
    pub connections: Vec<SavedView>,
    /// The identifiers of those used last, the latest first.
    pub recent: Vec<String>,
}

/// What a save does with the connection's password.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "password")]
pub enum PasswordChange {
    /// Leaves it as it is.
    #[default]
    Keep,
    /// Saves this one in the keychain.
    Save(String),
    /// Forgets the one saved.
    Forget,
}

/// The saved connections of a file, their passwords in `secrets`.
pub struct SavedConnections {
    path: PathBuf,
    secrets: Arc<dyn SecretStore>,
}

impl std::fmt::Debug for SavedConnections {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SavedConnections").field("path", &self.path).finish_non_exhaustive()
    }
}

/// The keychain's key of the connection `id`.
fn key(id: &str) -> String {
    format!("{KEY_PREFIX}{id}")
}

/// A new connection's identifier: 16 random octets, in hexadecimal.
fn new_id() -> Result<String> {
    let mut bytes = [0_u8; 16];
    aws_lc_rs::rand::SecureRandom::fill(&aws_lc_rs::rand::SystemRandom::new(), &mut bytes)
        .map_err(|e| StudioError::misuse(format!("[DESIGN] no identifier can be made: {e}")))?;
    Ok(bytes.iter().fold(String::with_capacity(32), |mut id, b| {
        use std::fmt::Write as _;
        // Writing to a String cannot fail.
        let _ = write!(id, "{b:02x}");
        id
    }))
}

/// `name` of `what`, refused if empty or too long.
fn named(what: &str, name: &str) -> Result<()> {
    if name.trim().is_empty() || name.chars().count() > MAX_NAME_CHARS || name.contains('\0') {
        return Err(StudioError::misuse(format!("[DESIGN] a {what} is named by 1 to {MAX_NAME_CHARS} characters")));
    }
    Ok(())
}

/// Whether `colour` is `#RRGGBB`.
fn is_colour(colour: &str) -> bool {
    colour.len() == 7 && colour.starts_with('#') && colour.chars().skip(1).all(|c| c.is_ascii_hexdigit())
}

impl SavedConnection {
    /// Checks every field is within its bounds (R-SEC-6).
    ///
    /// # Errors
    ///
    /// SQLCODE -910, saying which.
    pub fn validate(&self) -> Result<()> {
        named("connection", &self.name)?;
        if self.folder.len() > MAX_FOLDER_DEPTH {
            return Err(StudioError::misuse(format!("[DESIGN] folders are at most {MAX_FOLDER_DEPTH} deep")));
        }
        for folder in &self.folder {
            named("folder", folder)?;
        }
        if self.favourites.len() > MAX_FAVOURITES {
            return Err(StudioError::misuse(format!("[DESIGN] a connection has at most {MAX_FAVOURITES} favourites")));
        }
        for favourite in &self.favourites {
            named("favourite", &favourite.kind)?;
            named("favourite", &favourite.schema)?;
            named("favourite", &favourite.name)?;
        }
        if self.colour.as_deref().is_some_and(|c| !is_colour(c)) {
            return Err(StudioError::misuse("[DESIGN] a colour is written #RRGGBB"));
        }
        self.spec.validate()
    }
}

impl SavedConnections {
    /// The saved connections of the file `path`, their passwords in
    /// `secrets`.
    pub fn new(path: PathBuf, secrets: Arc<dyn SecretStore>) -> SavedConnections {
        SavedConnections { path, secrets }
    }

    /// The file's document, an empty one if there is no file.
    fn document(&self) -> Result<Document> {
        Ok(store::read(&self.path, MAX_FILE_BYTES)?.unwrap_or(Document { format: FORMAT, connections: Vec::new(), recent: Vec::new() }))
    }

    /// Every saved connection, and whether each has a password saved.
    ///
    /// # Errors
    ///
    /// The file's, or the keychain's.
    pub fn list(&self) -> Result<SavedList> {
        let document = self.document()?;
        let mut connections = Vec::with_capacity(document.connections.len());
        for connection in document.connections {
            let password_saved = self.secrets.get(&key(&connection.id))?.is_some();
            connections.push(SavedView { connection, password_saved });
        }
        Ok(SavedList { connections, recent: document.recent })
    }

    /// The saved connection `id`.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if there is none; the file's.
    pub fn get(&self, id: &str) -> Result<SavedConnection> {
        self.document()?.connections.into_iter().find(|c| c.id == id).ok_or_else(|| unknown(id))
    }

    /// The password saved of connection `id`, for the backend alone.
    ///
    /// # Errors
    ///
    /// The keychain's.
    pub fn password(&self, id: &str) -> Result<Option<Secret>> {
        self.secrets.get(&key(id))
    }

    /// Saves `connection`, new if its identifier is empty, its password as
    /// `password` says; gives it as saved.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for a field out of bounds, an unknown identifier, or too
    /// many connections; the file's or the keychain's.
    pub fn save(&self, mut connection: SavedConnection, password: PasswordChange) -> Result<SavedConnection> {
        connection.validate()?;
        let mut document = self.document()?;
        if connection.id.is_empty() {
            if document.connections.len() >= MAX_CONNECTIONS {
                return Err(StudioError::misuse(format!("[DESIGN] at most {MAX_CONNECTIONS} connections are saved")));
            }
            connection.id = new_id()?;
            document.connections.push(connection.clone());
        } else {
            let kept = document.connections.iter_mut().find(|c| c.id == connection.id).ok_or_else(|| unknown(&connection.id))?;
            *kept = connection.clone();
        }
        match password {
            PasswordChange::Keep => {}
            PasswordChange::Save(text) => {
                if text.len() > MAX_PASSWORD_BYTES || text.contains('\0') {
                    return Err(StudioError::misuse(format!("[DESIGN] a password is at most {MAX_PASSWORD_BYTES} bytes, with no NUL")));
                }
                self.secrets.set(&key(&connection.id), &Secret::new(text))?;
            }
            PasswordChange::Forget => self.secrets.delete(&key(&connection.id))?,
        }
        store::write(&self.path, &document)?;
        Ok(connection)
    }

    /// Deletes connection `id`, and forgets its password.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if there is none; the file's or the keychain's.
    pub fn delete(&self, id: &str) -> Result<()> {
        let mut document = self.document()?;
        let before = document.connections.len();
        document.connections.retain(|c| c.id != id);
        if document.connections.len() == before {
            return Err(unknown(id));
        }
        document.recent.retain(|r| r != id);
        self.secrets.delete(&key(id))?;
        store::write(&self.path, &document)
    }

    /// Records connection `id` as the one used last.
    ///
    /// # Errors
    ///
    /// The file's.
    pub fn used(&self, id: &str) -> Result<()> {
        let mut document = self.document()?;
        document.recent.retain(|r| r != id);
        document.recent.insert(0, id.to_owned());
        document.recent.truncate(MAX_RECENT);
        store::write(&self.path, &document)
    }
}

/// No saved connection of `id`.
fn unknown(id: &str) -> StudioError {
    StudioError::misuse(format!("[DESIGN] no connection {id} is saved"))
}

#[cfg(test)]
mod tests;
