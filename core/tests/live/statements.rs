//! Running statements and paging their results (`[CLIENT Running
//! statements]`, `[CLIENT Prepared statements]`).

use turborel_studio_core::connections::manager::RunAnswer;
use turborel_studio_core::connections::outcome::Outcome;
use turborel_studio_core::connections::pages::PAGE_ROWS;

use crate::Live;
use crate::connect::column;

/// The rows of a query of the numbers 1 to 1234, in order.
const NUMBERS: &str =
    "WITH RECURSIVE T(N) AS (VALUES (CAST(1 AS INTEGER)) UNION ALL SELECT N + 1 FROM T WHERE N < 1234) SELECT N FROM T ORDER BY N";

/// [CLIENT Prepared statements] [RULE] R-SAFE-1: a query's rows are read a
/// page at a time through its cursor, earlier ones read back, and the
/// result closed.
pub fn a_query_is_paged_through_its_cursor(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    let Outcome::Rows { result, columns, page } = crate::run(&manager, id, NUMBERS).unwrap().outcome else { panic!("no rows") };
    assert_eq!(columns.len(), 1);
    assert_eq!(page.rows.len(), usize::try_from(PAGE_ROWS).unwrap());
    assert_eq!((page.rows_read, page.complete), (u64::from(PAGE_ROWS), false));
    let tail = manager.rows(id, result, (1200, 100)).unwrap();
    assert_eq!(tail.rows.len(), 34);
    assert_eq!(tail.rows[0][0].as_deref(), Some("1201"));
    assert_eq!((tail.rows_read, tail.complete), (1234, true));
    let head = manager.rows(id, result, (0, 2)).unwrap();
    assert_eq!(head.rows, [[Some("1".to_owned())], [Some("2".to_owned())]]);
    manager.close_result(id, result).unwrap();
    assert_eq!(manager.rows(id, result, (0, 1)).unwrap_err().sqlstate, "TB910");
    manager.close(id).unwrap();
}

/// [CLIENT Prepared statements] Granted `declared-types`, each column's
/// type is the one it was declared with.
pub fn declared_types_are_shown(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    crate::run(&manager, id, "CREATE TABLE TYPED (I INTEGER, D DECIMAL(9,2))").unwrap();
    crate::run(&manager, id, "INSERT INTO TYPED VALUES (1, 2.5)").unwrap();
    let Outcome::Rows { columns, page, .. } = crate::run(&manager, id, "SELECT I, D FROM TYPED").unwrap().outcome else {
        panic!("no rows")
    };
    let written: Vec<&str> = columns.iter().map(|c| c.type_written.as_str()).collect();
    assert_eq!(written, ["INTEGER", "DECIMAL(9,2)"]);
    let names: Vec<Option<&str>> = columns.iter().map(|c| c.type_name.as_deref()).collect();
    assert_eq!(names, [Some("INTEGER"), Some("DECIMAL")]);
    assert_eq!(page.rows, [[Some("1".to_owned()), Some("2.50".to_owned())]]);
    crate::run(&manager, id, "DROP TABLE TYPED CASCADE").unwrap();
    manager.close(id).unwrap();
}

/// [CLIENT What the server tells] A change tells the rows it changed and
/// the identity values it generated.
pub fn a_change_tells_its_rows_and_generated_values(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    crate::run(&manager, id, "CREATE TABLE STAFF (ID INTEGER GENERATED ALWAYS AS IDENTITY, NAME VARCHAR(20))").unwrap();
    let ran = crate::run(&manager, id, "INSERT INTO STAFF (NAME) VALUES ('Edsger'), ('Barbara')").unwrap();
    let Outcome::Done { sqlcode, rows_affected, generated, .. } = ran.outcome else { panic!("rows") };
    assert_eq!((sqlcode, rows_affected), (0, Some(2)));
    assert_eq!(generated, ["1", "2"]);
    assert!(ran.server_time.is_some());
    crate::run(&manager, id, "DROP TABLE STAFF CASCADE").unwrap();
    manager.close(id).unwrap();
}

/// [CLIENT Running statements] [RULE] R-ERR-2: a failure is kept whole: its
/// SQLCODE, SQLSTATE and message.
pub fn a_failure_is_kept_whole(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    let error = crate::run(&manager, id, "SELECT * FROM NOPE").unwrap_err();
    assert_eq!((error.sqlcode, error.sqlstate.as_str()), (-103, "2A000"));
    assert!(error.message.contains("NOPE"), "{error}");
    assert!(!manager.session(id).unwrap().lost);
    manager.close(id).unwrap();
}

/// [CLIENT What the server tells] Granted `conditions`, a statement's
/// warnings come with its outcome.
pub fn warnings_come_with_the_outcome(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    let ran = crate::run(&manager, id, "SELECT COUNT(X) FROM (VALUES (1), (CAST(NULL AS INTEGER))) AS T(X)").unwrap();
    let states: Vec<&str> = ran.warnings.iter().map(|w| w.sqlstate.as_str()).collect();
    assert_eq!(states, ["01003"]);
    manager.close(id).unwrap();
}

