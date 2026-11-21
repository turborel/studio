//! Every request a connection takes, answered by an embedded database's
//! worker as a server connection's answers it (`[DOC
//! client/03-embedding.md Cursors]`, `[DOC client/03-embedding.md
//! Prepared statements]`, `[DOC client/03-embedding.md Large objects]`).

use turborel_client::export::ExportFormat;
use turborel_studio_core::admin::{self, View};
use turborel_studio_core::connections::imports::{Format, ImportSpec, Reading};
use turborel_studio_core::connections::manager::{ConnectionManager, EMBEDDED_PREFIX, ImportAnswer, RunAnswer};
use turborel_studio_core::connections::outcome::Outcome;
use turborel_studio_core::connections::pages::PAGE_ROWS;
use turborel_studio_core::connections::values::ValueRead;
use turborel_studio_core::events::ConnectionId;

use crate::{Scratch, open, run, spec};

/// The rows of a query of the numbers 1 to 1234, in order.
const NUMBERS: &str =
    "WITH RECURSIVE T(N) AS (VALUES (CAST(1 AS INTEGER)) UNION ALL SELECT N + 1 FROM T WHERE N < 1234) SELECT N FROM T ORDER BY N";

/// A new database's connection, of `manager`, under autocommit.
fn connected(scratch: &Scratch, manager: &ConnectionManager) -> ConnectionId {
    let id = open(manager, &spec(&scratch.path("db"), true)).unwrap().connection;
    manager.set_autocommit(id, true).unwrap();
    id
}

/// The cells of the first column of `sql`'s rows on `id`, every page read.
fn column(manager: &ConnectionManager, id: ConnectionId, sql: &str) -> Vec<Option<String>> {
    let Outcome::Rows { result, page, .. } = run(manager, id, sql).unwrap().outcome else { panic!("{sql} gave no rows") };
    let mut cells: Vec<Option<String>> = page.rows.into_iter().map(|r| r.into_iter().next().unwrap()).collect();
    if !page.complete {
        let rest = manager.rows(id, result, (page.rows_read, 10_000)).unwrap();
        cells.extend(rest.rows.into_iter().map(|r| r.into_iter().next().unwrap()));
    }
    let _ = manager.close_result(id, result); // One read whole is closed already.
    cells
}

/// [DESIGN] D59 [RULE] R-SAFE-1 [DOC client/03-embedding.md Cursors] A
/// query's rows are read a page at a time through its cursor, earlier
/// ones read back, and the result closed; a statement that cannot be
/// prepared runs directly; a failure is kept whole.
pub fn a_query_is_paged_through_its_cursor(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let id = connected(scratch, &manager);
    let Outcome::Rows { result, columns, page } = run(&manager, id, NUMBERS).unwrap().outcome else { panic!("no rows") };
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
    let error = run(&manager, id, "SELECT * FROM NOPE").unwrap_err();
    assert_eq!((error.sqlcode, error.sqlstate.as_str()), (-103, "2A000"));
    run(&manager, id, "CREATE TABLE STAFF (ID INTEGER GENERATED ALWAYS AS IDENTITY, NAME VARCHAR(20))").unwrap();
    let ran = run(&manager, id, "INSERT INTO STAFF (NAME) VALUES ('Edsger'), ('Barbara')").unwrap();
    let Outcome::Done { sqlcode, rows_affected, generated, .. } = ran.outcome else { panic!("rows") };
    assert_eq!((sqlcode, rows_affected), (0, Some(2)));
    assert_eq!(generated, ["1", "2"]);
    manager.close(id).unwrap();
}

