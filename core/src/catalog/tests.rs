//! The catalog's own helpers.

use super::type_text;

/// [DOC sql/02-data-types.md Data Types] A type of the Information Schema's
/// parts is written as SQL writes it.
#[test]
fn types_are_written_as_sql_writes_them() {
    assert_eq!(type_text("CHARACTER VARYING", Some("20"), None, None), "CHARACTER VARYING(20)");
    assert_eq!(type_text("DECIMAL", None, Some("9"), Some("2")), "DECIMAL(9,2)");
    assert_eq!(type_text("INTEGER", None, Some("10"), Some("0")), "INTEGER");
    assert_eq!(type_text("DATE", None, None, None), "DATE");
}
