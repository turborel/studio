//! Rows imported from a CSV or tab-separated file (`[CLIENT Importing]`,
//! RULES.md D43): the file previewed, its first records as the grid shows
//! them; each field taken into the column the user chose, or skipped; and
//! the rows inserted by turborel-client's `import`, which copies where the
//! server grants it, a batch committed at a time.

use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use turborel::value::Value;
use turborel_client::agent::Connected;
use turborel_client::import::{Delimited, Dialect, Import, Rejected, import};
use turborel_client::import::{Heading, Record, Source, SourceError};

use crate::connections::cells::{Cell, cell};
use crate::error::{Result, StudioError};

/// The records a preview shows.
pub const PREVIEW_RECORDS: usize = 20;
/// The rows skipped an import tells of, at most.
pub const MAX_TOLD: usize = 100;

/// How a file's fields are written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Format {
    /// Fields between commas, quoted as they need [RFC 4180].
    Csv,
    /// Fields between tabs, never quoted.
    Tsv,
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
}

impl Reading {
    /// The dialect turborel-client reads by.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for a delimiter that is not one ASCII character, not a
    /// quote or a line break.
    pub fn dialect(&self) -> Result<Dialect> {
        let base = match self.format {
            Format::Csv => Dialect::csv(),
            Format::Tsv => Dialect::tsv(),
        };
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
}

/// What a source's failure says.
fn told(e: &SourceError) -> StudioError {
    StudioError::misuse(format!("[DESIGN] {}: {}", e.position, e.message))
}

/// The file at `path`, read as `reading` says.
fn source(path: &std::path::Path, reading: &Reading) -> Result<Delimited<BufReader<File>>> {
    let file = File::open(path).map_err(|e| StudioError::misuse(format!("[DESIGN] {}: {e}", path.display())))?;
    Ok(Delimited::new(BufReader::new(file), reading.dialect()?))
}

/// The first `PREVIEW_RECORDS` records of the file at `path`, read as
/// `reading` says.
///
/// # Errors
///
/// SQLCODE -910 if the file cannot be read, or a record of it.
pub fn preview(path: &std::path::Path, reading: &Reading) -> Result<Preview> {
    let mut source = source(path, reading)?;
    let headings = source.headings().map_err(|e| told(&e))?.map(|h| h.into_iter().map(|h| h.name).collect());
    let mut records = Vec::new();
    while records.len() < PREVIEW_RECORDS {
        match source.record().map_err(|e| told(&e))? {
            Some(record) => records.push(record.values.iter().map(cell).collect()),
            None => break,
        }
    }
    Ok(Preview { headings, records })
}

/// An import: the file, how it is read, the table, the column each field
/// goes into or none for a field skipped, the rows a batch commits, and
/// whether a row refused is skipped.
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
}

/// What an import did: the rows inserted and committed, those skipped, and
/// what was told of the first of them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    /// The rows inserted and committed.
    pub rows: u64,
    /// The rows skipped.
    pub rejected: u64,
    /// What was told of the first `MAX_TOLD` of those skipped.
    pub skipped: Vec<String>,
}

/// A source whose fields go into the columns chosen: those of no column
/// let go.
struct Mapped<S> {
    inner: S,
    /// The fields kept, by place.
    keep: Vec<usize>,
    /// Their columns' names, as delimited identifiers.
    names: Vec<String>,
    header_read: bool,
}

impl<S: Source> Source for Mapped<S> {
    fn headings(&mut self) -> std::result::Result<Option<Vec<Heading>>, SourceError> {
        if !self.header_read {
            self.header_read = true;
            self.inner.headings()?;
        }
        Ok(Some(self.names.iter().map(|name| Heading { name: name.clone(), data_type: None }).collect()))
    }

    fn record(&mut self) -> std::result::Result<Option<Record>, SourceError> {
        let Some(record) = self.inner.record()? else { return Ok(None) };
        let values = self.keep.iter().map(|&at| record.values.get(at).cloned().unwrap_or(Value::Null)).collect();
        Ok(Some(Record { values, position: record.position }))
    }
}

/// `name` as a delimited identifier.
fn delimited(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Imports the file `spec` names over `connection`, as it says.
///
/// # Errors
///
/// SQLCODE -910 if no field goes into a column, the file cannot be read,
/// or the import stops: where, why, and how many rows were committed and
/// rolled back.
pub fn run_import(connection: &mut Connected, spec: &ImportSpec) -> Result<ImportReport> {
    let keep: Vec<usize> = spec.fields.iter().enumerate().filter_map(|(at, f)| f.as_ref().map(|_| at)).collect();
    if keep.is_empty() {
        return Err(StudioError::misuse("[DESIGN] an import takes at least one field into a column"));
    }
    let names = spec.fields.iter().flatten().map(|n| delimited(n)).collect();
    let mut mapped = Mapped { inner: source(&spec.path, &spec.reading)?, keep, names, header_read: false };
    let how = Import { table: spec.table.clone(), batch: spec.batch, skip: spec.skip };
    let mut skipped = Vec::new();
    let done = import(connection, &mut mapped, &how, &mut |r: Rejected| {
        if skipped.len() < MAX_TOLD {
            skipped.push(r.to_string());
        }
    });
    match done {
        Ok(done) => Ok(ImportReport { rows: done.rows, rejected: done.rejected, skipped }),
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
