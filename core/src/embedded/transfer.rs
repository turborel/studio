//! A query's rows exported, and a file's rows imported, of an embedded
//! session (RULES.md D59), as turborel-client exports and imports a
//! server's: CSV with a header of the columns' names [RFC 4180], or the
//! protocol's own frames; a file's fields cast to the table's columns'
//! types and inserted, a batch committed at a time, a row refused skipped
//! and told where asked.

use std::io::Write;

use turborel::db::{Prepared, Session};
use turborel::storage::Row;
use turborel::value::Value;
use turborel_client::export::ExportFormat;
use turborel_client::import::{Position, Record, Source};
use turborel_protocol::{Column, Completed, Reply};

use crate::connections::imports::{CANCELLED as IMPORT_CANCELLED, ImportReport, ImportSpec, MAX_TOLD, Watch, with_mapped};
use crate::error::{Result, StudioError};

/// `field`, as CSV writes it: quoted where it must be.
fn csv_field(field: &str) -> String {
    let quoted = field.is_empty()
        || field.contains([',', '"', '\n', '\r'])
        || field.starts_with(char::is_whitespace)
        || field.ends_with(char::is_whitespace);
    if quoted { format!("\"{}\"", field.replace('"', "\"\"")) } else { field.to_owned() }
}

/// `v` as a CSV field: a null empty and unquoted.
fn csv_value(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::Char(s) => csv_field(s),
        other => csv_field(&other.to_string()),
    }
}

/// A CSV record of `fields`, ended by CR LF [RFC 4180 §2].
fn csv_record(fields: impl Iterator<Item = String>) -> Vec<u8> {
    let mut line = fields.collect::<Vec<_>>().join(",");
    line.push_str("\r\n");
    line.into_bytes()
}

/// `reply` as a frame.
fn frame(reply: &Reply) -> Vec<u8> {
    let mut bytes = Vec::new();
    reply.encode(&mut bytes);
    bytes
}

/// A failure to write the export.
fn unwritten(e: &std::io::Error) -> StudioError {
    StudioError::misuse(format!("[DESIGN] cannot write the export: {e}"))
}

/// Runs the query `sql` on `session` and writes its rows to `out` as
/// `format` says, as they come: how many.
///
/// # Errors
///
/// The query's; a statement that is no query; a write that failed.
pub fn export(session: &Session, sql: &str, out: &mut dyn Write, format: ExportFormat) -> Result<u64> {
    let mut cursor = session.open_cursor(sql)?;
    let columns: Vec<Column> = cursor.columns.iter().map(|c| Column::from(c).with_declared()).collect();
    let head = match format {
        ExportFormat::Csv => csv_record(columns.iter().map(|c| csv_field(c.name.as_deref().unwrap_or_default()))),
        ExportFormat::Native => frame(&Reply::Description(columns)),
    };
    out.write_all(&head).map_err(|e| unwritten(&e))?;
    let mut count = 0u64;
    while let Some(row) = cursor.fetch()? {
        let bytes = match format {
            ExportFormat::Csv => csv_record(row.iter().map(csv_value)),
            ExportFormat::Native => frame(&Reply::Rows(vec![row])),
        };
        out.write_all(&bytes).map_err(|e| unwritten(&e))?;
        count = count.saturating_add(1);
    }
    if format == ExportFormat::Native {
        out.write_all(&frame(&Reply::Complete(Completed::of(0, "00000")))).map_err(|e| unwritten(&e))?;
    }
    out.flush().map_err(|e| unwritten(&e))?;
    Ok(count)
}

/// `n` rows, as an import tells them.
fn rows(n: u64) -> String {
    if n == 1 { "1 row".to_owned() } else { format!("{n} rows") }
}

/// An import under way: its INSERT, rows committed, in the batch under
/// way, and skipped, and what was told of those skipped.
struct Run<'a> {
    session: &'a Session,
    insert: Prepared,
    spec: &'a ImportSpec,
    committed: u64,
    in_batch: u64,
    rejected: u64,
    skipped: Vec<String>,
}

