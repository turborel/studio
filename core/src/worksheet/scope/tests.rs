//! A statement's sources, read of statements as people write them: whole,
//! and being written, with aliases, common table expressions, derived
//! tables, joins and delimited names.

use super::{Scope, SourceKind, scope};

/// A source as the tests compare it: its kind, schema, name, alias and columns.
type Seen = (SourceKind, Option<String>, Option<String>, Option<String>, Option<Vec<String>>);

/// The sources of `text`, the cursor at its end.
fn sources(text: &str) -> Vec<Seen> {
    scope(text, text.len()).sources.into_iter().map(|s| (s.kind, s.schema, s.name, s.alias, s.columns)).collect()
}

/// `s` as an owned name, as a source's optional names are compared.
#[expect(clippy::unnecessary_wraps, reason = "a source's names are optional, and each is compared so")]
fn n(s: &str) -> Option<String> {
    Some(s.to_owned())
}

/// [DESIGN] D40: a query's tables are read with their schemas and
/// correlation names, through joins, and a delimited name as it is.
#[test]
fn tables_and_aliases_are_read() {
    assert_eq!(
        sources("SELECT * FROM ANN.STAFF S JOIN \"lower\" AS L ON S.ID = L.ID, DEPT"),
        [
            (SourceKind::Table, n("ANN"), n("STAFF"), n("S"), None),
            (SourceKind::Table, None, n("lower"), n("L"), None),
            (SourceKind::Table, None, n("DEPT"), None, None),
        ]
    );
}

/// [DESIGN] D40: a common table expression is read by its name and
/// columns, a FROM naming it read as it, and a derived table by its alias
/// and select list.
#[test]
fn ctes_and_derived_tables_are_read() {
    let found = sources("WITH T(A, B) AS (SELECT X, Y FROM U) SELECT * FROM T, (SELECT ID, NAME AS N FROM STAFF) AS D");
    assert_eq!(
        found,
        [
            (SourceKind::Cte, None, n("T"), None, Some(vec!["A".to_owned(), "B".to_owned()])),
            (SourceKind::Table, None, n("U"), None, None),
            (SourceKind::Cte, None, n("T"), None, None),
            (SourceKind::Derived, None, None, n("D"), Some(vec!["ID".to_owned(), "N".to_owned()])),
            (SourceKind::Table, None, n("STAFF"), None, None),
        ]
    );
    let nested = scope("SELECT * FROM (SELECT * FROM STAFF) AS D", 0);
    assert!(nested.sources.iter().any(|s| s.name.as_deref() == Some("STAFF") && !s.outer));
}

/// [DESIGN] D40: a statement being written is read with a name where the
/// cursor is; an INSERT's, UPDATE's and DELETE's table is read; text that
/// does not parse either way is said so.
#[test]
fn statements_being_written_are_read() {
    let typed = scope("SELECT S. FROM STAFF S", 9);
    assert!(typed.parsed);
    assert_eq!(typed.sources[0].alias.as_deref(), Some("S"));
    for (sql, table) in
        [("INSERT INTO STAFF (ID) VALUES (1)", "STAFF"), ("UPDATE ANN.T SET A = 1 WHERE B = 2", "T"), ("DELETE FROM D WHERE 1 = 1", "D")]
    {
        assert_eq!(scope(sql, 0).sources[0].name.as_deref(), Some(table), "{sql}");
    }
    assert_eq!(scope("SELECT FROM WHERE (", 7), Scope::default());
    assert!(!scope(&" ".repeat(super::MAX_SCOPE_BYTES + 1), 0).parsed);
    assert_eq!(scope("COMMIT", 6), Scope { parsed: true, sources: Vec::new() });
}
