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
        reading: Reading { format: Format::Csv, header: true, delimiter: None, null: None },
        table: "\"ANN\".\"IMPORTED\"".to_owned(),
        fields: fields.iter().map(|f| f.map(str::to_owned)).collect(),
        batch,
        skip,
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
