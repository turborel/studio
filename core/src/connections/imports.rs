//! Rows imported from a file (`[CLIENT Importing]`, RULES.md D43, D63):
//! CSV or tab-separated text, JSON, as an array of objects or an object a
//! line, or an Excel sheet, each a plug-in of one interface (D68:
//! `format`); the file previewed, its first records as the
//! grid shows them, and each field's type inferred for a new table; each
//! field taken into the column the user chose, or skipped; and the rows
//! inserted by turborel-client's `import`, which copies where the server
//! grants it, a batch committed at a time, its progress told and a cancel
//! heard between records.

pub mod delimited;
pub mod format;
pub mod infer;
pub mod json;
pub mod xlsx;

use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use turborel::value::Value;
use turborel_client::agent::Connected;
use turborel_client::import::{Dialect, Import, Rejected, import};
use turborel_client::import::{Heading, Position, Record, Source, SourceError};

use crate::connections::cells::{Cell, cell};
use crate::connections::imports::format::{Total, format_of};
use crate::connections::imports::infer::Inferred;
use crate::error::{Result, StudioError};

/// The records a preview shows.
pub const PREVIEW_RECORDS: usize = 20;
/// The rows skipped an import tells of, at most.
pub const MAX_TOLD: usize = 100;

/// How a file's fields are written: its format, a plug-in (D68).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Format {
    /// Fields between commas, quoted as they need [RFC 4180].
    Csv,
    /// Fields between tabs, never quoted.
    Tsv,
    /// One JSON array of objects [RFC 8259], a record an object.
    Json,
    /// One JSON object a line.
    Ndjson,
    /// A sheet of an Excel workbook, `.xlsx`, a record a row.
    Xlsx,
}

/// How a file is read: its format, whether its first record names its
/// fields, another delimiter, and the text of a null.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reading {
    /// CSV or tab-separated.
    pub format: Format,
    /// Whether the first record names the fields.
    pub header: bool,
    /// The character between fields, if not the format's own.
    pub delimiter: Option<char>,
    /// The text a field not in quotes is written as to be null, if not the
    /// empty one.
    pub null: Option<String>,
    /// The sheet of a workbook, if not its first.
    #[serde(default)]
    pub sheet: Option<String>,
}

impl Reading {
    /// The dialect turborel-client reads by.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for a delimiter that is not one ASCII character, not a
    /// quote or a line break.
    pub fn dialect(&self) -> Result<Dialect> {
        let base = if self.format == Format::Tsv { Dialect::tsv() } else { Dialect::csv() };
        let base = if self.header { base.with_header() } else { base };
        let base = match &self.null {
            Some(null) => base.with_null(null),
            None => base,
        };
        match self.delimiter {
            Some(d) => base.with_delimiter(d).map_err(StudioError::misuse),
            None => Ok(base),
        }
    }
}

/// A file's first records, as its preview shows them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    /// The names its header gives its fields, if it has one.
    pub headings: Option<Vec<String>>,
    /// Its first records' fields, a null as none.
    pub records: Vec<Vec<Cell>>,
    /// Each field's type, inferred from its first `infer::SAMPLED` records.
    pub inferred: Vec<Inferred>,
    /// The sheets of a workbook, in order; none of another file.
    pub sheets: Option<Vec<String>>,
}

/// What a source's failure says.
fn told(e: &SourceError) -> StudioError {
    StudioError::misuse(format!("[DESIGN] {}: {}", e.position, e.message))
}

/// The file at `path`, opened, its bytes read counted in `read`.
pub(crate) fn opened(path: &Path, read: Arc<AtomicU64>) -> Result<BufReader<Counted>> {
    let file = File::open(path).map_err(|e| StudioError::misuse(format!("[DESIGN] {}: {e}", path.display())))?;
    Ok(BufReader::new(Counted { file, read }))
}

/// A file whose bytes read are counted, for an import's progress.
pub(crate) struct Counted {
    file: File,
    read: Arc<AtomicU64>,
}