impl Run<'_> {
    /// The import stopped at `position` by `cause`: the batch under way
    /// rolled back, and what was kept told.
    fn stop(&mut self, position: Option<&Position>, cause: &StudioError) -> StudioError {
        let _ = self.session.rollback(); // The batch is undone; the failure is the one told.
        let at = position.map(|p| format!("{p}: ")).unwrap_or_default();
        let told = format!("{at}{}; {} committed, {} rolled back", cause.message, rows(self.committed), self.in_batch);
        StudioError::new(cause.sqlcode, &cause.sqlstate, format!("[DESIGN] the import stopped: {told}"))
    }

    /// Commits the batch under way.
    fn commit(&mut self) -> Result<()> {
        if let Err(e) = self.session.commit() {
            return Err(self.stop(None, &StudioError::from(e)));
        }
        self.committed = self.committed.saturating_add(self.in_batch);
        self.in_batch = 0;
        Ok(())
    }

    /// `values` cast to the types of the INSERT's parameters.
    fn typed(&self, values: Row) -> Result<Vec<Value>> {
        let wanted = self.insert.parameters().len();
        if values.len() != wanted {
            return Err(StudioError::misuse(format!("[DESIGN] {} fields, for {wanted} columns", values.len())));
        }
        self.insert
            .parameters()
            .iter()
            .zip(values)
            .map(
                |(p, v)| {
                    if v.is_null() { Ok(Value::Null) } else { turborel::value::cast(v, &p.clone().data_type()).map_err(StudioError::from) }
                },
            )
            .collect()
    }

    /// Inserts `record`, committing its batch if it ends one; a row
    /// refused skipped if the spec says, and it alone was undone.
    fn row(&mut self, record: Record) -> Result<()> {
        let position = record.position;
        let inserted = self.typed(record.values).and_then(|v| self.session.execute_prepared(&self.insert, &v).map_err(StudioError::from));
        match inserted {
            Ok(_) => {
                self.in_batch = self.in_batch.saturating_add(1);
                if self.in_batch == self.spec.batch { self.commit() } else { Ok(()) }
            }
            Err(e) => {
                let alone = self.in_batch == 0 || self.session.transaction_mode().is_some();
                if !self.spec.skip || !alone || e.sqlcode == CANCELLED {
                    return Err(self.stop(Some(&position), &e));
                }
                self.rejected = self.rejected.saturating_add(1);
                if self.skipped.len() < MAX_TOLD {
                    self.skipped.push(format!("{position}: {}; skipped", e.message));
                }
                Ok(())
            }
        }
    }
}

/// The SQLCODE of a statement cancelled, which stops an import whatever it skips.
const CANCELLED: i32 = -920;

/// Imports the file `spec` names through `session`, as it says, as
/// turborel-client imports one over a connection: no transaction active
/// as it begins, a batch committed at a time, a row refused skipped where
/// asked and it alone was undone, else the import stopped, its batch
/// rolled back; told and heard as `watch` says, a cancel rolling back the
/// batch under way.
///
/// # Errors
///
/// SQLCODE -910 if no field goes into a column, the file cannot be read,
/// or a transaction is active; the import stopped: where, why, and how
/// many rows were committed and rolled back.
pub fn import(session: &Session, spec: &ImportSpec, watch: Option<&Watch<'_>>) -> Result<ImportReport> {
    if session.transaction_mode().is_some() {
        return Err(StudioError::misuse("[DESIGN] an import begins with no transaction active, as it commits its batches"));
    }
    with_mapped(spec, watch, |source, rejected| {
        let headings = source.headings().map_err(|e| StudioError::misuse(format!("[DESIGN] {}: {}", e.position, e.message)))?;
        let names: Vec<String> = headings.unwrap_or_default().into_iter().map(|h| h.name).collect();
        let marks = vec!["?"; names.len()].join(", ");
        let insert = session.prepare(&format!("INSERT INTO {} ({}) VALUES ({marks})", spec.table, names.join(", ")))?;
        let mut run = Run { session, insert, spec, committed: 0, in_batch: 0, rejected: 0, skipped: Vec::new() };
        loop {
            let record = match source.record() {
                Ok(record) => record,
                Err(e) if e.message == IMPORT_CANCELLED => {
                    let _ = session.rollback(); // The batch under way is undone.
                    let rolled_back = run.in_batch;
                    return Ok(ImportReport {
                        rows: run.committed,
                        rejected: run.rejected,
                        skipped: run.skipped,
                        cancelled: true,
                        rolled_back,
                    });
                }
                Err(e) => return Err(run.stop(Some(&e.position), &StudioError::misuse(format!("[DESIGN] {}", e.message)))),
            };
            let Some(record) = record else { break };
            run.row(record)?;
            rejected.store(run.rejected, std::sync::atomic::Ordering::Relaxed);
        }
        run.commit()?;
        Ok(ImportReport { rows: run.committed, rejected: run.rejected, skipped: run.skipped, cancelled: false, rolled_back: 0 })
    })
}

/// Writes the rows of the query `sql` on `session` to `path` as `how`
/// says (RULES.md D65), each large object read whole, as they come: how
/// many.
///
/// # Errors
///
/// The query's; a value not scripted; the file's.
pub fn script_rows(
    session: &Session,
    sql: &str,
    how: &crate::connections::scripted::RowsAs,
    (path, append): (&std::path::Path, bool),
) -> Result<u64> {
    use crate::connections::scripted::{RowWriter, readable, rows_file, whole};
    let mut file = rows_file(path, append)?;
    let mut writer = RowWriter::new(&mut file, how);
    let mut cursor = session.open_cursor(sql)?;
    while let Some(row) = cursor.fetch()? {
        let row = row
            .into_iter()
            .map(|v| match v {
                Value::Lob(lob) if lob.inline().is_none() => {
                    readable(lob.octets())?;
                    Ok(whole(lob.kind(), &lob.reader().read(0, lob.octets())?))
                }
                other => Ok(other),
            })
            .collect::<Result<Vec<_>>>()?;
        writer.row(&row);
    }
    writer.finish()
}
