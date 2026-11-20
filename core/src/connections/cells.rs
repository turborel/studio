//! A row's values as the grid shows them (CONFORMANCE.md S-IMPL-5): each
//! the text turborel's own `Display` writes of it, so an exact number or a
//! DECFLOAT is shown as the server gave it, never through a float
//! (R-NUM-1); null as no text. A columns' types as the server declared
//! them (`[CLIENT Prepared statements]`).

use serde::Serialize;
use turborel::storage::Row;
use turborel::value::Value;
use turborel_client::Column;

/// A value as the grid shows it: its text, or `None` for null.
pub type Cell = Option<String>;

/// A column, as the grid's header and the explorer show it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    /// Its name, if it has one.
    pub name: Option<String>,
    /// Its type as SQL writes it: the declared type, granted
    /// `declared-types`, else the type its tag says.
    pub type_written: String,
    /// Its type's name as the Information Schema's DATA_TYPE gives it,
    /// granted `declared-types`.
    pub type_name: Option<String>,
    /// Whether it is constrained NOT NULL.
    pub not_null: bool,
}

impl From<&Column> for ColumnInfo {
    fn from(c: &Column) -> ColumnInfo {
        ColumnInfo {
            name: c.name.clone(),
            type_written: c.type_written(),
            type_name: c.declared.as_ref().map(|d| d.name.clone()),
            not_null: c.not_null,
        }
    }
}

/// The text of `value`, or `None` for null.
pub fn cell(value: &Value) -> Cell {
    (!value.is_null()).then(|| value.to_string())
}

/// The cells of `row`.
pub fn cells(row: &Row) -> Vec<Cell> {
    row.iter().map(cell).collect()
}

#[cfg(test)]
mod tests {
    use turborel::value::Decimal;
    use turborel::value::Value;

    use super::{cell, cells};

    /// [RULE] R-NUM-1: an exact number is shown exactly, with its scale, and
    /// null as no text.
    #[test]
    fn exact_numbers_and_nulls_are_shown_as_the_server_gave_them() {
        let units = 123_456_789_012_345_678_901_234_567_890_i128;
        assert_eq!(cell(&Value::Exact(Decimal::new(units, 2))).as_deref(), Some("1234567890123456789012345678.90"));
        assert_eq!(cell(&Value::Null), None);
        assert_eq!(cells(&vec![Value::Char("Ada".into()), Value::Bool(true)]), [Some("Ada".to_owned()), Some("TRUE".to_owned())]);
    }
}
