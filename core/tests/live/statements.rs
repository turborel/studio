//! Running statements and paging their results (`[CLIENT Running
//! statements]`, `[CLIENT Prepared statements]`).

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
    let Outcome::Rows { result, columns, page } = manager.run(id, NUMBERS).unwrap().outcome else { panic!("no rows") };
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
    manager.run(id, "CREATE TABLE TYPED (I INTEGER, D DECIMAL(9,2))").unwrap();
    manager.run(id, "INSERT INTO TYPED VALUES (1, 2.5)").unwrap();
    let Outcome::Rows { columns, page, .. } = manager.run(id, "SELECT I, D FROM TYPED").unwrap().outcome else { panic!("no rows") };
    let written: Vec<&str> = columns.iter().map(|c| c.type_written.as_str()).collect();
    assert_eq!(written, ["INTEGER", "DECIMAL(9,2)"]);
    let names: Vec<Option<&str>> = columns.iter().map(|c| c.type_name.as_deref()).collect();
    assert_eq!(names, [Some("INTEGER"), Some("DECIMAL")]);
    assert_eq!(page.rows, [[Some("1".to_owned()), Some("2.50".to_owned())]]);
    manager.run(id, "DROP TABLE TYPED CASCADE").unwrap();
    manager.close(id).unwrap();
}

/// [CLIENT What the server tells] A change tells the rows it changed and
/// the identity values it generated.
pub fn a_change_tells_its_rows_and_generated_values(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    manager.run(id, "CREATE TABLE STAFF (ID INTEGER GENERATED ALWAYS AS IDENTITY, NAME VARCHAR(20))").unwrap();
    let ran = manager.run(id, "INSERT INTO STAFF (NAME) VALUES ('Edsger'), ('Barbara')").unwrap();
    let Outcome::Done { sqlcode, rows_affected, generated, .. } = ran.outcome else { panic!("rows") };
    assert_eq!((sqlcode, rows_affected), (0, Some(2)));
    assert_eq!(generated, ["1", "2"]);
    assert!(ran.server_time.is_some());
    manager.run(id, "DROP TABLE STAFF CASCADE").unwrap();
    manager.close(id).unwrap();
}

/// [CLIENT Running statements] [RULE] R-ERR-2: a failure is kept whole: its
/// SQLCODE, SQLSTATE and message.
pub fn a_failure_is_kept_whole(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    let error = manager.run(id, "SELECT * FROM NOPE").unwrap_err();
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
    let ran = manager.run(id, "SELECT COUNT(X) FROM (VALUES (1), (CAST(NULL AS INTEGER))) AS T(X)").unwrap();
    let states: Vec<&str> = ran.warnings.iter().map(|w| w.sqlstate.as_str()).collect();
    assert_eq!(states, ["01003"]);
    manager.close(id).unwrap();
}

/// [CLIENT Running statements] A statement that is no query completes, and
/// its result is told.
pub fn a_statement_not_preparable_runs_directly(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    let Outcome::Done { sqlcode, sqlstate, .. } = manager.run(id, "COMMIT").unwrap().outcome else { panic!("rows") };
    assert_eq!((sqlcode, sqlstate.as_str()), (0, "00000"));
    assert_eq!(column(&manager, id, "VALUES (1)"), [Some("1".to_owned())]);
    manager.close(id).unwrap();
}

/// [CLIENT Prepared statements] A query that fails as its cursor opens is
/// told, and a result closed before its last row closes its cursor.
pub fn a_cursor_fails_or_closes_early(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    let error = manager.run(id, "SELECT 1 / (N - 1) FROM (VALUES (1)) AS T(N)").unwrap_err();
    assert_eq!(error.sqlstate, "22012", "{error}");
    let Outcome::Rows { result, .. } = manager.run(id, NUMBERS).unwrap().outcome else { panic!("no rows") };
    manager.close_result(id, result).unwrap();
    assert_eq!(column(&manager, id, "VALUES (2)"), [Some("2".to_owned())]);
    manager.close(id).unwrap();
}
