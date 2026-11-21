//! CSV and tab-separated text as formats of the import wizard (RULES.md
//! D43, D68): read by turborel-client's `Delimited`, a record a line,
//! fields between commas and quoted as they need [RFC 4180], or between
//! tabs; its header, delimiter and null as the reading says.

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::AtomicU64;

use turborel_client::import::{Delimited, Source};

use crate::connections::imports::format::{ImportFormat, Takes, Total, first_line, named};
use crate::connections::imports::{Format, Reading, opened};
use crate::error::Result;

/// A delimited format: CSV, or tab-separated text.
pub struct DelimitedFormat {
    id: Format,
    label: &'static str,
    extensions: &'static [&'static str],
    /// The byte between its fields.
    between: u8,
}

/// CSV.
pub static CSV: DelimitedFormat = DelimitedFormat { id: Format::Csv, label: "CSV", extensions: &["csv", "txt"], between: b',' };
/// Tab-separated text.
pub static TSV: DelimitedFormat =
    DelimitedFormat { id: Format::Tsv, label: "Tab-separated", extensions: &["tsv", "tab", "txt"], between: b'\t' };

impl ImportFormat for DelimitedFormat {
    fn id(&self) -> Format {
        self.id
    }

    fn label(&self) -> &'static str {
        self.label
    }

    fn extensions(&self) -> &'static [&'static str] {
        self.extensions
    }

    fn takes(&self) -> Takes {
        Takes { header: true, delimited: true, sheets: false }
    }

    /// Of its own extension, other than `.txt`, by name; of a first line
    /// holding its delimiter, by what it holds.
    fn detect(&self, path: &Path, first: &[u8]) -> u8 {
        let by_content = u8::from(first_line(first).contains(&self.between));
        let own: Vec<&str> = self.extensions.iter().copied().filter(|e| *e != "txt").collect();
        if named(path, &own) { by_content.saturating_add(2) } else { by_content }
    }

    fn records(
        &self,
        path: &Path,
        reading: &Reading,
        read: &Arc<AtomicU64>,
        work: &mut dyn FnMut(&mut dyn Source, Total) -> Result<()>,
    ) -> Result<()> {
        let size = std::fs::metadata(path).map_or(0, |m| m.len());
        let mut source = Delimited::new(opened(path, Arc::clone(read))?, reading.dialect()?);
        work(&mut source, Total::Bytes(size))
    }
}