/// [DESIGN] D59 [DOC client/03-embedding.md Parameters] [DOC
/// client/03-embedding.md Large objects] Parameters are given values as
/// text, cast to their types; a large object longer than a row holds is
/// written by its locator and read back whole.
pub fn parameters_and_large_objects(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let id = connected(scratch, &manager);
    run(&manager, id, "CREATE TABLE BOUND (I INTEGER, S VARCHAR(10), BODY CLOB(1M), SCAN BLOB(1M))").unwrap();
    let insert = "INSERT INTO BOUND (I, S) VALUES (?, ?)";
    assert_eq!(manager.parameters(id, insert).unwrap().len(), 2);
    let RunAnswer::Ran(ran) = manager.run_with(id, (insert, &[Some("42".to_owned()), None]), false).unwrap() else { panic!("asked") };
    assert!(matches!(ran.outcome, Outcome::Done { rows_affected: Some(1), .. }), "{:?}", ran.outcome);
    let query = "SELECT S FROM BOUND WHERE I = ?";
    assert_eq!(manager.run_with(id, (query, &[Some("x".to_owned())]), false).unwrap_err().sqlstate, "22018");
    assert_eq!(manager.run_with(id, (query, &[]), false).unwrap_err().sqlstate, "TB910");
    manager.set_autocommit(id, false).unwrap();
    let text = "abc".repeat(30_000);
    let values = [Some(text.clone()), Some("78".repeat(70_000))];
    let RunAnswer::Ran(_) = manager.run_with(id, ("UPDATE BOUND SET BODY = ?, SCAN = ? WHERE I = 42", &values), false).unwrap() else {
        panic!("asked")
    };
    run(&manager, id, "COMMIT").unwrap();
    let Outcome::Rows { result, page, .. } = run(&manager, id, "SELECT BODY, SCAN FROM BOUND").unwrap().outcome else { panic!("no rows") };
    assert_eq!(page.rows[0][0].as_deref(), Some("<CHARACTER LARGE OBJECT of 90000 characters>"));
    assert_eq!(page.lobs, [(0, 0), (0, 1)]);
    let ValueRead::Text { text: read, octets, cut } = manager.value(id, result, (0, 0)).unwrap() else { panic!("not text") };
    assert_eq!((octets, cut), (90_000, false));
    assert_eq!(read, text);
    let ValueRead::Binary { octets, .. } = manager.value(id, result, (0, 1)).unwrap() else { panic!("not binary") };
    assert_eq!(octets, 70_000);
    run(&manager, id, "COMMIT").unwrap();
    manager.close(id).unwrap();
}

/// [DESIGN] D59 [DOC client/03-embedding.md Sessions] The session's
/// transaction is followed, autocommit committing each statement, a
/// query's once its cursor is read through; a read-only run makes its
/// transaction READ ONLY.
pub fn the_transaction_is_followed(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let id = connected(scratch, &manager);
    run(&manager, id, "CREATE TABLE T1 (A INTEGER)").unwrap();
    assert!(!run(&manager, id, "VALUES (1)").unwrap().session.transaction.active);
    let ran = run(&manager, id, NUMBERS).unwrap();
    assert!(ran.session.transaction.active, "a cursor still reading holds its transaction");
    let Outcome::Rows { result, .. } = ran.outcome else { panic!("no rows") };
    manager.close_result(id, result).unwrap();
    assert!(!manager.session(id).unwrap().transaction.active);
    assert!(!manager.set_autocommit(id, false).unwrap().transaction.autocommit);
    let ran = run(&manager, id, "INSERT INTO T1 VALUES (1)").unwrap();
    assert!(ran.session.transaction.active);
    assert!(!run(&manager, id, "ROLLBACK").unwrap().session.transaction.active);
    assert_eq!(column(&manager, id, "SELECT COUNT(*) FROM T1"), [Some("0".to_owned())]);
    run(&manager, id, "ROLLBACK").unwrap();
    let RunAnswer::Ran(ran) = manager.run_with(id, ("VALUES (2)", &[]), false).unwrap() else { panic!("asked") };
    assert!(!ran.session.transaction.read_only);
    manager.close(id).unwrap();
}

/// What imports `file`'s fields into IMPORTED, as `fields` say.
fn import_spec(file: &std::path::Path, fields: &[Option<&str>], (batch, skip): (u64, bool)) -> ImportSpec {
    ImportSpec {
        path: file.to_owned(),
        reading: Reading { format: Format::Csv, header: true, delimiter: None, null: None, sheet: None },
        table: "IMPORTED".into(),
        fields: fields.iter().map(|f| f.map(str::to_owned)).collect(),
        batch,
        skip,
        limit: None,
        binary: Vec::new(),
    }
}

