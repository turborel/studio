//! A session's record (RULES.md D67), kept on the presenter's machine
//! alone, of what was shared and nothing more: each workspace as it was
//! sent, its masks and row limits already applied (D56), with when and by
//! whom; each suggestion, who came and who went. A file of JSON lines,
//! its first line its head, format 1, its owner's alone; sealed, if asked,
//! a line at a time with AES-256-GCM under a key kept in the keychain.

use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use aws_lc_rs::aead::{AES_256_GCM, Aad, LessSafeKey, NONCE_LEN, Nonce, UnboundKey};
use aws_lc_rs::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use turborel_studio_live::base64;

use crate::error::{Result, StudioError};
use crate::secret::Secret;
use crate::secrets::SecretStore;

/// The folder of the records, in Studio's configuration.
pub const RECORDS_DIR: &str = "live-records";
/// What a record's head names its format.
pub const RECORD_FORMAT: &str = "turborel-studio-live-record";
/// The version of the record's format this build writes and reads.
pub const RECORD_VERSION: u32 = 1;
/// The keychain's entry of the records' key.
pub const KEY_ENTRY: &str = "live-records-key";
/// The longest record read back, in bytes.
pub const MAX_RECORD_BYTES: u64 = 256 * 1024 * 1024;
/// The most entries of a record read back.
pub const MAX_ENTRIES: usize = 100_000;
/// The extension of a record's file.
const EXTENSION: &str = "jsonl";

/// A record's head: its format, the session, who presented, when it
/// began, and whether its lines are sealed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Head {
    /// `RECORD_FORMAT`.
    pub format: String,
    /// `RECORD_VERSION`.
    pub version: u32,
    /// The session's identifier.
    pub session: String,
    /// The presenter's name.
    pub presenter: String,
    /// When it began, in milliseconds since 1970.
    pub started: u64,
    /// Whether its entries are sealed under the keychain's key.
    pub sealed: bool,
}

/// An entry of a record, each of when it happened, in milliseconds since
/// 1970.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", deny_unknown_fields)]
pub enum Entry {
    /// The workspace shared, as it was sent.
    Shared {
        /// When.
        at: u64,
        /// The viewer who presented it, of none the host.
        by: Option<String>,
        /// The workspace, as sent.
        state: Value,
    },
    /// A viewer's suggestion.
    Suggested {
        /// When.
        at: u64,
        /// Who.
        by: String,
        /// The tab it was for.
        tab: String,
        /// Its SQL.
        sql: String,
    },
    /// A viewer admitted.
    Joined {
        /// When.
        at: u64,
        /// Who.
        by: String,
    },
    /// A viewer gone.
    Left {
        /// When.
        at: u64,
        /// Who.
        by: String,
    },
    /// The record's end, as the session ended or recording stopped.
    Ended {
        /// When.
        at: u64,
    },
}

/// The milliseconds since 1970, now.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// A failure of a record, as Studio's error.
fn failed(what: &str, e: impl std::fmt::Display) -> StudioError {
    StudioError::misuse(format!("[DESIGN] the session's record cannot {what}: {e}"))
}

/// The records' key, of `secrets`: made and kept if none is, as the first
/// record is sealed.
///
/// # Errors
///
/// SQLCODE -910 if the keychain cannot keep it, or what it holds is no key.
pub fn key(secrets: &dyn SecretStore) -> Result<[u8; 32]> {
    let held = if let Some(held) = secrets.get(KEY_ENTRY)? {
        held
    } else {
        let mut made = [0_u8; 32];
        SystemRandom::new().fill(&mut made).map_err(|e| failed("make its key", e))?;
        let held = Secret::new(base64::encode(&made));
        secrets.set(KEY_ENTRY, &held)?;
        held
    };
    let bytes = base64::decode(held.expose()).ok_or_else(|| failed("read its key", "the keychain holds no key of 32 bytes"))?;
    bytes.try_into().map_err(|_| failed("read its key", "the keychain holds no key of 32 bytes"))
}

