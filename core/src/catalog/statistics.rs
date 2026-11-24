//! What the planner's statistics hold of a table (RULES.md D72), read of
//! the Information Schema's own views
//! (`[DOC sql/07-information-schema.md Column statistics]`,
//! `[DOC operator/11-monitoring.md Table and index statistics]`): of each
//! column, the rows the last pass over the table found and when, its share
//! NULL, distinct values, width, least and greatest values, most common
//! values and histogram; of the table, its rows now and when a write last
//! committed; of each index, its entries and the distinct keys it counts,
//! which the planner estimates an equality on all its columns by. Each
//! figure is the server's text, as it gave it (R-NUM-1).

use serde::Serialize;

use crate::catalog::{Catalog, need, text};
use crate::error::Result;

/// What the planner's statistics hold of each column of a table.
const COLUMNS: &str = "SELECT COLUMN_NAME, ROW_COUNT, GATHERED, NULL_FRACTION, DISTINCT_VALUES, AVERAGE_WIDTH, MIN_VALUE, MAX_VALUE, \
     MOST_COMMON_VALUES, MOST_COMMON_FREQUENCIES, HISTOGRAM_BOUNDS FROM INFORMATION_SCHEMA.COLUMN_STATISTICS \
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION";
/// A table's engine, rows now, and when a write to it last committed.
const TABLE: &str = "SELECT ENGINE_NAME, ROW_COUNT, LAST_CHANGED FROM INFORMATION_SCHEMA.TABLE_STATISTICS \
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?";
/// A table's indexes: each its method, entries and the distinct keys it counts.
const INDEXES: &str = "SELECT INDEX_NAME, METHOD_NAME, ENTRY_COUNT, DISTINCT_KEYS FROM INFORMATION_SCHEMA.INDEX_STATISTICS \
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME";

/// What the planner's statistics hold of a column, each figure null until
/// they are gathered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnStatistics {
    /// The column's name.
    pub name: String,
    /// The share of the rows whose value is NULL.
    pub null_fraction: Option<String>,
    /// Its distinct values but NULL.
    pub distinct_values: Option<String>,
    /// The bytes of a row read for it.
    pub average_width: Option<String>,
    /// Its least value, as its text.
    pub min_value: Option<String>,
    /// Its greatest value, as its text.
    pub max_value: Option<String>,
    /// The values that each hold a large share of the rows, as an array.
    pub most_common: Option<String>,
    /// The share of the rows each of those holds, as an array.
    pub frequencies: Option<String>,
    /// The bounds of an equi-depth histogram of the other values.
    pub histogram: Option<String>,
}

/// What an index counts: its entries and its distinct keys.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatistics {
    /// The index's name.
    pub name: String,
    /// Its method.
    pub method: String,
    /// Its entries, if its method knows them.
    pub entries: Option<String>,
    /// The distinct keys it counts, which the planner estimates an
    /// equality on all its columns by; null while it has not counted them.
    pub distinct_keys: Option<String>,
}

/// What the planner's statistics hold of a table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStatistics {
    /// The table's schema.
    pub schema: String,
    /// The table's name.
    pub table: String,
    /// Its engine, of TABLE_STATISTICS; none if the user may not see it there.
    pub engine: Option<String>,
    /// Its rows now.
    pub rows: Option<String>,
    /// When a transaction that wrote it last committed.
    pub last_changed: Option<String>,
    /// The rows the last pass over it found; none until one is made.
    pub gathered_rows: Option<String>,
    /// When that pass was made.
    pub gathered: Option<String>,
    /// Each column the user may see, in order.
    pub columns: Vec<ColumnStatistics>,
    /// Each index, by name.
    pub indexes: Vec<IndexStatistics>,
}

impl Catalog<'_> {
    /// What the planner's statistics hold of `schema`.`table`, its columns
    /// those the user holds a privilege on. Reading them asks for them as
    /// a plan does, so ones not yet gathered are gathered soon after.
    ///
    /// # Errors
    ///
    /// The server's.
    pub fn statistics(&self, schema: &str, table: &str) -> Result<TableStatistics> {
        let columns = self.rows(COLUMNS, &[schema, table])?;
        let of_table = self.rows(TABLE, &[schema, table])?;
        let first = columns.first();
        let shown = of_table.first();
        Ok(TableStatistics {
            schema: schema.to_owned(),
            table: table.to_owned(),
            engine: shown.and_then(|r| text(r, 0)),
            rows: shown.and_then(|r| text(r, 1)),
            last_changed: shown.and_then(|r| text(r, 2)),
            gathered_rows: first.and_then(|r| text(r, 1)),
            gathered: first.and_then(|r| text(r, 2)),
            columns: columns.iter().map(|r| column(r)).collect(),
            indexes: self
                .rows(INDEXES, &[schema, table])?
                .iter()
                .map(|r| IndexStatistics { name: need(r, 0), method: need(r, 1), entries: text(r, 2), distinct_keys: text(r, 3) })
                .collect(),
        })
    }
}

/// A column's statistics, of its row of COLUMNS.
fn column(r: &[crate::connections::cells::Cell]) -> ColumnStatistics {
    ColumnStatistics {
        name: need(r, 0),
        null_fraction: text(r, 3),
        distinct_values: text(r, 4),
        average_width: text(r, 5),
        min_value: text(r, 6),
        max_value: text(r, 7),
        most_common: text(r, 8),
        frequencies: text(r, 9),
        histogram: text(r, 10),
    }
}