/// [DESIGN] D59 [DOC client/03-embedding.md Reading rows] A query's rows
/// are exported as CSV and as native frames; a file's rows are imported a
/// batch at a time, a row refused skipped where asked, else the import
/// stopped with what was kept told.
pub fn rows_are_exported_and_imported(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let id = connected(scratch, &manager);
    let dir = scratch.path("files");
    std::fs::create_dir_all(&dir).unwrap();
    let csv = dir.join("rows.csv");
    let query = "VALUES (1, 'a, b'), (2, CAST(NULL AS VARCHAR(4)))";
    assert_eq!(manager.export(id, query, (&csv, ExportFormat::Csv)).unwrap(), 2);
    assert_eq!(std::fs::read_to_string(&csv).unwrap().lines().nth(1), Some("1,\"a, b\""));
    let native = dir.join("rows.native");
    assert_eq!(manager.export(id, query, (&native, ExportFormat::Native)).unwrap(), 2);
    let (columns, rows) = turborel_client::export::read_native(&mut std::fs::File::open(&native).unwrap()).unwrap();
    assert_eq!((columns.len(), rows.len()), (2, 2));
    run(&manager, id, "CREATE TABLE IMPORTED (ID INTEGER PRIMARY KEY, NAME VARCHAR(20))").unwrap();
    let file = dir.join("staff.csv");
    std::fs::write(&file, "NAME,ID,EXTRA\n\"Ada, Countess\",1,x\nGrace,2,y\n").unwrap();
    let fields = [Some("NAME"), Some("ID"), None];
    let ImportAnswer::Imported(done) = manager.import(id, import_spec(&file, &fields, (1000, false)), false).unwrap() else {
        panic!("asked")
    };
    assert_eq!((done.rows, done.rejected), (2, 0));
    let again = dir.join("again.csv");
    std::fs::write(&again, "NAME,ID,EXTRA\nAlan,3,z\nDup,1,z\nEdsger,4,z\n").unwrap();
    let ImportAnswer::Imported(skipped) = manager.import(id, import_spec(&again, &fields, (1, true)), false).unwrap() else {
        panic!("asked")
    };
    assert_eq!((skipped.rows, skipped.rejected), (2, 1));
    assert!(skipped.skipped[0].starts_with("record 2, line 3:"), "{:?}", skipped.skipped);
    run(&manager, id, "DELETE FROM IMPORTED WHERE ID > 2").unwrap();
    let stopped = manager.import(id, import_spec(&again, &fields, (1, false)), false).unwrap_err();
    assert!(stopped.message.contains("1 row committed"), "{}", stopped.message);
    assert_eq!(column(&manager, id, "SELECT ID FROM IMPORTED ORDER BY ID").len(), 3);
    manager.set_autocommit(id, false).unwrap();
    run(&manager, id, "INSERT INTO IMPORTED VALUES (9, 'open')").unwrap();
    assert!(manager.import(id, import_spec(&file, &fields, (1, false)), false).unwrap_err().message.contains("no transaction active"));
    run(&manager, id, "ROLLBACK").unwrap();
    manager.close(id).unwrap();
}

/// [DESIGN] D59 [DOC client/03-embedding.md Prepared statements] The
/// catalog's queries, a statement's columns and its plan, explained and
/// analyzed, are read as of a server.
pub fn the_catalog_and_plans_are_read(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let id = connected(scratch, &manager);
    run(&manager, id, "CREATE TABLE PLANNED (ID INTEGER PRIMARY KEY, NAME VARCHAR(20))").unwrap();
    run(&manager, id, "INSERT INTO PLANNED VALUES (1, 'a'), (2, 'b')").unwrap();
    let tables = manager
        .catalog(
            id,
            "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
            (&[crate::OWNER.to_owned()], 100),
        )
        .unwrap();
    assert_eq!(tables.len(), 1);
    assert!(!manager.session(id).unwrap().transaction.active, "a catalog read ends the transaction it began");
    let described = manager.describe(id, "SELECT ID, NAME FROM PLANNED").unwrap();
    assert_eq!(described.iter().map(|c| c.name.as_deref()).collect::<Vec<_>>(), [Some("ID"), Some("NAME")]);
    let plan = column(&manager, id, "EXPLAIN ANALYZE SELECT ID FROM PLANNED");
    assert!(plan.iter().flatten().any(|l| l.trim().starts_with("-- ran: 2 rows")), "{plan:?}");
    manager.close(id).unwrap();
}