impl Read for Counted {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.file.read(buf)?;
        self.read.fetch_add(u64::try_from(n).unwrap_or(0), Ordering::Relaxed);
        Ok(n)
    }
}

/// A source whose type is known only as a file is opened.
pub(crate) struct Any<'a>(pub(crate) &'a mut dyn Source);

impl Source for Any<'_> {
    fn headings(&mut self) -> std::result::Result<Option<Vec<Heading>>, SourceError> {
        self.0.headings()
    }

    fn record(&mut self) -> std::result::Result<Option<Record>, SourceError> {
        self.0.record()
    }
}

/// Runs `work` with the records of the file at `path`, read as `reading`
/// says by its format's plug-in (D68), its bytes read counted in `read`,
/// and how many there are in all.
///
/// # Errors
///
/// SQLCODE -910 if the file cannot be opened, or read as its format; what
/// `work` gives.
pub(crate) fn with_source<T>(
    path: &Path,
    reading: &Reading,
    read: &Arc<AtomicU64>,
    work: impl FnOnce(Any<'_>, Total) -> Result<T>,
) -> Result<T> {
    let mut work = Some(work);
    let mut out = None;
    format_of(reading.format).records(path, reading, read, &mut |source, total| {
        if let Some(work) = work.take() {
            out = Some(work(Any(source), total)?);
        }
        Ok(())
    })?;
    out.ok_or_else(|| StudioError::misuse("[DESIGN] a format gave no records to read"))
}

/// The first `PREVIEW_RECORDS` records of the file at `path`, read as
/// `reading` says, and each field's type inferred from its first
/// `infer::SAMPLED`.
///
/// # Errors
///
/// SQLCODE -910 if the file cannot be read, or a record of it.
pub fn preview(path: &Path, reading: &Reading) -> Result<Preview> {
    let format = format_of(reading.format);
    let sheets = format.choices(path)?;
    let read = Arc::new(AtomicU64::new(0));
    let (headings, sample) = with_source(path, reading, &read, |mut source, _| {
        let headings: Option<Vec<String>> = source.headings().map_err(|e| told(&e))?.map(|h| h.into_iter().map(|h| h.name).collect());
        let mut sample: Vec<Vec<Cell>> = Vec::new();
        while sample.len() < infer::SAMPLED {
            match source.record().map_err(|e| told(&e))? {
                Some(record) => sample.push(record.values.iter().map(cell).collect()),
                None => break,
            }
        }
        Ok((headings, sample))
    })?;
    let width = headings.as_ref().map_or_else(|| sample.iter().map(Vec::len).max().unwrap_or(0), Vec::len);
    let inferred = format.infer(&sample, width);
    let records = sample.into_iter().take(PREVIEW_RECORDS).collect();
    Ok(Preview { headings, records, inferred, sheets })
}

/// An import: the file, how it is read, the table, the column each field
/// goes into or none for a field skipped, the rows a batch commits,
/// whether a row refused is skipped, and how many may be.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportSpec {
    /// The file, one the user chose.
    pub path: PathBuf,
    /// How it is read.
    pub reading: Reading,
    /// The table, as SQL writes its name.
    pub table: String,
    /// The column each field goes into, by its name, or none.
    pub fields: Vec<Option<String>>,
    /// The rows a batch commits; 0 for all at once.
    pub batch: u64,
    /// Whether a row refused is skipped, and told.
    pub skip: bool,
    /// The rows that may be skipped before the import stops; none for any.
    #[serde(default)]
    pub limit: Option<u64>,
    /// Of each field kept, whether its column is of a binary type, whose
    /// values a file writes in hexadecimal: found by the manager.
    #[serde(skip)]
    pub binary: Vec<bool>,
}

/// What an import did: the rows inserted and committed, those skipped,
/// what was told of the first of them, and whether it was cancelled.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    /// The rows inserted and committed.
    pub rows: u64,
    /// The rows skipped.
    pub rejected: u64,
    /// What was told of the first `MAX_TOLD` of those skipped.
    pub skipped: Vec<String>,
    /// Whether the user cancelled it: the batch under way rolled back.
    pub cancelled: bool,
    /// The rows of the batch under way rolled back as it was cancelled.
    pub rolled_back: u64,
}

