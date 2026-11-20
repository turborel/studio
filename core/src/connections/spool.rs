//! A result's pages, kept on disk as they are read, so a result of any
//! length never sits whole in memory (RULES.md R-SAFE-1, D25). Each page
//! is sealed by AES-256-GCM under a key made for the result and held in
//! memory alone, so the file is of no use to anyone else; the file is
//! its owner's alone (R-SEC-2), and removed as the result is closed.

use std::fmt::Write as _;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;

use aws_lc_rs::aead::{AES_256_GCM, Aad, LessSafeKey, NONCE_LEN, Nonce, UnboundKey};
use aws_lc_rs::rand::{SecureRandom, SystemRandom};

use crate::error::{Result, StudioError};

/// The bytes of an AES-256 key.
const KEY_BYTES: usize = 32;
/// The bytes of a spool file's random name.
const NAME_BYTES: usize = 16;
/// The most a result's spool holds, in bytes (CONFORMANCE.md S-LIMIT-1):
/// past it, the rest of the result is to be exported, not browsed.
pub const MAX_SPOOL_BYTES: u64 = 1 << 30;
/// The prefix of a spool file's name.
const PREFIX: &str = "turborel-studio-";

/// A page's place in the file.
#[derive(Debug, Clone, Copy)]
struct Extent {
    offset: u64,
    length: usize,
}

/// A spool: sealed pages, appended and read back by number.
pub struct Spool {
    file: File,
    path: PathBuf,
    key: LessSafeKey,
    extents: Vec<Extent>,
    end: u64,
}

impl std::fmt::Debug for Spool {
    /// Never the key.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Spool").field("path", &self.path).field("pages", &self.extents.len()).finish_non_exhaustive()
    }
}

/// An I/O failure of the spool, as Studio's error.
fn failed(what: &str, e: &dyn std::fmt::Display) -> StudioError {
    StudioError::misuse(format!("[DESIGN] the result's spool cannot {what}: {e}"))
}

/// `bytes` of the system's randomness.
fn random<const N: usize>() -> Result<[u8; N]> {
    let mut bytes = [0_u8; N];
    SystemRandom::new().fill(&mut bytes).map_err(|e| failed("be keyed", &e))?;
    Ok(bytes)
}

/// The file at `path`, made new, readable and writable by its owner alone.
fn owner_only(path: &PathBuf) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        /// Read and write for the owner alone (R-SEC-2).
        const OWNER_ONLY: u32 = 0o600;
        options.mode(OWNER_ONLY);
    }
    options.open(path)
}

impl Spool {
    /// A new spool, in `dir`, under a random name.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the file cannot be made or the key drawn.
    pub fn new(dir: &std::path::Path) -> Result<Spool> {
        let name = random::<NAME_BYTES>()?.iter().fold(String::new(), |mut name, b| {
            // Writing to a String cannot fail.
            let _ = write!(name, "{b:02x}");
            name
        });
        let path = dir.join(format!("{PREFIX}{name}"));
        let file = owner_only(&path).map_err(|e| failed("be made", &e))?;
        let bytes = random::<KEY_BYTES>()?;
        let key = LessSafeKey::new(UnboundKey::new(&AES_256_GCM, &bytes).map_err(|e| failed("be keyed", &e))?);
        Ok(Spool { file, path, key, extents: Vec::new(), end: 0 })
    }

    /// The nonce of page `number`: its number, unique under the spool's key.
    fn nonce(number: usize) -> Nonce {
        let mut bytes = [0_u8; NONCE_LEN];
        let n = u64::try_from(number).unwrap_or(u64::MAX).to_le_bytes();
        for (to, from) in bytes.iter_mut().zip(n) {
            *to = from;
        }
        Nonce::assume_unique_for_key(bytes)
    }

    /// Appends `page`, sealed, and gives its number.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if it cannot be written, or the spool would pass
    /// `MAX_SPOOL_BYTES`.
    pub fn append(&mut self, page: &[u8]) -> Result<usize> {
        let number = self.extents.len();
        let mut sealed = page.to_vec();
        self.key.seal_in_place_append_tag(Spool::nonce(number), Aad::empty(), &mut sealed).map_err(|e| failed("seal a page", &e))?;
        let length = u64::try_from(sealed.len()).unwrap_or(u64::MAX);
        let end = self.end.checked_add(length).filter(|end| *end <= MAX_SPOOL_BYTES);
        let Some(end) = end else {
            return Err(StudioError::misuse("[DESIGN] the result is longer than Studio keeps to browse: export it instead"));
        };
        self.file.seek(SeekFrom::Start(self.end)).and_then(|_| self.file.write_all(&sealed)).map_err(|e| failed("write", &e))?;
        self.extents.push(Extent { offset: self.end, length: sealed.len() });
        self.end = end;
        Ok(number)
    }

    /// Page `number`, opened.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if there is no such page, or it cannot be read or
    /// opened, as a file changed under it would be.
    pub fn read(&mut self, number: usize) -> Result<Vec<u8>> {
        let extent = *self.extents.get(number).ok_or_else(|| StudioError::misuse("[DESIGN] the result has no such page"))?;
        let mut sealed = vec![0_u8; extent.length];
        self.file.seek(SeekFrom::Start(extent.offset)).and_then(|_| self.file.read_exact(&mut sealed)).map_err(|e| failed("read", &e))?;
        let opened = self.key.open_in_place(Spool::nonce(number), Aad::empty(), &mut sealed).map_err(|e| failed("open a page", &e))?;
        Ok(opened.to_vec())
    }

    /// How many pages it holds.
    pub fn pages(&self) -> usize {
        self.extents.len()
    }
}

/// Removes the spool files left in `dir` by a Studio that ended without
/// closing its results, as one that crashed does: their keys died with it,
/// so they are of no use.
///
/// # Errors
///
/// SQLCODE -910 if `dir` cannot be read.
pub fn clear_stale(dir: &std::path::Path) -> Result<usize> {
    let mut removed = 0_usize;
    for entry in std::fs::read_dir(dir).map_err(|e| failed("be listed", &e))? {
        let path = entry.map_err(|e| failed("be listed", &e))?.path();
        if path.file_name().is_some_and(|n| n.to_string_lossy().starts_with(PREFIX)) && std::fs::remove_file(&path).is_ok() {
            removed = removed.saturating_add(1);
        }
    }
    Ok(removed)
}

impl Drop for Spool {
    /// The file removed with the result.
    fn drop(&mut self) {
        // A file already gone harms no one.
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests;