/// What seals and opens a record's lines.
struct Seal(LessSafeKey);

impl Seal {
    /// A seal of `key`.
    fn of(key: &[u8; 32]) -> Result<Seal> {
        Ok(Seal(LessSafeKey::new(UnboundKey::new(&AES_256_GCM, key).map_err(|e| failed("be keyed", e))?)))
    }

    /// `line` sealed: a random nonce, then the text and its tag, in base64.
    fn seal(&self, line: &str, session: &str) -> Result<String> {
        let mut nonce = [0_u8; NONCE_LEN];
        SystemRandom::new().fill(&mut nonce).map_err(|e| failed("seal a line", e))?;
        let mut sealed = line.as_bytes().to_vec();
        self.0
            .seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::from(session.as_bytes()), &mut sealed)
            .map_err(|e| failed("seal a line", e))?;
        let mut out = nonce.to_vec();
        out.extend(sealed);
        Ok(base64::encode(&out))
    }

    /// `line` opened.
    fn open(&self, line: &str, session: &str) -> Result<String> {
        let mut bytes = base64::decode(line.trim()).ok_or_else(|| failed("open a line", "it is not sealed text"))?;
        if bytes.len() < NONCE_LEN {
            return Err(failed("open a line", "it is too short"));
        }
        let mut sealed = bytes.split_off(NONCE_LEN);
        let nonce: [u8; NONCE_LEN] = bytes.try_into().map_err(|_| failed("open a line", "its nonce"))?;
        let opened = self
            .0
            .open_in_place(Nonce::assume_unique_for_key(nonce), Aad::from(session.as_bytes()), &mut sealed)
            .map_err(|_| failed("open a line", "the keychain's key is not the one it was sealed with"))?;
        String::from_utf8(opened.to_vec()).map_err(|e| failed("open a line", e))
    }
}

/// A record being kept.
pub struct Recorder {
    file: File,
    path: PathBuf,
    session: String,
    seal: Option<Seal>,
    /// The workspace's tabs last kept, to keep a workspace only as it changes.
    last: Option<Value>,
}

/// The file of a new record of `session` in `dir`, made its owner's alone.
fn made(dir: &Path, session: &str, started: u64) -> Result<(File, PathBuf)> {
    crate::files::private_dir(dir)?;
    let short: String = session.chars().filter(char::is_ascii_hexdigit).take(8).collect();
    let path = dir.join(format!("session-{started}-{short}.{EXTENSION}"));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    let file = options.open(&path).map_err(|e| failed("be made", e))?;
    Ok((file, path))
}

impl Recorder {
    /// Begins a record of `session`, presented by `presenter`, in `dir`,
    /// sealed under `key` if given.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if its file cannot be made or written.
    pub fn start(dir: &Path, (session, presenter): (&str, &str), key: Option<&[u8; 32]>) -> Result<Recorder> {
        let started = now_ms();
        let (file, path) = made(dir, session, started)?;
        let seal = key.map(Seal::of).transpose()?;
        let head = Head {
            format: RECORD_FORMAT.to_owned(),
            version: RECORD_VERSION,
            session: session.to_owned(),
            presenter: presenter.to_owned(),
            started,
            sealed: seal.is_some(),
        };
        let mut recorder = Recorder { file, path, session: session.to_owned(), seal, last: None };
        let line = serde_json::to_string(&head).map_err(|e| failed("be written", e))?;
        recorder.line(&line)?;
        Ok(recorder)
    }

    /// The record's file.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Writes `line`, a line of the file.
    fn line(&mut self, line: &str) -> Result<()> {
        self.file.write_all(line.as_bytes()).and_then(|()| self.file.write_all(b"\n")).map_err(|e| failed("be written", e))
    }

    /// Keeps `entry`.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if it cannot be written.
    pub fn keep(&mut self, entry: &Entry) -> Result<()> {
        let text = serde_json::to_string(entry).map_err(|e| failed("be written", e))?;
        let line = match &self.seal {
            Some(seal) => seal.seal(&text, &self.session)?,
            None => text,
        };
        self.line(&line)
    }

