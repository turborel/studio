//! The catalog (RULES.md D33): the objects a connection's user may see,
//! read from the Information Schema over the connection itself, a list or
//! an object at a time as the explorer opens it; their definitions as
//! SQL; what each uses and what uses it; and a search of names and
//! definitions.

pub mod ddl;
pub mod graphs;
pub mod model;
pub mod names;
mod partitions;
pub mod queries;
mod read;
mod types;

use crate::connections::cells::Cell;
use crate::connections::manager::ConnectionManager;
use crate::error::Result;
use crate::events::ConnectionId;

pub use read::type_text;

/// The most rows Studio reads of one of the catalog's lists (R-SAFE-1):
/// past it, the list says it stopped.
pub const MAX_ROWS: u32 = 20_000;

/// The catalog of a connection.
pub struct Catalog<'a> {
    manager: &'a ConnectionManager,
    connection: ConnectionId,
}

impl<'a> Catalog<'a> {
    /// The catalog of connection `connection` of `manager`.
    pub fn of(manager: &'a ConnectionManager, connection: ConnectionId) -> Catalog<'a> {
        Catalog { manager, connection }
    }

    /// The rows of `sql`, its `?` each of `params`.
    fn rows(&self, sql: &str, params: &[&str]) -> Result<Vec<Vec<Cell>>> {
        let params: Vec<String> = params.iter().map(|p| (*p).to_owned()).collect();
        self.manager.catalog(self.connection, sql, (&params, MAX_ROWS))
    }
}

/// The text of a row's cell `i`, if not null.
fn text(row: &[Cell], i: usize) -> Option<String> {
    row.get(i).cloned().flatten()
}

/// The text of a row's cell `i`, empty if null.
fn need(row: &[Cell], i: usize) -> String {
    text(row, i).unwrap_or_default()
}

/// Whether a row's cell `i` is YES.
fn yes(row: &[Cell], i: usize) -> bool {
    text(row, i).as_deref() == Some("YES")
}

#[cfg(test)]
mod tests;
