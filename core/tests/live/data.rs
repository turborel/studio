//! The live tests of data: rows imported from files (RULES.md D43).

use turborel_studio_core::connections::imports::{Format, ImportSpec, Reading};
use turborel_studio_core::connections::manager::{ImportAnswer, RunAnswer};
use turborel_studio_core::connections::outcome::Outcome;
use turborel_studio_core::guard::policy::Guards;
use turborel_studio_core::saved::Environment;

use crate::{Live, no_environment, run};

/// An import of `path` into IMPORTED as `fields` say, its batch `batch`,
/// skipping rows refused if `skip`.
fn spec(path: &std::path::Path, fields: &[Option<&str>], (batch, skip): (u64, bool)) -> ImportSpec {
    ImportSpec {
        path: path.to_owned(),
        reading: Reading { format: Format::Csv, header: true, delimiter: None, null: None, sheet: None },
        table: "\"ANN\".\"IMPORTED\"".to_owned(),
        fields: fields.iter().map(|f| f.map(str::to_owned)).collect(),
        batch,
        skip,
        limit: None,
    }
}

/// The rows of IMPORTED, by ID.
fn imported(
    manager: &turborel_studio_core::connections::manager::ConnectionManager,
    id: turborel_studio_core::events::ConnectionId,
) -> Vec<Vec<Option<String>>> {
    let Outcome::Rows { page, .. } = run(manager, id, "SELECT ID, NAME FROM IMPORTED ORDER BY ID").unwrap().outcome else {
        panic!("no rows")
    };
    page.rows
}

/// [CLIENT Importing] [CLIENT Copying and exporting] [DESIGN] D43: a CSV
/// file's rows are imported, each
/// field into the column chosen, a field of none skipped; a row refused
/// ends the import, the rows committed before it kept, or, skipped, is
/// told; an import begins with no transaction active, and a production
/// connection asks first.
pub fn rows_are_imported_from_a_file(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    run(&manager, id, "CREATE TABLE IMPORTED (ID INTEGER PRIMARY KEY, NAME VARCHAR(20))").unwrap();
    let dir = live.server.dir.join("imports");
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("staff.csv");
    std::fs::write(&file, "NAME,ID,EXTRA\n\"Ada, Countess\",1,x\nGrace,2,y\n").unwrap();
    let fields = [Some("NAME"), Some("ID"), None];
    let ImportAnswer::Imported(done) = manager.import(id, spec(&file, &fields, (1000, false)), false).unwrap() else { panic!("asked") };
    assert_eq!((done.rows, done.rejected), (2, 0));
    assert_eq!(
        imported(&manager, id),
        [vec![Some("1".to_owned()), Some("Ada, Countess".to_owned())], vec![Some("2".to_owned()), Some("Grace".to_owned())]]
    );
    let again = dir.join("again.csv");
    std::fs::write(&again, "NAME,ID,EXTRA\nAlan,3,z\nDup,1,z\nEdsger,4,z\n").unwrap();
    let ImportAnswer::Imported(skipped) = manager.import(id, spec(&again, &fields, (1, true)), false).unwrap() else { panic!("asked") };
    assert_eq!((skipped.rows, skipped.rejected), (2, 1));
    assert!(skipped.skipped[0].starts_with("record 2, line 3:"), "{:?}", skipped.skipped);
    run(&manager, id, "DELETE FROM IMPORTED WHERE ID > 2").unwrap();
    let stopped = manager.import(id, spec(&again, &fields, (1, false)), false).unwrap_err();
    assert!(stopped.message.contains("1 row committed"), "{}", stopped.message);
    assert_eq!(imported(&manager, id).len(), 3);
    assert_eq!(manager.import(id, spec(&again, &[None, None], (1, false)), false).unwrap_err().sqlstate, "TB910");
    manager.set_autocommit(id, false).unwrap();
    run(&manager, id, "VALUES (1)").unwrap();
    assert!(manager.import(id, spec(&file, &fields, (1, false)), false).unwrap_err().message.contains("no transaction active"));
    run(&manager, id, "ROLLBACK").unwrap();
    manager.set_autocommit(id, true).unwrap();
    let guards = Guards { environment: Environment::Production, read_only: false };
    let production = manager.open((&live.spec(), guards), Some(&live.password()), no_environment).unwrap().connection;
    assert!(matches!(manager.import(production, spec(&file, &fields, (1, false)), false).unwrap(), ImportAnswer::Confirm(_)));
    manager.close(production).unwrap();
    let RunAnswer::Ran(_) = manager.run(id, "DROP TABLE IMPORTED CASCADE", true).unwrap() else { panic!("asked") };
    manager.close(id).unwrap();
}