/// How far an import has come.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    /// The records read.
    pub records: u64,
    /// The rows skipped.
    pub rejected: u64,
    /// The file's bytes read, or a sheet's rows.
    pub read: u64,
    /// Its bytes, or rows, in all.
    pub total: u64,
}

/// What an import is told by and tells as it goes: whether to stop, and
/// where its progress goes.
pub struct Watch<'a> {
    /// Set to cancel it.
    pub stop: &'a AtomicBool,
    /// Told the progress, at most every `TOLD_EVERY`.
    pub tell: &'a dyn Fn(ImportProgress),
}

/// Where an import's progress is told, as a request carries it.
#[derive(Clone)]
pub struct Teller(pub Arc<dyn Fn(ImportProgress) + Send + Sync>);

impl std::fmt::Debug for Teller {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Teller")
    }
}

/// How often an import tells its progress, at most.
const TOLD_EVERY: Duration = Duration::from_millis(250);
/// What a source says as the import is cancelled.
pub(crate) const CANCELLED: &str = "the import was cancelled";

/// A source whose fields go into the columns chosen, those of no column
/// let go, its progress told and a cancel or too many rows skipped heard
/// between records.
pub(crate) struct Mapped<'a, S> {
    inner: S,
    /// The fields kept, by place.
    keep: Vec<usize>,
    /// Their columns' names, as delimited identifiers.
    names: Vec<String>,
    header_read: bool,
    watch: Option<&'a Watch<'a>>,
    /// The file's bytes read, or none of a sheet, and their total.
    read: (Arc<AtomicU64>, u64),
    records: u64,
    /// The rows skipped, and how many may be.
    rejected: (Arc<AtomicU64>, Option<u64>),
    told: Instant,
    /// Of each field kept, whether its value is a binary string written
    /// in hexadecimal.
    binary: Vec<bool>,
}

impl<S: Source> Mapped<'_, S> {
    /// Tells the progress, if it is time, or if `last`.
    pub(crate) fn tell(&mut self, last: bool) {
        if let Some(watch) = self.watch
            && (last || self.told.elapsed() >= TOLD_EVERY)
        {
            self.told = Instant::now();
            let read = self.read.0.load(Ordering::Relaxed);
            let read = if read == 0 { self.records } else { read };
            (watch.tell)(ImportProgress {
                records: self.records,
                rejected: self.rejected.0.load(Ordering::Relaxed),
                read,
                total: self.read.1,
            });
        }
    }
}

impl<S: Source> Source for Mapped<'_, S> {
    fn headings(&mut self) -> std::result::Result<Option<Vec<Heading>>, SourceError> {
        if !self.header_read {
            self.header_read = true;
            self.inner.headings()?;
        }
        Ok(Some(self.names.iter().map(|name| Heading { name: name.clone(), data_type: None }).collect()))
    }

    fn record(&mut self) -> std::result::Result<Option<Record>, SourceError> {
        let next = Position { record: self.records.saturating_add(1), line: None };
        if self.watch.is_some_and(|w| w.stop.load(Ordering::SeqCst)) {
            return Err(SourceError { position: next, message: CANCELLED.to_owned() });
        }
        let rejected = self.rejected.0.load(Ordering::Relaxed);
        if let Some(limit) = self.rejected.1
            && rejected > limit
        {
            return Err(SourceError { position: next, message: format!("more than {limit} rows were refused") });
        }
        self.tell(false);
        let Some(record) = self.inner.record()? else { return Ok(None) };
        self.records = self.records.saturating_add(1);
        let mut values: Vec<Value> = self.keep.iter().map(|&at| record.values.get(at).cloned().unwrap_or(Value::Null)).collect();
        for (value, _) in values.iter_mut().zip(&self.binary).filter(|(_, binary)| **binary) {
            if let Value::Char(hex) = value {
                let octets = crate::connections::values::octets_of_hex(hex)
                    .map_err(|e| SourceError { position: record.position, message: e.message })?;
                *value = Value::Binary(turborel::value::Binary::new(octets));
            }
        }
        Ok(Some(Record { values, position: record.position }))
    }
}

