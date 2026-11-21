//! A table's rows written as INSERT statements (RULES.md D65), so a
//! generated script carries its data and Run SQL File (D62) loads it back:
//! a statement a row, each value written as Turborel writes its literal
//! (`Value::to_literal`), a number every digit of it; a generated column
//! left out, as INSERT takes none; an identity column GENERATED ALWAYS
//! given its value by OVERRIDING SYSTEM VALUE
//! ([DOC sql/statements/insert.md RULES]). A large object is written
//! whole only if it came whole; one sent by its locator is refused, by
//! its table, not written cut.

use std::io::Write;

use turborel::storage::Row;
use turborel::value::Value;
use turborel_client::Column;
use turborel_client::connection::Sink;

use crate::catalog::model::TableDetail;
use crate::error::{Result, StudioError};

/// `name` as a delimited identifier.
fn delimited(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// The rows of `table` to script: the query that reads them, and the
/// start of each INSERT of one, up to VALUES.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Scripted {
    /// The query of its rows, of the columns an INSERT takes.
    pub query: String,
    /// `INSERT INTO <table> (<columns>) [OVERRIDING SYSTEM VALUE] VALUES `.
    pub prefix: String,
    /// The table, as SQL writes it, to tell it by.
    pub table: String,
}

/// What scripts the rows of `table`; none if it has no column an INSERT
/// takes.
pub fn scripted(table: &TableDetail) -> Option<Scripted> {
    let columns: Vec<_> = table.columns.iter().filter(|c| c.generated.is_none()).collect();
    if columns.is_empty() {
        return None;
    }
    let names = columns.iter().map(|c| delimited(&c.name)).collect::<Vec<_>>().join(", ");
    let qualified = format!("{}.{}", delimited(&table.schema), delimited(&table.name));
    let always = columns.iter().any(|c| c.identity.as_deref() == Some("ALWAYS"));
    let overriding = if always { " OVERRIDING SYSTEM VALUE" } else { "" };
    Some(Scripted {
        query: format!("SELECT {names} FROM {qualified}"),
        prefix: format!("INSERT INTO {qualified} ({names}){overriding} VALUES "),
        table: qualified,
    })
}

/// `v` as a literal of an INSERT.
///
/// # Errors
///
/// SQLCODE -910 for a large object not held whole.
pub fn literal(v: &Value) -> Result<String> {
    if let Value::Lob(lob) = v
        && lob.inline().is_none()
    {
        return Err(StudioError::misuse(format!(
            "[DESIGN] a large object of {} octets came by its locator, and is not scripted: export the table's rows instead",
            lob.octets()
        )));
    }
    Ok(v.to_literal())
}

/// The INSERT of `row`, of `prefix`, ended by `;` and a line break.
///
/// # Errors
///
/// As `literal`'s.
pub fn insert(prefix: &str, row: &[Value]) -> Result<String> {
    let values = row.iter().map(literal).collect::<Result<Vec<_>>>()?;
    Ok(format!("{prefix}({});\n", values.join(", ")))
}

/// The script at `path`, opened to have more written at its end.
///
/// # Errors
///
/// SQLCODE -910 if it cannot be opened.
pub fn appended(path: &std::path::Path) -> Result<std::fs::File> {
    std::fs::OpenOptions::new().append(true).open(path).map_err(|e| StudioError::misuse(format!("[DESIGN] {}: {e}", path.display())))
}

/// Where a query's rows go as INSERTs: a file, the first failure kept.
pub struct InsertWriter<'a> {
    out: &'a mut dyn Write,
    prefix: &'a str,
    /// The rows written.
    pub count: u64,
    /// The first failure, of a value or the file; the rest not written.
    pub failed: Option<StudioError>,
}

impl<'a> InsertWriter<'a> {
    /// A writer of INSERTs of `prefix` to `out`.
    pub fn new(out: &'a mut dyn Write, prefix: &'a str) -> InsertWriter<'a> {
        InsertWriter { out, prefix, count: 0, failed: None }
    }

    /// Writes `row`'s INSERT, unless a failure came first.
    pub fn row(&mut self, row: &[Value]) {
        if self.failed.is_some() {
            return;
        }
        let written = insert(self.prefix, row).and_then(|text| {
            self.out.write_all(text.as_bytes()).map_err(|e| StudioError::misuse(format!("[DESIGN] cannot write the script: {e}")))
        });
        match written {
            Ok(()) => self.count = self.count.saturating_add(1),
            Err(e) => self.failed = Some(e),
        }
    }

    /// The rows written, or the first failure.
    ///
    /// # Errors
    ///
    /// The first failure, of a value or the file.
    pub fn finish(self) -> Result<u64> {
        match self.failed {
            Some(e) => Err(e),
            None => {
                self.out.flush().map(|()| self.count).map_err(|e| StudioError::misuse(format!("[DESIGN] cannot write the script: {e}")))
            }
        }
    }
}

impl Sink for InsertWriter<'_> {
    fn columns(&mut self, _: &[Column]) {}

    fn rows(&mut self, rows: &[Row]) {
        for row in rows {
            self.row(row);
        }
    }
}

#[cfg(test)]
mod tests;