/// [DOC sql/statements/create-table.md SYNOPSIS] [DOC sql/statements/alter-table.md SYNOPSIS]
/// [DESIGN] D44: the DDL the table dialogs write runs as written: a table
/// of a key, a default and a unique column; one of a foreign key and a
/// check; and each action of ALTER TABLE the alter dialog stages.
pub fn the_table_dialogs_ddl_runs(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    for sql in [
        "CREATE TABLE ANN.DEPT (\n    ID INTEGER NOT NULL PRIMARY KEY,\n    NAME VARCHAR(20) DEFAULT 'none' UNIQUE\n)",
        "CREATE TABLE ANN.STAFF2 (\n    ID INTEGER NOT NULL PRIMARY KEY,\n    DEPT INTEGER,\n    CONSTRAINT STAFF2_DEPT FOREIGN KEY (DEPT) REFERENCES ANN.DEPT (ID) ON DELETE SET NULL,\n    CHECK (ID > 0)\n)",
        "ALTER TABLE ANN.STAFF2 ADD COLUMN NOTE VARCHAR(10) DEFAULT 'x' NOT NULL",
        "ALTER TABLE ANN.STAFF2 ALTER COLUMN NOTE SET DATA TYPE VARCHAR(40)",
        "ALTER TABLE ANN.STAFF2 ALTER COLUMN NOTE DROP NOT NULL",
        "ALTER TABLE ANN.STAFF2 ALTER COLUMN NOTE SET NOT NULL",
        "ALTER TABLE ANN.STAFF2 ALTER COLUMN NOTE SET DEFAULT 'y'",
        "ALTER TABLE ANN.STAFF2 ALTER COLUMN NOTE DROP DEFAULT",
        "ALTER TABLE ANN.STAFF2 RENAME COLUMN NOTE TO REMARK",
        "ALTER TABLE ANN.STAFF2 ADD CONSTRAINT STAFF2_U UNIQUE (REMARK)",
        "ALTER TABLE ANN.STAFF2 DROP CONSTRAINT STAFF2_U RESTRICT",
        "ALTER TABLE ANN.STAFF2 DROP COLUMN REMARK RESTRICT",
        "ALTER TABLE ANN.STAFF2 RENAME TO STAFF3",
    ] {
        run(&manager, id, sql).unwrap_or_else(|e| panic!("{sql}: {}", e.message));
    }
    for sql in ["DROP TABLE ANN.STAFF3 CASCADE", "DROP TABLE ANN.DEPT CASCADE"] {
        let RunAnswer::Ran(_) = manager.run(id, sql, true).unwrap() else { panic!("asked") };
    }
    manager.close(id).unwrap();
}