/// [DESIGN] D59 [DOC operator/04-settings.md SET DATABASE] The database's
/// settings are read and changed as on a server, SET DATABASE kept with
/// it; the server's own views are absent, not failed.
pub fn settings_change_as_on_a_server(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let id = connected(scratch, &manager);
    let settings = admin::read(&manager, id, View::Settings).unwrap();
    assert!(settings.rows.len() > 10);
    run(&manager, id, "SET DATABASE CHECKPOINT.AFTER_BYTES = 33554432").unwrap();
    let after = column(&manager, id, "SELECT SETTING_VALUE FROM INFORMATION_SCHEMA.SETTINGS WHERE SETTING_NAME = 'CHECKPOINT.AFTER_BYTES'");
    assert_eq!(after, [Some("33554432".to_owned())]);
    assert!(admin::read(&manager, id, View::Connections).unwrap().absent);
    assert!(!admin::read(&manager, id, View::Extensions).unwrap().absent);
    manager.close(id).unwrap();
}

/// [DESIGN] D59 [RULE] R-SAFE-5 Each embedded database's session has a
/// worker of its own, named as one, held by the manager; reconnecting
/// starts a new session of the same database; cancelling with nothing
/// running harms nothing.
pub fn each_database_has_a_named_worker(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let (a, b) = (connected(scratch, &manager), connected(scratch, &manager));
    let names: Vec<String> = manager.threads().into_iter().map(|t| t.name).collect();
    assert_eq!(names, [format!("{EMBEDDED_PREFIX}{a}"), format!("{EMBEDDED_PREFIX}{b}")]);
    run(&manager, a, "CREATE TABLE KEPT (N INTEGER)").unwrap();
    manager.cancel(a).unwrap();
    manager.ping(a).unwrap();
    let session = manager.reconnect(a).unwrap();
    assert!(!session.transaction.active);
    assert_eq!(column(&manager, a, "SELECT COUNT(*) FROM KEPT"), [Some("0".to_owned())]);
    manager.close_all();
    assert_eq!(manager.threads(), []);
}

/// [DESIGN] D59 [DOC client/03-embedding.md Prepared statements] A
/// read-only connection's transactions begin READ ONLY; a procedure's
/// output parameters come as a row; a statement's columns and parameters
/// are described, never run.
pub fn read_only_runs_and_a_procedures_outputs(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let dir = scratch.path("outputs");
    let id = open(&manager, &spec(&dir, true)).unwrap().connection;
    manager.set_autocommit(id, true).unwrap();
    run(&manager, id, "CREATE TABLE ORDERS (ID INTEGER, QUANTITY INTEGER)").unwrap();
    run(&manager, id, "INSERT INTO ORDERS VALUES (1, 5), (2, 7)").unwrap();
    run(&manager, id, "CREATE PROCEDURE PLACED (OUT N INTEGER) READS SQL DATA SELECT COUNT(*) INTO N FROM ORDERS").unwrap();
    let RunAnswer::Ran(ran) = manager.run_with(id, ("CALL PLACED(?)", &[]), true).unwrap() else { panic!("asked") };
    let Outcome::Rows { page, .. } = ran.outcome else { panic!("no outputs: {:?}", ran.outcome) };
    assert_eq!(page.rows, [[Some("2".to_owned())]]);
    manager.close(id).unwrap();
    let guards = turborel_studio_core::guard::policy::Guards { read_only: true, ..Default::default() };
    let reader = manager.open_embedded(&spec(&dir, false), guards).unwrap().connection;
    let ran = run(&manager, reader, "SELECT COUNT(*) FROM ORDERS").unwrap();
    assert!(ran.session.transaction.read_only, "{:?}", ran.session.transaction);
    manager.ping(reader).unwrap();
    manager.close(reader).unwrap();
}

/// [DESIGN] D59 [RULE] R-ERR-2 Each request refused is told as of a
/// server's connection: a statement that cannot be prepared, a result or
/// value not open, a file not written; a connection closed with its
/// transaction open rolls it back.
pub fn refusals_are_told_and_an_open_transaction_undone(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let dir = scratch.path("refusals");
    let id = open(&manager, &spec(&dir, true)).unwrap().connection;
    assert!(manager.describe(id, "SELECT * FROM NOPE").is_err());
    assert!(manager.parameters(id, "SELEC 1").is_err());
    assert_eq!(manager.value(id, 99, (0, 0)).unwrap_err().sqlstate, "TB910");
    assert_eq!(manager.close_result(id, 99).unwrap_err().sqlstate, "TB910");
    let Outcome::Rows { result, .. } = run(&manager, id, "VALUES (1)").unwrap().outcome else { panic!("no rows") };
    assert_eq!(manager.value(id, result, (0, 0)).unwrap_err().sqlstate, "TB910");
    let missing = scratch.path("none").join("rows.csv");
    assert_eq!(manager.export(id, "VALUES (1)", (&missing, ExportFormat::Csv)).unwrap_err().sqlstate, "TB910");
    assert!(manager.import(id, import_spec(&missing, &[None], (1, false)), false).is_err());
    run(&manager, id, "CREATE TABLE KEPT (N INTEGER)").unwrap();
    run(&manager, id, "COMMIT").unwrap();
    run(&manager, id, "INSERT INTO KEPT VALUES (1)").unwrap();
    manager.close(id).unwrap();
    let again = open(&manager, &spec(&dir, false)).unwrap().connection;
    assert_eq!(column(&manager, again, "SELECT COUNT(*) FROM KEPT"), [Some("0".to_owned())]);
    manager.close(again).unwrap();
}

