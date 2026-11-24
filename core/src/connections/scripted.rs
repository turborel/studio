//! A table's rows written as INSERT statements (RULES.md D65), so a
//! generated script carries its data and Run SQL File (D62) loads it back:
//! a statement a row, each value written as Turborel writes its literal
//! (`Value::to_literal`), a number every digit of it; a generated column
//! left out, as INSERT takes none; an identity column GENERATED ALWAYS
//! given its value by OVERRIDING SYSTEM VALUE
//! ([DOC sql/statements/insert.md RULES]). A large object is read whole,
//! by its locator if it came by one, and written as a character string
//! or a binary string, one past `LITERAL_CHUNK` as such strings joined by
//! `||`. The same rows may be written as CSV instead, a large object
//! whole. After the rows, each identity column is restarted past them.

use std::fmt::Write as _;
use std::io::Write;

use turborel::value::Value;
use turborel::value::lob::{Lob, LobKind};

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
    /// The columns, by name, as a CSV file's header names them.
    pub columns: Vec<String>,
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
        columns: columns.iter().map(|c| c.name.clone()).collect(),
        table: qualified,
    })
}

/// The most characters, or octets, of a large object written as one
/// string: a longer one is strings of so many joined by `||`, each within
/// a string's longest ([DOC appendix/d-limits.md Limits]).
pub const LITERAL_CHUNK: usize = 16_000;
/// The longest large object scripted as a literal, in octets, so its
/// INSERT stays within the longest statement Studio sends.
pub const MAX_SCRIPTED_OCTETS: u64 = 8 * 1024 * 1024;

/// `octets` in hexadecimal, upper case.
fn hex(octets: &[u8]) -> String {
    octets.iter().fold(String::new(), |mut hex, b| {
        let _ = write!(hex, "{b:02X}"); // Writing to a String cannot fail.
        hex
    })
}

/// `bytes`, a large object's of `kind`, as a literal: a character string
/// or a binary string, or, past `LITERAL_CHUNK`, such strings joined,
/// the first cast to the large object's type.
fn lob_literal(kind: LobKind, bytes: &[u8]) -> String {
    let (parts, cast): (Vec<String>, &str) = match kind {
        LobKind::Character => {
            let text = String::from_utf8_lossy(bytes);
            let chars: Vec<char> = text.chars().collect();
            let parts = chars.chunks(LITERAL_CHUNK).map(|c| format!("'{}'", c.iter().collect::<String>().replace('\'', "''"))).collect();
            (parts, "CLOB")
        }
        LobKind::Binary => {
            let parts = bytes.chunks(LITERAL_CHUNK).map(|c| format!("X'{}'", hex(c))).collect();
            (parts, "BLOB")
        }
    };
    match parts.as_slice() {
        [] => {
            if kind == LobKind::Character {
                "''".to_owned()
            } else {
                "X''".to_owned()
            }
        }
        [one] => one.clone(),
        [first, rest @ ..] => format!("CAST({first} AS {cast}) || {}", rest.join(" || ")),
    }
}

/// `v` as a literal of an INSERT.
///
/// # Errors
///
/// SQLCODE -910 for a large object not held whole, or past
/// `MAX_SCRIPTED_OCTETS`.
pub fn literal(v: &Value) -> Result<String> {
    match v {
        Value::Lob(lob) => {
            let bytes = lob.inline().ok_or_else(|| StudioError::misuse("[DESIGN] a large object is scripted only once read whole"))?;
            if lob.octets() > MAX_SCRIPTED_OCTETS {
                return Err(StudioError::misuse(format!(
                    "[DESIGN] a large object of {} octets is past the {MAX_SCRIPTED_OCTETS} an INSERT holds: script the rows as CSV files",
                    lob.octets()
                )));
            }
            Ok(lob_literal(lob.kind(), bytes))
        }
        other => Ok(other.to_literal()),
    }
}

/// `bytes`, the whole of a large object of `kind`, as a value held inline.
pub fn whole(kind: LobKind, bytes: &[u8]) -> Value {
    Value::Lob(match kind {
        LobKind::Character => Lob::of_text(&String::from_utf8_lossy(bytes)),
        LobKind::Binary => Lob::of_octets(bytes),
    })
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

/// The most octets of a large object read whole to be scripted.
pub const MAX_WHOLE_OCTETS: u64 = 256 * 1024 * 1024;

/// Refuses a large object of `octets` past `MAX_WHOLE_OCTETS`.
///
/// # Errors
///
/// SQLCODE -910 of one past it.
pub fn readable(octets: u64) -> Result<()> {
    if octets > MAX_WHOLE_OCTETS {
        return Err(StudioError::misuse(format!(
            "[DESIGN] a large object of {octets} octets is past the {MAX_WHOLE_OCTETS} a script reads whole"
        )));
    }
    Ok(())
}

/// The script at `path`, opened to have more written at its end.
///
/// # Errors
///
/// SQLCODE -910 if it cannot be opened.
pub fn appended(path: &std::path::Path) -> Result<std::fs::File> {
    std::fs::OpenOptions::new().append(true).open(path).map_err(|e| StudioError::misuse(format!("[DESIGN] {}: {e}", path.display())))
}

/// Where a query's rows go: a script, an INSERT a row, the first failure kept.
pub struct RowWriter<'a> {
    out: &'a mut dyn Write,
    /// What each INSERT begins with.
    prefix: &'a str,
    /// The rows written.
    pub count: u64,
    /// The first failure, of a value or the file; the rest not written.
    pub failed: Option<StudioError>,
}

impl<'a> RowWriter<'a> {
    /// A writer of rows to `out`, each an INSERT begun with `prefix`.
    pub fn new(out: &'a mut dyn Write, prefix: &'a str) -> RowWriter<'a> {
        RowWriter { out, prefix, count: 0, failed: None }
    }

    /// Writes `text`, unless a failure came first.
    fn write(&mut self, text: Result<String>) {
        if self.failed.is_some() {
            return;
        }
        let written = text.and_then(|text| {
            self.out.write_all(text.as_bytes()).map_err(|e| StudioError::misuse(format!("[DESIGN] cannot write the rows: {e}")))
        });
        if let Err(e) = written {
            self.failed = Some(e);
        }
    }

    /// Writes `row`, unless a failure came first.
    pub fn row(&mut self, row: &[Value]) {
        let text = insert(self.prefix, row);
        let before = self.failed.is_none();
        self.write(text);
        if before && self.failed.is_none() {
            self.count = self.count.saturating_add(1);
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
            None => self.out.flush().map(|()| self.count).map_err(|e| StudioError::misuse(format!("[DESIGN] cannot write the rows: {e}"))),
        }
    }
}

/// Whether `type_written` is a binary string's type, whose values a file
/// writes in hexadecimal.
pub fn is_binary(type_written: &str) -> bool {
    let t = type_written.trim().to_ascii_uppercase();
    ["BINARY", "VARBINARY", "BLOB"].iter().any(|b| t.starts_with(b))
}

/// The value an identity column restarts with past its rows: the
/// greatest of them plus its increment, or the least, of an increment
/// below 0; none of no rows, or of a value or increment not an integer.
pub fn restart_with(edge: Option<&str>, increment: &str) -> Option<i128> {
    let edge: i128 = edge?.trim().parse().ok()?;
    let increment: i128 = increment.trim().parse().ok()?;
    edge.checked_add(increment)
}

#[cfg(test)]
mod tests;