/// [DESIGN] D45: the statements a comparison writes make the target's rows
/// the source's: a row updated, one inserted and one deleted, each value a
/// literal of its column's type.
pub fn a_comparisons_script_syncs_the_target(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    for sql in [
        "CREATE TABLE PRICES (ID INTEGER PRIMARY KEY, NAME VARCHAR(20), PRICE DECIMAL(9,2))",
        "CREATE TABLE PRICES_COPY (ID INTEGER PRIMARY KEY, NAME VARCHAR(20), PRICE DECIMAL(9,2))",
        "INSERT INTO PRICES VALUES (1, 'Pen', 2.50), (2, 'Ink''s', 3.00), (4, 'Pad', NULL)",
        "INSERT INTO PRICES_COPY VALUES (1, 'Pen', 2.50), (2, 'Ink', 3.10), (3, 'Nib', 1.00)",
        "UPDATE \"ANN\".\"PRICES_COPY\" SET \"NAME\" = 'Ink''s', \"PRICE\" = 3.00 WHERE \"ID\" = 2",
        "INSERT INTO \"ANN\".\"PRICES_COPY\" (\"ID\", \"NAME\", \"PRICE\") VALUES (4, 'Pad', NULL)",
        "DELETE FROM \"ANN\".\"PRICES_COPY\" WHERE \"ID\" = 3",
    ] {
        run(&manager, id, sql).unwrap_or_else(|e| panic!("{sql}: {}", e.message));
    }
    let differ = "SELECT COUNT(*) FROM (SELECT * FROM PRICES EXCEPT SELECT * FROM PRICES_COPY) AS D";
    let Outcome::Rows { page, .. } = run(&manager, id, differ).unwrap().outcome else { panic!("no rows") };
    assert_eq!(page.rows, [[Some("0".to_owned())]]);
    let Outcome::Rows { page, .. } = run(&manager, id, "SELECT COUNT(*) FROM PRICES_COPY").unwrap().outcome else { panic!("no rows") };
    assert_eq!(page.rows, [[Some("3".to_owned())]]);
    for sql in ["DROP TABLE PRICES CASCADE", "DROP TABLE PRICES_COPY CASCADE"] {
        let RunAnswer::Ran(_) = manager.run(id, sql, true).unwrap() else { panic!("asked") };
    }
    manager.close(id).unwrap();
}

/// [DOC sql/statements/alter-table.md SYNOPSIS] [DOC sql/statements/create-index.md SYNOPSIS]
/// [DOC sql/statements/drop-index.md SYNOPSIS] [DESIGN] D47: the script a
/// model's comparison writes takes the schema to the model: an index
/// dropped and one made, constraints dropped and one added, a column's
/// type widened, its default and NOT NULL set, a column added and one
/// dropped, each statement under autocommit, as DROP INDEX must be.
pub fn a_models_script_migrates_the_schema(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    for sql in [
        "CREATE TABLE ANN.DEPT (ID INTEGER NOT NULL, NAME VARCHAR(20) DEFAULT 'none', CONSTRAINT DEPT_PRIMARY1 PRIMARY KEY (ID))",
        "CREATE TABLE ANN.STAFF (ID INTEGER NOT NULL, DEPT INTEGER, AGE INTEGER, CONSTRAINT STAFF_PRIMARY1 PRIMARY KEY (ID), \
         CONSTRAINT STAFF_UNIQUE1 UNIQUE (DEPT, AGE), CONSTRAINT STAFF_AGE CHECK (AGE > 0), \
         CONSTRAINT STAFF_DEPT FOREIGN KEY (DEPT) REFERENCES ANN.DEPT (ID) ON DELETE SET NULL)",
        "CREATE INDEX STAFF_BY_DEPT ON ANN.STAFF (DEPT)",
        "DROP INDEX STAFF_BY_DEPT",
        "ALTER TABLE ANN.STAFF DROP CONSTRAINT STAFF_UNIQUE1 RESTRICT",
        "ALTER TABLE ANN.STAFF DROP CONSTRAINT STAFF_AGE RESTRICT",
        "ALTER TABLE ANN.STAFF ALTER COLUMN ID SET DATA TYPE BIGINT",
        "ALTER TABLE ANN.STAFF ALTER COLUMN DEPT SET DEFAULT 1",
        "ALTER TABLE ANN.STAFF ALTER COLUMN DEPT SET NOT NULL",
        "ALTER TABLE ANN.STAFF ADD COLUMN NOTE VARCHAR(40)",
        "ALTER TABLE ANN.STAFF DROP COLUMN AGE RESTRICT",
        "ALTER TABLE ANN.STAFF ADD CONSTRAINT STAFF_NOTE CHECK (NOTE <> '')",
        "CREATE INDEX STAFF_BY_NOTE ON ANN.STAFF (NOTE) USING hash",
    ] {
        let RunAnswer::Ran(_) = manager.run(id, sql, true).unwrap_or_else(|e| panic!("{sql}: {}", e.message)) else { panic!("asked") };
    }
    let table = turborel_studio_core::catalog::Catalog::of(&manager, id).table("ANN", "STAFF").unwrap();
    let columns: Vec<(&str, &str, bool)> = table.columns.iter().map(|c| (c.name.as_str(), c.type_written.as_str(), c.nullable)).collect();
    assert_eq!(columns, [("ID", "BIGINT", false), ("DEPT", "INTEGER", false), ("NOTE", "CHARACTER VARYING(40)", true)]);
    assert!(table.indexes.iter().any(|i| i.name == "STAFF_BY_NOTE" && i.method == "hash"));
    for sql in ["DROP TABLE ANN.STAFF CASCADE", "DROP TABLE ANN.DEPT CASCADE"] {
        let RunAnswer::Ran(_) = manager.run(id, sql, true).unwrap() else { panic!("asked") };
    }
    manager.close(id).unwrap();
}

