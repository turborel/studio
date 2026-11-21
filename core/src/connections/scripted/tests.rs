//! The tests of a table's rows written as INSERTs (RULES.md D65).

use turborel::value::Value;

use turborel::value::lob::LobKind;

use super::{LITERAL_CHUNK, RowWriter, RowsAs, insert, literal, restart_with, scripted, whole};
use crate::catalog::model::{Column, TableDetail};

/// A column `name` of `type_written`, its identity and generation as given.
fn column(name: &str, identity: Option<&str>, generated: Option<&str>) -> Column {
    Column {
        name: name.to_owned(),
        position: 1,
        type_written: "INTEGER".to_owned(),
        default: None,
        nullable: true,
        identity: identity.map(str::to_owned),
        generated: generated.map(str::to_owned),
        domain: None,
    }
}

/// A table of ANN of `columns`.
fn table(name: &str, columns: Vec<Column>) -> TableDetail {
    TableDetail {
        schema: "ANN".to_owned(),
        name: name.to_owned(),
        kind: "BASE TABLE".to_owned(),
        columns,
        constraints: Vec::new(),
        indexes: Vec::new(),
        triggers: Vec::new(),
        privileges: Vec::new(),
        view: None,
        partitioning: None,
        partition_of: None,
        storage: None,
    }
}

/// [DOC sql/statements/insert.md RULES] [DESIGN] D65: a table's rows are
/// read of the columns an INSERT takes, a generated column left out, an
/// identity column GENERATED ALWAYS given its value by OVERRIDING SYSTEM
/// VALUE; a table of no such column has none.
#[test]
fn the_columns_an_insert_takes_are_scripted() {
    let tickets = table(
        "TICKETS",
        vec![
            column("TICKET", Some("ALWAYS"), None),
            column("SEAT", None, None),
            column("ROW_NO", None, Some("SUBSTRING(SEAT FROM 1 FOR 1)")),
        ],
    );
    let rows = scripted(&tickets).unwrap();
    assert_eq!(rows.query, r#"SELECT "TICKET", "SEAT" FROM "ANN"."TICKETS""#);
    assert_eq!(rows.prefix, r#"INSERT INTO "ANN"."TICKETS" ("TICKET", "SEAT") OVERRIDING SYSTEM VALUE VALUES "#);
    let plain = table("A\"B", vec![column("N", Some("BY DEFAULT"), None)]);
    assert_eq!(scripted(&plain).unwrap().prefix, r#"INSERT INTO "ANN"."A""B" ("N") VALUES "#);
    assert_eq!(scripted(&table("G", vec![column("X", None, Some("1"))])), None);
}

/// [DESIGN] D65: each value is written as Turborel writes its literal,
/// a quote doubled and a null as NULL; the writer counts the rows written.
#[test]
fn each_row_is_an_insert_of_literals() {
    let row = [Value::Char("O'Neil".to_owned()), Value::Null, Value::Bool(true)];
    assert_eq!(insert("INSERT INTO T VALUES ", &row).unwrap(), "INSERT INTO T VALUES ('O''Neil', NULL, TRUE);\n");
    let mut out = Vec::new();
    let how = RowsAs::Inserts("INSERT INTO T VALUES ".to_owned());
    let mut writer = RowWriter::new(&mut out, &how);
    writer.row(&[Value::Char("a".to_owned())]);
    writer.row(&[Value::Null]);
    assert_eq!(writer.finish().unwrap(), 2);
    assert_eq!(String::from_utf8(out).unwrap(), "INSERT INTO T VALUES ('a');\nINSERT INTO T VALUES (NULL);\n");
}

/// [DESIGN] D65: a large object read whole is a character string or a
/// binary string, one past a string's length strings joined by `||`, the
/// first cast to its type; written as CSV whole; one not read whole is
/// refused.
#[test]
fn a_large_object_is_written_whole() {
    assert_eq!(literal(&whole(LobKind::Character, b"it's")).unwrap(), "'it''s'");
    assert_eq!(literal(&whole(LobKind::Binary, &[0, 255])).unwrap(), "X'00FF'");
    assert_eq!(literal(&whole(LobKind::Character, b"")).unwrap(), "''");
    assert_eq!(literal(&whole(LobKind::Binary, &[])).unwrap(), "X''");
    let long = "x".repeat(LITERAL_CHUNK + 1);
    assert_eq!(
        literal(&whole(LobKind::Character, long.as_bytes())).unwrap(),
        format!("CAST('{}' AS CLOB) || 'x'", "x".repeat(LITERAL_CHUNK))
    );
    let wide = vec![1_u8; LITERAL_CHUNK + 1];
    assert!(literal(&whole(LobKind::Binary, &wide)).unwrap().ends_with("AS BLOB) || X'01'"));
    let located = Value::Lob(turborel::value::lob::Lob::of_locator(LobKind::Character, 7, (10, 10)));
    assert!(literal(&located).unwrap_err().message.contains("read whole"));
    let mut out = Vec::new();
    let how = RowsAs::Csv(vec!["ID".to_owned(), "DOC".to_owned()]);
    let mut writer = RowWriter::new(&mut out, &how);
    writer.row(&[Value::Char("1".to_owned()), whole(LobKind::Character, b"a, b")]);
    writer.row(&[Value::Null, located]);
    assert!(writer.finish().unwrap_err().message.contains("read whole"));
    assert_eq!(String::from_utf8(out).unwrap(), "ID,DOC\r\n1,\"a, b\"\r\n");
}

/// [DOC sql/statements/alter-table.md SYNOPSIS] [DESIGN] D65: an identity
/// column restarts with the greatest value plus its increment, or the
/// least plus one below 0; none of no rows or of a value not an integer.
#[test]
fn an_identity_restarts_past_its_rows() {
    assert_eq!(restart_with(Some("41"), "1"), Some(42));
    assert_eq!(restart_with(Some("-10"), "-5"), Some(-15));
    assert_eq!(restart_with(None, "1"), None);
    assert_eq!(restart_with(Some("1.5"), "1"), None);
}
