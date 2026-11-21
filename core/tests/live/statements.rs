//! Running statements and paging their results (`[CLIENT Running
//! statements]`, `[CLIENT Prepared statements]`).

use turborel_client::export::ExportFormat;
use turborel_studio_core::connections::manager::RunAnswer;
use turborel_studio_core::connections::outcome::Outcome;
use turborel_studio_core::connections::pages::PAGE_ROWS;
use turborel_studio_core::connections::values::ValueRead;

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
/// each cast to its parameter's type, a binary one's in hexadecimal
/// (D41), or null; a value of no number, a binary one not in hexadecimal
/// pairs, or values not as many as the parameters, are refused.
pub fn parameters_are_given_values_as_text(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    crate::run(&manager, id, "CREATE TABLE BOUND (I INTEGER, S VARCHAR(10), B VARBINARY(4))").unwrap();
    let insert = "INSERT INTO BOUND (I, S) VALUES (?, ?)";
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
    let binary = "UPDATE BOUND SET B = ? WHERE I = 42";
    let RunAnswer::Ran(_) = manager.run_with(id, (binary, &[Some("deadBEEF".to_owned())]), false).unwrap() else { panic!("asked") };
    let Outcome::Rows { page, .. } = crate::run(&manager, id, "SELECT B FROM BOUND").unwrap().outcome else { panic!("no rows") };
    assert_eq!(page.rows, [[Some("DEADBEEF".to_owned())]]);
    assert_eq!(manager.run_with(id, (binary, &[Some("DEADBEE".to_owned())]), false).unwrap_err().sqlstate, "22018");
    assert_eq!(manager.run_with(id, (binary, &[Some("ZZ".to_owned())]), false).unwrap_err().sqlstate, "22018");
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

/// [CLIENT Large objects] [DESIGN] D39 D41: a large object past what a row
/// holds whole is shown by what it is, and read whole for a viewer, a
/// character one as its text, a binary one in Base64, in a transaction or,
/// of autocommit, while its result is open; one that came whole is
/// refused, as its cell holds it.
pub fn a_large_object_is_read_whole(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    crate::run(&manager, id, "CREATE TABLE DOCS (ID INTEGER, BODY CLOB(1M), SCAN BLOB(1M))").unwrap();
    manager.set_autocommit(id, false).unwrap();
    let text = "abc".repeat(30_000);
    // Each value longer than a row holds is written by create_lob, a binary
    // one given in hexadecimal, as the grid shows it.
    let insert = "INSERT INTO DOCS VALUES (1, ?, ?)";
    let values = [Some(text.clone()), Some("78".repeat(70_000))];
    let RunAnswer::Ran(_) = manager.run_with(id, (insert, &values), false).unwrap() else { panic!("asked") };
    assert_eq!(manager.run_with(id, (insert, &[Some("x".to_owned()), Some("7".to_owned())]), false).unwrap_err().sqlstate, "22018");
    crate::run(&manager, id, "INSERT INTO DOCS VALUES (2, 'short', NULL)").unwrap();
    crate::run(&manager, id, "COMMIT").unwrap();
    let Outcome::Rows { result, page, .. } = crate::run(&manager, id, "SELECT BODY, SCAN FROM DOCS ORDER BY ID").unwrap().outcome else {
        panic!("no rows")
    };
    assert_eq!(page.rows[0][0].as_deref(), Some("<CHARACTER LARGE OBJECT of 90000 characters>"));
    assert_eq!(page.lobs, [(0, 0), (0, 1)]);
    assert_eq!(page.rows[1][0].as_deref(), Some("short"));
    let ValueRead::Text { text: read, octets, cut } = manager.value(id, result, (0, 0)).unwrap() else { panic!("not text") };
    assert_eq!((read.len(), octets, cut), (90_000, 90_000, false));
    assert_eq!(read, text);
    let ValueRead::Binary { base64, octets, .. } = manager.value(id, result, (0, 1)).unwrap() else { panic!("not binary") };
    assert_eq!((octets, base64.len()), (70_000, 93_336));
    assert_eq!(manager.value(id, result, (1, 0)).unwrap_err().sqlstate, "TB910");
    assert_eq!(manager.value(id, result + 99, (0, 0)).unwrap_err().sqlstate, "TB910");
    crate::run(&manager, id, "COMMIT").unwrap();
    manager.set_autocommit(id, true).unwrap();
    let Outcome::Rows { result, .. } = crate::run(&manager, id, "SELECT BODY FROM DOCS ORDER BY ID").unwrap().outcome else {
        panic!("no rows")
    };
    let read = manager.value(id, result, (0, 0));
    assert!(matches!(read, Ok(ValueRead::Text { octets: 90_000, .. })), "{read:?}");
    manager.close_result(id, result).unwrap();
    crate::run(&manager, id, "DROP TABLE DOCS CASCADE").unwrap();
    manager.close(id).unwrap();
}

/// [CLIENT Copying and exporting] [DESIGN] D39: a query's rows are written
/// to a file as CSV, its header the columns' names, or as native rows, read
/// back whole; a statement that is no query is not exported.
pub fn a_result_is_exported(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    let dir = live.server.dir.join("exports");
    std::fs::create_dir_all(&dir).unwrap();
    let csv = dir.join("rows.csv");
    let query = "VALUES (1, 'a, b'), (2, CAST(NULL AS VARCHAR(4)))";
    assert_eq!(manager.export(id, query, (&csv, ExportFormat::Csv)).unwrap(), 2);
    let written = std::fs::read_to_string(&csv).unwrap();
    assert_eq!(written.lines().nth(1), Some("1,\"a, b\""));
    let native = dir.join("rows.native");
    assert_eq!(manager.export(id, query, (&native, ExportFormat::Native)).unwrap(), 2);
    let (columns, rows) = turborel_client::export::read_native(&mut std::fs::File::open(&native).unwrap()).unwrap();
    assert_eq!((columns.len(), rows.len()), (2, 2));
    assert_eq!(manager.export(id, "DELETE FROM NOPE WHERE 1 = 1", (&csv, ExportFormat::Csv)).unwrap_err().sqlstate, "TB910");
    assert_eq!(manager.export(id, query, (&dir.join("none").join("rows.csv"), ExportFormat::Csv)).unwrap_err().sqlstate, "TB910");
    assert_eq!(manager.export(id, "SELECT * FROM NOPE", (&csv, ExportFormat::Csv)).unwrap_err().sqlstate, "2A000");
    manager.close(id).unwrap();
}

/// [CLIENT What the server tells] [DESIGN] D39: under autocommit, a query's
/// cursor keeps its transaction while rows are left to read, and ends it
/// as its last row is read, as `fetch-ends` grants, the session telling
/// it; a result closed before then ends it too.
pub fn a_cursor_ends_its_transaction_under_autocommit(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    let many = "WITH RECURSIVE N (I) AS (VALUES (CAST(1 AS INTEGER)) UNION ALL SELECT I + 1 FROM N WHERE I < 1200) SELECT I FROM N";
    let Outcome::Rows { result, page, .. } = crate::run(&manager, id, many).unwrap().outcome else { panic!("no rows") };
    assert!(!page.complete);
    assert!(manager.session(id).unwrap().transaction.active);
    let rest = manager.rows(id, result, (page.rows_read, 10_000)).unwrap();
    assert!(rest.complete);
    assert!(!manager.session(id).unwrap().transaction.active);
    manager.close_result(id, result).unwrap();
    let Outcome::Rows { result, .. } = crate::run(&manager, id, many).unwrap().outcome else { panic!("no rows") };
    assert!(manager.session(id).unwrap().transaction.active);
    manager.close_result(id, result).unwrap();
    assert!(!manager.session(id).unwrap().transaction.active);
    manager.close(id).unwrap();
}

/// [DOC sql/02-data-types.md Data Types] [RULE] R-NUM-1: a value of each
/// of Turborel's types is shown as the text the server's value gives:
/// character and binary strings, truth values, exact numbers with their
/// scale, approximate numbers, datetimes, intervals, arrays, rows,
/// multisets, JSON, XML, vectors, geometries and UUIDs; and of the user's
/// types, a distinct type's as its source's, a structured type's and a
/// reference's.
pub fn every_type_is_shown_as_its_text(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    let cases = [
        ("CAST('abc' AS VARCHAR(5))", "abc"),
        ("X'0aFF'", "0AFF"),
        ("TRUE", "TRUE"),
        ("CAST(12.50 AS DECIMAL(5,2))", "12.50"),
        ("CAST(1.5 AS DOUBLE PRECISION)", "1.5E0"),
        ("DATE '2024-02-29'", "2024-02-29"),
        ("TIMESTAMP '2024-02-29 13:04:05+02:00'", "2024-02-29 13:04:05+02:00"),
        ("INTERVAL '3' DAY", "3"),
        ("ARRAY[1, 2]", "ARRAY[1, 2]"),
        ("ROW(1, 'a')", "ROW(1, 'a')"),
        ("MULTISET[3]", "MULTISET[3]"),
        ("CAST('{\"a\":1}' AS JSON)", "{\"a\":1}"),
        ("XMLELEMENT(NAME \"a\", 1)", "<a>1</a>"),
        ("CAST('[1,2]' AS VECTOR(2))", "[1,2]"),
        ("ST_POINT(1, 2)", "POINT (1 2)"),
        ("CAST('6ba7b810-9dad-11d1-80b4-00c04fd430c8' AS UUID)", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"),
    ];
    let sql = format!("VALUES ({})", cases.iter().map(|(value, _)| *value).collect::<Vec<_>>().join(", "));
    let Outcome::Rows { page, columns, .. } = crate::run(&manager, id, &sql).unwrap().outcome else { panic!("no rows") };
    let shown: Vec<&str> = page.rows[0].iter().map(|c| c.as_deref().unwrap_or("NULL")).collect();
    assert_eq!(shown, cases.iter().map(|(_, text)| *text).collect::<Vec<_>>());
    // VALUES keeps the type its one value was declared of.
    assert_eq!(columns[3].type_written, "DECIMAL(5,2)");
    manager.set_autocommit(id, true).unwrap();
    for ddl in [
        "CREATE TYPE SHOWN_MONEY AS DECIMAL(10,2)",
        "CREATE TYPE SHOWN_ADDRESS AS (STREET VARCHAR(30), CITY VARCHAR(20)) NOT FINAL",
        "CREATE TABLE SHOWN_PLACES OF SHOWN_ADDRESS (REF IS PID SYSTEM GENERATED)",
        "INSERT INTO SHOWN_PLACES (STREET, CITY) VALUES ('Main', 'Oslo')",
    ] {
        crate::run(&manager, id, ddl).unwrap();
    }
    let Outcome::Rows { page, .. } = crate::run(&manager, id, "SELECT SHOWN_MONEY(5), DEREF(PID), PID FROM SHOWN_PLACES").unwrap().outcome
    else {
        panic!("no rows")
    };
    assert_eq!(page.rows[0][0].as_deref(), Some("5.00"));
    assert_eq!(page.rows[0][1].as_deref(), Some("ANN.SHOWN_ADDRESS('Main', 'Oslo')"));
    assert!(page.rows[0][2].as_deref().is_some_and(|r| r.starts_with("REF(")));
    for ddl in ["DROP TABLE SHOWN_PLACES CASCADE", "DROP TYPE SHOWN_ADDRESS CASCADE", "DROP TYPE SHOWN_MONEY CASCADE"] {
        crate::run(&manager, id, ddl).unwrap();
    }
    manager.close(id).unwrap();
}

/// [DOC sql/02-data-types.md Numbers] [DESIGN] D24: a number of 38 digits
/// round-trips exactly through the grid, an edit by parameters and an
/// export, never through a float.
pub fn a_38_digit_number_round_trips(live: &Live) {
    const WIDE: &str = "12345678901234567890123456789012345678";
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    crate::run(&manager, id, "CREATE TABLE WIDE (ID INTEGER PRIMARY KEY, N NUMERIC(38,0))").unwrap();
    let values = [Some("1".to_owned()), Some(WIDE.to_owned())];
    let RunAnswer::Ran(_) = manager.run_with(id, ("INSERT INTO WIDE VALUES (?, ?)", &values), false).unwrap() else { panic!("asked") };
    let Outcome::Rows { page, .. } = crate::run(&manager, id, "SELECT N FROM WIDE").unwrap().outcome else { panic!("no rows") };
    assert_eq!(page.rows, [[Some(WIDE.to_owned())]]);
    let edited = "-99999999999999999999999999999999999999";
    let update = ("UPDATE WIDE SET N = ? WHERE ID = ?", &[Some(edited.to_owned()), Some("1".to_owned())][..]);
    let RunAnswer::Ran(_) = manager.run_with(id, update, false).unwrap() else { panic!("asked") };
    let dir = live.server.dir.join("exports");
    std::fs::create_dir_all(&dir).unwrap();
    let csv = dir.join("wide.csv");
    assert_eq!(manager.export(id, "SELECT N FROM WIDE", (&csv, ExportFormat::Csv)).unwrap(), 1);
    assert_eq!(std::fs::read_to_string(&csv).unwrap().lines().nth(1), Some(edited));
    crate::run(&manager, id, "DROP TABLE WIDE CASCADE").unwrap();
    manager.close(id).unwrap();
}