/// [DOC sql/statements/select.md SYNOPSIS] [DESIGN] D48: the query the
/// query builder writes runs as written: a join a foreign key implies,
/// left, a condition, an aggregate grouped by the other column, and order.
pub fn a_built_query_runs(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    for sql in [
        "CREATE TABLE ANN.DEPTS (ID INTEGER PRIMARY KEY, TITLE VARCHAR(20))",
        "CREATE TABLE ANN.STAFF (ID INTEGER PRIMARY KEY, NAME VARCHAR(20), DEPT INTEGER REFERENCES ANN.DEPTS)",
        "INSERT INTO ANN.DEPTS VALUES (1, 'Sales'), (2, 'Ops')",
        "INSERT INTO ANN.STAFF VALUES (1, 'Ada', 1), (2, 'Alan', 1), (3, 'Amy', 2), (4, 'Bob', 2), (5, 'Ann', NULL)",
    ] {
        run(&manager, id, sql).unwrap_or_else(|e| panic!("{sql}: {}", e.message));
    }
    let built = "SELECT D1.TITLE, COUNT(S1.ID)\nFROM ANN.STAFF S1\nLEFT JOIN ANN.DEPTS D1 ON D1.ID = S1.DEPT\nWHERE S1.NAME LIKE 'A%'\nGROUP BY D1.TITLE\nORDER BY D1.TITLE DESC";
    let Outcome::Rows { page, .. } = run(&manager, id, built).unwrap().outcome else { panic!("no rows") };
    let rows: Vec<Vec<Option<&str>>> = page.rows.iter().map(|r| r.iter().map(Option::as_deref).collect()).collect();
    // A null sorts as the greatest value, so first in DESC order.
    assert_eq!(rows, [vec![None, Some("1")], vec![Some("Sales"), Some("2")], vec![Some("Ops"), Some("1")]]);
    for sql in ["DROP TABLE ANN.STAFF CASCADE", "DROP TABLE ANN.DEPTS CASCADE"] {
        let RunAnswer::Ran(_) = manager.run(id, sql, true).unwrap() else { panic!("asked") };
    }
    manager.close(id).unwrap();
}