/// [CLIENT Running statements] [DOC sql/statements/declare-local-temporary-table.md DESCRIPTION]
/// A statement the server will not prepare, as a temporary table's
/// declaration or dynamic SQL, is run directly, and completes.
pub fn a_statement_not_preparable_runs_directly(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    let declare = "DECLARE LOCAL TEMPORARY TABLE MODULE.SCRATCH (K INTEGER) ON COMMIT PRESERVE ROWS";
    let Outcome::Done { sqlcode, .. } = crate::run(&manager, id, declare).unwrap().outcome else { panic!("rows") };
    assert_eq!(sqlcode, 0);
    let dynamic = "EXECUTE IMMEDIATE 'INSERT INTO MODULE.SCRATCH VALUES (7)'";
    assert!(matches!(crate::run(&manager, id, dynamic).unwrap().outcome, Outcome::Done { .. }));
    assert_eq!(column(&manager, id, "SELECT K FROM MODULE.SCRATCH"), [Some("7".to_owned())]);
    crate::run(&manager, id, "COMMIT").unwrap();
    manager.close(id).unwrap();
}

/// [CLIENT Prepared statements] A query that fails as its cursor opens is
/// told, and a result closed before its last row closes its cursor.
pub fn a_cursor_fails_or_closes_early(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    let error = crate::run(&manager, id, "SELECT 1 / (N - 1) FROM (VALUES (1)) AS T(N)").unwrap_err();
    assert_eq!(error.sqlstate, "22012", "{error}");
    let Outcome::Rows { result, .. } = crate::run(&manager, id, NUMBERS).unwrap().outcome else { panic!("no rows") };
    manager.close_result(id, result).unwrap();
    assert_eq!(column(&manager, id, "VALUES (2)"), [Some("2".to_owned())]);
    manager.close(id).unwrap();
}

/// [DOC sql/statements/prepare.md DESCRIPTION] [DESIGN] D36: a statement's
/// dynamic parameters are told by their types, and given values as text,
/// each cast to its parameter's type, or null; a value of no number, or
/// values not as many as the parameters, are refused.
pub fn parameters_are_given_values_as_text(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    crate::run(&manager, id, "CREATE TABLE BOUND (I INTEGER, S VARCHAR(10))").unwrap();
    let insert = "INSERT INTO BOUND VALUES (?, ?)";
    // An INTEGER column's parameter is of its tag's type, an exact numeric
    // type of precision 10 and scale 0 ([CLIENT Prepared statements]).
    assert_eq!(manager.parameters(id, insert).unwrap(), ["NUMERIC(10,0)", "CHARACTER VARYING(10)"]);
    let values = [Some("42".to_owned()), None];
    let RunAnswer::Ran(ran) = manager.run_with(id, (insert, &values), false).unwrap() else { panic!("asked") };
    assert!(matches!(ran.outcome, Outcome::Done { rows_affected: Some(1), .. }), "{:?}", ran.outcome);
    let query = "SELECT S FROM BOUND WHERE I = ?";
    let RunAnswer::Ran(ran) = manager.run_with(id, (query, &[Some("42".to_owned())]), false).unwrap() else { panic!("asked") };
    let Outcome::Rows { page, .. } = ran.outcome else { panic!("no rows") };
    assert_eq!(page.rows, [[None]]);
    assert_eq!(manager.run_with(id, (query, &[Some("x".to_owned())]), false).unwrap_err().sqlstate, "22018");
    assert_eq!(manager.run_with(id, (query, &[]), false).unwrap_err().sqlstate, "TB910");
    assert!(manager.judge(id, "DROP TABLE BOUND CASCADE").unwrap().is_some());
    assert!(manager.judge(id, query).unwrap().is_none());
    crate::run(&manager, id, "DROP TABLE BOUND CASCADE").unwrap();
    manager.close(id).unwrap();
}

/// [DOC sql/statements/explain.md EXPLAIN ANALYZE] [DESIGN] D36: EXPLAIN and
/// EXPLAIN ANALYZE of a query run as a worksheet runs them, a read, each
/// giving the plan's lines as rows of PLAN; ANALYZE's ending with the rows
/// the query gave.
pub fn a_plan_is_explained_and_analyzed(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    crate::run(&manager, id, "CREATE TABLE PLANNED (ID INTEGER PRIMARY KEY, NAME VARCHAR(20))").unwrap();
    crate::run(&manager, id, "INSERT INTO PLANNED VALUES (1, 'a'), (2, 'b')").unwrap();
    assert!(manager.judge(id, "EXPLAIN ANALYZE SELECT * FROM PLANNED").unwrap().is_none());
    for (sql, last) in [("EXPLAIN SELECT ID FROM PLANNED", "-- physical:"), ("EXPLAIN ANALYZE SELECT ID FROM PLANNED", "-- ran: 2 rows")] {
        let Outcome::Rows { result, columns, page } = crate::run(&manager, id, sql).unwrap().outcome else { panic!("no plan") };
        assert_eq!(columns[0].name.as_deref(), Some("PLAN"));
        let mut lines: Vec<String> = page.rows.iter().map(|r| r[0].clone().unwrap_or_default()).collect();
        if !page.complete {
            let rest = manager.rows(id, result, (page.rows_read, 1000)).unwrap();
            lines.extend(rest.rows.iter().map(|r| r[0].clone().unwrap_or_default()));
        }
        assert!(lines.iter().any(|l| l.trim() == last || l.trim().starts_with(last)), "{sql}: {lines:?}");
        let _ = manager.close_result(id, result);
    }
    crate::run(&manager, id, "DROP TABLE PLANNED CASCADE").unwrap();
    manager.close(id).unwrap();
}