    /// Keeps `state`, the workspace as it was shared, by `by` or the host,
    /// unless its tabs are as last kept: where the presenter points alone
    /// is not kept.
    ///
    /// # Errors
    ///
    /// As `keep`'s.
    pub fn shared(&mut self, state: &Value, by: Option<&str>) -> Result<()> {
        let tabs = state.get("tabs").cloned();
        if tabs.is_some() && tabs == self.last {
            return Ok(());
        }
        self.last = tabs;
        self.keep(&Entry::Shared { at: now_ms(), by: by.map(str::to_owned), state: state.clone() })
    }
}

/// A record's description, as the list of records shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordInfo {
    /// Its file.
    pub path: String,
    /// Its head.
    pub head: Head,
    /// Its size, in bytes.
    pub bytes: u64,
}

/// A record read back: its head, and its entries.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordRead {
    /// Its head.
    pub head: Head,
    /// Its entries, in order.
    pub entries: Vec<Entry>,
}

/// The head of the record at `path`, read alone.
fn head_of(path: &Path) -> Result<Head> {
    let mut first = String::new();
    BufReader::new(File::open(path).map_err(|e| failed("be read", e))?).read_line(&mut first).map_err(|e| failed("be read", e))?;
    let head: Head = serde_json::from_str(&first).map_err(|_| failed("be read", "it is no record of a session"))?;
    if head.format != RECORD_FORMAT || head.version != RECORD_VERSION {
        return Err(failed("be read", format!("a record of format {} is not read", head.version)));
    }
    Ok(head)
}

/// The records of `dir`, the latest first; a file of no record passed over.
///
/// # Errors
///
/// SQLCODE -910 if the folder cannot be read.
pub fn list(dir: &Path) -> Result<Vec<RecordInfo>> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Ok(Vec::new()) };
    let mut found: Vec<RecordInfo> = entries
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == EXTENSION))
        .filter_map(|e| {
            let head = head_of(&e.path()).ok()?;
            Some(RecordInfo { path: e.path().display().to_string(), head, bytes: e.metadata().map_or(0, |m| m.len()) })
        })
        .collect();
    found.sort_by_key(|r| std::cmp::Reverse(r.head.started));
    Ok(found)
}

/// The record at `path`, its lines opened under `key` if it is sealed.
///
/// # Errors
///
/// SQLCODE -910 of a file past `MAX_RECORD_BYTES` or `MAX_ENTRIES`, of no
/// record, sealed and of no key or another, or a line that is no entry.
pub fn read(path: &Path, key: Option<&[u8; 32]>) -> Result<RecordRead> {
    let size = std::fs::metadata(path).map_err(|e| failed("be read", e))?.len();
    if size > MAX_RECORD_BYTES {
        return Err(failed("be read", format!("it is past {MAX_RECORD_BYTES} bytes")));
    }
    let head = head_of(path)?;
    let seal = match (head.sealed, key) {
        (true, Some(key)) => Some(Seal::of(key)?),
        (true, None) => return Err(failed("be read", "it is sealed, and the keychain holds no key for it")),
        (false, _) => None,
    };
    let mut entries = Vec::new();
    for line in BufReader::new(File::open(path).map_err(|e| failed("be read", e))?).lines().skip(1) {
        let line = line.map_err(|e| failed("be read", e))?;
        if line.trim().is_empty() {
            continue;
        }
        if entries.len() >= MAX_ENTRIES {
            return Err(failed("be read", format!("it holds more than {MAX_ENTRIES} entries")));
        }
        let text = match &seal {
            Some(seal) => seal.open(&line, &head.session)?,
            None => line,
        };
        entries.push(serde_json::from_str(&text).map_err(|e| failed("be read", e))?);
    }
    Ok(RecordRead { head, entries })
}

#[cfg(test)]
mod tests;