/// [CLIENT Importing] [DESIGN] D63 [DOC sql/02-data-types.md Numbers]: a
/// JSON array's and an object-a-line file's records are imported into a
/// server's table by copy, a 38-digit number kept whole, the progress
/// told; an import cancelled keeps its batches committed.
pub fn json_records_are_imported(live: &Live) {
    const WIDE: &str = "12345678901234567890123456789012345678";
    let (manager, events) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    run(&manager, id, "CREATE TABLE JSONED (ID INTEGER PRIMARY KEY, N NUMERIC(38,0), DOC JSON)").unwrap();
    let dir = live.server.dir.join("imports");
    std::fs::create_dir_all(&dir).unwrap();
    let json = dir.join("wide.json");
    std::fs::write(&json, format!(r#"[{{"id": 1, "n": {WIDE}, "doc": {{"a": 1}}}}, {{"id": 2, "n": -{WIDE}}}]"#)).unwrap();
    let reading = |format| Reading { format, header: true, delimiter: None, null: None, sheet: None };
    let spec = |path: &std::path::Path, format, batch| ImportSpec {
        path: path.to_owned(),
        reading: reading(format),
        table: "JSONED".into(),
        fields: vec![Some("ID".into()), Some("N".into()), Some("DOC".into())],
        batch,
        skip: false,
        limit: None,
    };
    let ImportAnswer::Imported(done) = manager.import(id, spec(&json, Format::Json, 1000), false).unwrap() else { panic!("asked") };
    assert_eq!(done.rows, 2);
    let Outcome::Rows { page, .. } = run(&manager, id, "SELECT N FROM JSONED ORDER BY ID").unwrap().outcome else { panic!("no rows") };
    assert_eq!(page.rows, [[Some(WIDE.to_owned())], [Some(format!("-{WIDE}"))]]);
    assert!(
        events.take().iter().any(|e| matches!(e, turborel_studio_core::events::Event::Import { progress, .. } if progress.records == 2))
    );
    run(&manager, id, "DELETE FROM JSONED WHERE ID > 0").unwrap();
    let lines = dir.join("many.ndjson");
    let text = (1..=20_000).map(|n| format!("{{\"id\": {n}, \"n\": {n}}}\n")).collect::<Vec<_>>().concat();
    std::fs::write(&lines, text).unwrap();
    let report = std::thread::scope(|scope| {
        let running = scope.spawn(|| manager.import(id, spec(&lines, Format::Ndjson, 100), false));
        while !running.is_finished() {
            let _ = manager.cancel_import(id); // None runs until the import begins.
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        running.join().unwrap().unwrap()
    });
    let ImportAnswer::Imported(report) = report else { panic!("asked") };
    assert!(report.cancelled, "{report:?}");
    let Outcome::Rows { page, .. } = run(&manager, id, "SELECT COUNT(*) FROM JSONED").unwrap().outcome else { panic!("no rows") };
    assert_eq!(page.rows[0][0], Some(report.rows.to_string()));
    let RunAnswer::Ran(_) = manager.run(id, "DROP TABLE JSONED CASCADE", true).unwrap() else { panic!("asked") };
    manager.close(id).unwrap();
}

/// [DESIGN] D65 D62: a schema's script with its rows as INSERTs, saved,
/// its tables dropped, and run back by Run SQL File, gives the same rows,
/// a 38-digit number among them, on a server.
pub fn a_script_with_its_rows_runs_back(live: &Live) {
    use turborel_studio_core::catalog::Catalog;
    use turborel_studio_core::catalog::ddl::create;
    use turborel_studio_core::connections::manager::scripts::DataScript;
    use turborel_studio_core::connections::manager::sqlfile::{Ending, FileAnswer, FileOptions, Transactions};
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    run(&manager, id, "CREATE TABLE SCRIPTED (ID INTEGER PRIMARY KEY, N NUMERIC(38,0), NOTE VARCHAR(20), ON_DAY DATE)").unwrap();
    run(
        &manager,
        id,
        "INSERT INTO SCRIPTED VALUES (1, 12345678901234567890123456789012345678, 'it''s', DATE '2024-01-02'), (2, NULL, NULL, NULL)",
    )
    .unwrap();
    let rows = |manager: &turborel_studio_core::connections::manager::ConnectionManager| {
        let Outcome::Rows { page, .. } = run(manager, id, "SELECT * FROM SCRIPTED ORDER BY ID").unwrap().outcome else { panic!("no rows") };
        page.rows
    };
    let expected = rows(&manager);
    let schema = manager.session(id).unwrap().schema.unwrap();
    let detail = Catalog::of(&manager, id).table(&schema, "SCRIPTED").unwrap();
    let dir = live.server.dir.join("scripts");
    std::fs::create_dir_all(&dir).unwrap();
    let script = dir.join("scripted.sql");
    std::fs::write(&script, create(&detail)).unwrap();
    let done = manager.script_data(id, &[(schema, "SCRIPTED".to_owned())], DataScript::Inserts, &script).unwrap();
    assert_eq!(done.rows, 2);
    run(&manager, id, "DROP TABLE SCRIPTED CASCADE").unwrap();
    let options = FileOptions { transactions: Transactions::Whole, stop_on_error: true };
    let FileAnswer::Ran { report } = manager.run_file(id, &script, options, true).unwrap() else { panic!("asked") };
    assert_eq!(report.ending, Ending::Finished, "{report:?}");
    assert_eq!(rows(&manager), expected);
    run(&manager, id, "DROP TABLE SCRIPTED CASCADE").unwrap();
    manager.close(id).unwrap();
}