/// `name` as a delimited identifier.
fn delimited(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Runs `work` with the file `spec` names, its fields that go into
/// columns alone, each heading its column's name as a delimited
/// identifier, told and heard as `watch` says, and the count of rows
/// skipped it hears.
///
/// # Errors
///
/// SQLCODE -910 if no field goes into a column, or the file cannot be
/// opened; what `work` gives.
pub(crate) fn with_mapped<T>(
    spec: &ImportSpec,
    watch: Option<&Watch<'_>>,
    work: impl FnOnce(&mut Mapped<'_, Any<'_>>, &Arc<AtomicU64>) -> Result<T>,
) -> Result<T> {
    let keep: Vec<usize> = spec.fields.iter().enumerate().filter_map(|(at, f)| f.as_ref().map(|_| at)).collect();
    if keep.is_empty() {
        return Err(StudioError::misuse("[DESIGN] an import takes at least one field into a column"));
    }
    let names = spec.fields.iter().flatten().map(|n| delimited(n)).collect();
    let read = Arc::new(AtomicU64::new(0));
    let rejected = Arc::new(AtomicU64::new(0));
    with_source(&spec.path, &spec.reading, &read, |inner, total| {
        let (counted, total) = match total {
            Total::Bytes(bytes) => (Arc::clone(&read), bytes),
            Total::Records(records) => (Arc::new(AtomicU64::new(0)), records),
        };
        let mut mapped = Mapped {
            inner,
            keep,
            names,
            header_read: false,
            watch,
            read: (counted, total),
            records: 0,
            rejected: (Arc::clone(&rejected), spec.limit),
            told: Instant::now(),
            binary: spec.binary.clone(),
        };
        let done = work(&mut mapped, &rejected);
        mapped.tell(true);
        done
    })
}

/// Imports the file `spec` names over `connection`, as it says, told and
/// heard as `watch` says.
///
/// # Errors
///
/// SQLCODE -910 if no field goes into a column, the file cannot be read,
/// or the import stops: where, why, and how many rows were committed and
/// rolled back.
pub fn run_import(connection: &mut Connected, spec: &ImportSpec, watch: Option<&Watch<'_>>) -> Result<ImportReport> {
    let how = Import { table: spec.table.clone(), batch: spec.batch, skip: spec.skip };
    let mut skipped = Vec::new();
    let done = with_mapped(spec, watch, |mapped, rejected| {
        Ok(import(connection, mapped, &how, &mut |r: Rejected| {
            rejected.fetch_add(1, Ordering::Relaxed);
            if skipped.len() < MAX_TOLD {
                skipped.push(r.to_string());
            }
        }))
    })?;
    match done {
        Ok(done) => Ok(ImportReport { rows: done.rows, rejected: done.rejected, skipped, cancelled: false, rolled_back: 0 }),
        Err(stopped) if matches!(&stopped.cause, turborel_client::import::Cause::Input(m) if m.ends_with(CANCELLED)) => {
            let rejected = u64::try_from(skipped.len()).unwrap_or(0);
            Ok(ImportReport { rows: stopped.committed, rejected, skipped, cancelled: true, rolled_back: stopped.rolled_back })
        }
        Err(stopped) => {
            let (sqlcode, sqlstate) = match &stopped.cause {
                turborel_client::import::Cause::Sql(failure) => (failure.sqlcode, failure.sqlstate.clone()),
                turborel_client::import::Cause::Input(_) => (-910, "TB910".to_owned()),
            };
            Err(StudioError::new(sqlcode, &sqlstate, format!("[DESIGN] the import stopped: {stopped}")))
        }
    }
}

#[cfg(test)]
mod tests;