/// [DESIGN] D61 [DOC sql/statements/explain.md EXPLAIN ANALYZE of a data
/// change] EXPLAIN ANALYZE runs a data change for real; rolled back to a
/// savepoint set before it, as Studio rolls it back, it leaves nothing.
pub fn an_analyzed_change_is_rolled_back(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let id = connected(scratch, &manager);
    run(&manager, id, "CREATE TABLE OFFERS (ID INTEGER, PRICE INTEGER)").unwrap();
    run(&manager, id, "INSERT INTO OFFERS VALUES (1, 10), (2, 60)").unwrap();
    manager.set_autocommit(id, false).unwrap();
    run(&manager, id, "SAVEPOINT STUDIO_ANALYZE").unwrap();
    let plan = column(&manager, id, "EXPLAIN ANALYZE UPDATE OFFERS SET PRICE = PRICE + 1 WHERE PRICE <= 50");
    assert!(plan.iter().flatten().any(|l| l.contains("actual rows changed=1")), "{plan:?}");
    run(&manager, id, "ROLLBACK TO SAVEPOINT STUDIO_ANALYZE").unwrap();
    run(&manager, id, "ROLLBACK").unwrap();
    assert_eq!(column(&manager, id, "SELECT PRICE FROM OFFERS WHERE ID = 1"), [Some("10".to_owned())]);
    manager.close(id).unwrap();
}

/// The number of 38 digits, Turborel's most, of the round trips.
const WIDE: &str = "12345678901234567890123456789012345678";

/// [DESIGN] D59 [DOC sql/02-data-types.md Numbers] A number of 38 digits
/// round-trips exactly through the grid, an edit by parameters and an
/// export, never through a float.
pub fn a_38_digit_number_round_trips(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let id = connected(scratch, &manager);
    run(&manager, id, "CREATE TABLE WIDE (ID INTEGER PRIMARY KEY, N NUMERIC(38,0), D DECIMAL(38,10))").unwrap();
    let fraction = "1234567890123456789012345678.0123456789";
    let values = [Some("1".to_owned()), Some(WIDE.to_owned()), Some(fraction.to_owned())];
    let RunAnswer::Ran(_) = manager.run_with(id, ("INSERT INTO WIDE VALUES (?, ?, ?)", &values), false).unwrap() else { panic!("asked") };
    let Outcome::Rows { page, columns, .. } = run(&manager, id, "SELECT N, D FROM WIDE").unwrap().outcome else { panic!("no rows") };
    assert_eq!(page.rows, [[Some(WIDE.to_owned()), Some(fraction.to_owned())]]);
    assert_eq!(columns[0].type_written, "NUMERIC(38,0)");
    let edited = "-99999999999999999999999999999999999999";
    let RunAnswer::Ran(_) =
        manager.run_with(id, ("UPDATE WIDE SET N = ? WHERE ID = ?", &[Some(edited.to_owned()), Some("1".to_owned())]), false).unwrap()
    else {
        panic!("asked")
    };
    assert_eq!(column(&manager, id, "SELECT N FROM WIDE"), [Some(edited.to_owned())]);
    let csv = scratch.path("wide").with_extension("csv");
    assert_eq!(manager.export(id, "SELECT N, D FROM WIDE", (&csv, ExportFormat::Csv)).unwrap(), 1);
    assert_eq!(std::fs::read_to_string(&csv).unwrap().lines().nth(1), Some(format!("{edited},{fraction}").as_str()));
    manager.close(id).unwrap();
}
