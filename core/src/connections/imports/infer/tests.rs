//! The tests of the types inferred of a file's fields (RULES.md D63).

use super::{MAX_VARCHAR, infer};
use crate::connections::cells::Cell;

/// A field of `values`, a null as `NULL`, inferred alone.
fn of(values: &[&str]) -> String {
    let records: Vec<Vec<Cell>> = values.iter().map(|&v| vec![(v != "NULL").then(|| v.to_owned())]).collect();
    infer(&records, 1)[0].type_written.clone()
}

/// [DOC sql/02-data-types.md Numbers] [DESIGN] D63: integers take the
/// narrowest of INTEGER and BIGINT; a decimal, or an integer past BIGINT,
/// takes NUMERIC of its digits, as many as 38; past them, an approximate
/// number; a code with leading zeros stays text.
#[test]
fn numbers_take_the_narrowest_type() {
    assert_eq!(of(&["1", "-2147483648", "NULL"]), "INTEGER");
    assert_eq!(of(&["2147483648"]), "BIGINT");
    assert_eq!(of(&["12.5", "3", "-0.125"]), "NUMERIC(5,3)");
    let wide = "12345678901234567890123456789012345678";
    assert_eq!(of(&[wide, "1"]), "NUMERIC(38,0)");
    assert_eq!(of(&["1234567890123456789012345678.0123456789"]), "NUMERIC(38,10)");
    assert_eq!(of(&[&format!("{wide}9")]), "DOUBLE PRECISION");
    assert_eq!(of(&["1.5E3", "2"]), "DOUBLE PRECISION");
    assert_eq!(of(&["02134", "10001"]), "VARCHAR(10)");
}

/// [DOC sql/02-data-types.md Numbers] [DESIGN] D63: truth values, dates,
/// times, timestamps with a time zone or not, and JSON's objects and
/// arrays take their types; anything else a CHARACTER VARYING of its
/// longest value rounded up, or a large object past the longest.
#[test]
fn other_values_take_their_types() {
    assert_eq!(of(&["true", "FALSE"]), "BOOLEAN");
    assert_eq!(of(&["2024-01-02", "1999-12-31"]), "DATE");
    assert_eq!(of(&["10:30:00", "23:59:59.5"]), "TIME");
    assert_eq!(of(&["2024-01-02 10:30:00", "2024-01-03T11:00:00.25", "2024-01-04"]), "TIMESTAMP");
    assert_eq!(of(&["2024-01-02T10:30:00Z", "2024-01-02 10:30:00-05:00"]), "TIMESTAMP WITH TIME ZONE");
    assert_eq!(of(&["{\"a\": [1, 2]}", "[3]"]), "JSON");
    assert_eq!(of(&["{not json"]), "VARCHAR(10)");
    assert_eq!(of(&["2024-13-01"]), "VARCHAR(10)");
    assert_eq!(of(&["Ada", "Grace Hopper"]), "VARCHAR(20)");
    assert_eq!(of(&[&"x".repeat(300)]), "VARCHAR(1000)");
    assert_eq!(of(&[&"x".repeat(MAX_VARCHAR + 1)]), "CLOB(1M)");
    assert_eq!(of(&["NULL"]), "VARCHAR(255)");
    let records = vec![vec![Some("1".to_owned()), None], vec![Some("2".to_owned())]];
    let inferred = infer(&records, 2);
    assert_eq!((inferred[0].nulls, inferred[1].nulls, inferred[1].type_written.as_str()), (false, true, "VARCHAR(255)"));
}
