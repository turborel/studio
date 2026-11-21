//! Import formats as plug-ins (RULES.md D68): each format one
//! `ImportFormat`, which detects its files, says what of a reading it
//! takes, gives a file's choices (a workbook's sheets), streams the file's
//! records as turborel-client's `Source`, and infers each field's type of a
//! sample, the shared inference at first. What the wizard does with a
//! format, the preview, the sample, the progress, the cancel and the
//! error policy, is the same for every format, around these. A format is
//! added as a module implementing it, a variant of `Format`, and a line of
//! `formats()`.

use std::io::Read;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::AtomicU64;

use serde::Serialize;
use turborel_client::import::Source;

use crate::connections::cells::Cell;
use crate::connections::imports::infer::{Inferred, infer};
use crate::connections::imports::{Format, Reading};
use crate::error::{Result, StudioError};

/// What of a reading a format takes, as the wizard offers it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Takes {
    /// Whether its first record may name the fields.
    pub header: bool,
    /// Whether it takes a delimiter and the text of a null.
    pub delimited: bool,
    /// Whether a file of it holds sheets, one chosen.
    pub sheets: bool,
}

/// How far a file's records are read, as an import's progress tells it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Total {
    /// The file's bytes, its bytes read counted as they are.
    Bytes(u64),
    /// Its records, if known, its records read counted.
    Records(u64),
}

/// The bytes of a file's start a format is detected by.
pub const DETECTED_BY: usize = 8192;

/// A format of the import wizard.
pub trait ImportFormat: Sync {
    /// Its name, as a reading names it.
    fn id(&self) -> Format;

    /// Its name, as the wizard shows it.
    fn label(&self) -> &'static str;

    /// The extensions of its files, the platform's dialog offering them.
    fn extensions(&self) -> &'static [&'static str];

    /// What of a reading it takes.
    fn takes(&self) -> Takes;

    /// How surely `first`, the start of the file named `path`, is of it:
    /// 0 not, 1 by what it holds, 2 by its name too.
    fn detect(&self, path: &Path, first: &[u8]) -> u8;

    /// The file's choices, as a workbook's sheets; none of a format of none.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the file cannot be read.
    fn choices(&self, _path: &Path) -> Result<Option<Vec<String>>> {
        Ok(None)
    }

    /// Runs `work` with the records of the file at `path`, read as
    /// `reading` says, its bytes read counted in `read` where the total is
    /// of bytes.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the file cannot be opened, or read as the format;
    /// what `work` gives.
    fn records(
        &self,
        path: &Path,
        reading: &Reading,
        read: &Arc<AtomicU64>,
        work: &mut dyn FnMut(&mut dyn Source, Total) -> Result<()>,
    ) -> Result<()>;

    /// The type of each of `width` fields, of `sample`, a file's first records.
    fn infer(&self, sample: &[Vec<Cell>], width: usize) -> Vec<Inferred> {
        infer(sample, width)
    }
}

/// Whether `path`'s extension is one of `extensions`, in any case.
pub fn named(path: &Path, extensions: &[&str]) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| extensions.iter().any(|x| x.eq_ignore_ascii_case(e)))
}

/// `first`'s first byte that is not white space.
pub fn first_byte(first: &[u8]) -> Option<u8> {
    first.iter().copied().find(|b| !b.is_ascii_whitespace())
}

/// `first`'s first line.
pub fn first_line(first: &[u8]) -> &[u8] {
    first.split(|&b| b == b'\n').next().unwrap_or_default()
}

/// Every format of the wizard, in the order it offers them.
pub fn formats() -> [&'static dyn ImportFormat; 5] {
    [
        &crate::connections::imports::delimited::CSV,
        &crate::connections::imports::delimited::TSV,
        &crate::connections::imports::json::JSON,
        &crate::connections::imports::json::NDJSON,
        &crate::connections::imports::xlsx::XLSX,
    ]
}

/// The format `id` names.
pub fn format_of(id: Format) -> &'static dyn ImportFormat {
    formats().into_iter().find(|f| f.id() == id).unwrap_or(&crate::connections::imports::delimited::CSV)
}

/// A format as the wizard offers it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatInfo {
    /// Its name, as a reading names it.
    pub id: Format,
    /// Its name, as shown.
    pub label: &'static str,
    /// The extensions of its files.
    pub extensions: &'static [&'static str],
    /// What of a reading it takes.
    pub takes: Takes,
}

/// Every format, as the wizard offers them.
pub fn offered() -> Vec<FormatInfo> {
    formats().into_iter().map(|f| FormatInfo { id: f.id(), label: f.label(), extensions: f.extensions(), takes: f.takes() }).collect()
}

/// The format the file at `path` is most surely of, by its name and what
/// it begins with; none of a file no format knows.
///
/// # Errors
///
/// SQLCODE -910 if the file cannot be read.
pub fn detect(path: &Path) -> Result<Option<Format>> {
    let mut first = Vec::with_capacity(DETECTED_BY);
    std::fs::File::open(path)
        .and_then(|f| f.take(u64::try_from(DETECTED_BY).unwrap_or(u64::MAX)).read_to_end(&mut first))
        .map_err(|e| StudioError::misuse(format!("[DESIGN] {}: {e}", path.display())))?;
    let best =
        formats().into_iter().map(|f| (f.detect(path, &first), f.id())).filter(|(score, _)| *score > 0).max_by_key(|(score, _)| *score);
    Ok(best.map(|(_, id)| id))
}

#[cfg(test)]
mod tests;
