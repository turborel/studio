//! A schema's script with its data (RULES.md D65), round-tripped on
//! embedded databases: its definitions and its rows as INSERTs loaded
//! back by Run SQL File, or its rows as CSV files beside it loaded back
//! by the import, giving the same rows.

use std::path::Path;

use turborel_studio_core::catalog::Catalog;
use turborel_studio_core::catalog::ddl::schema_script;
use turborel_studio_core::connections::imports::{Format, ImportSpec, Reading};
use turborel_studio_core::connections::manager::scripts::{DataScript, data_file};
use turborel_studio_core::connections::manager::sqlfile::{Ending, FileAnswer, FileOptions, Transactions};
use turborel_studio_core::connections::manager::{ConnectionManager, ImportAnswer};
use turborel_studio_core::connections::outcome::Outcome;
use turborel_studio_core::events::ConnectionId;

use crate::{OWNER, Scratch, open, run, spec};

/// The rows of each table of the shop, every cell, in order.
fn rows_of(manager: &ConnectionManager, id: ConnectionId) -> Vec<Vec<Vec<Option<String>>>> {
    ["SELECT * FROM CUSTOMERS ORDER BY ID", "SELECT * FROM ORDERS ORDER BY ID"]
        .iter()
        .map(|sql| {
            let Outcome::Rows { result, page, .. } = run(manager, id, sql).unwrap().outcome else { panic!("no rows") };
            let _ = manager.close_result(id, result);
            page.rows
        })
        .collect()
}

/// A new database, its session's autocommit on.
fn database(scratch: &Scratch, manager: &ConnectionManager) -> ConnectionId {
    let id = open(manager, &spec(&scratch.path("db"), true)).unwrap().connection;
    manager.set_autocommit(id, true).unwrap();
    id
}

/// Runs the script at `path` on `id`, in one transaction, stopping at a failure.
fn run_script(manager: &ConnectionManager, id: ConnectionId, path: &Path) {
    let options = FileOptions { transactions: Transactions::Whole, stop_on_error: true };
    let FileAnswer::Ran { report } = manager.run_file(id, path, options, true).unwrap() else { panic!("asked") };
    assert_eq!(report.ending, Ending::Finished, "{report:?}");
}

/// Imports the shop's CSV files `files`, of CUSTOMERS then ORDERS, into
/// the tables of `id`, each by its header.
fn import_files(manager: &ConnectionManager, id: ConnectionId, files: &[String]) {
    for (file, table, fields) in [
        (&files[0], "CUSTOMERS", vec!["ID", "NAME", "BALANCE", "JOINED", "SEEN", "VIP", "PREFS"]),
        (&files[1], "ORDERS", vec!["ID", "CUSTOMER", "TOTAL"]),
    ] {
        let import = ImportSpec {
            path: file.into(),
            reading: Reading { format: Format::Csv, header: true, delimiter: None, null: None, sheet: None },
            table: table.to_owned(),
            fields: fields.into_iter().map(|f| Some(f.to_owned())).collect(),
            batch: 1000,
            skip: false,
            limit: None,
        };
        let ImportAnswer::Imported(report) = manager.import(id, import, false).unwrap() else { panic!("asked") };
        assert_eq!(report.rows, 2);
    }
}

/// [DESIGN] D65 D62 [DOC sql/statements/insert.md RULES]: a schema's
/// definitions and its rows, as INSERTs or as CSV files, load back into
/// a new database giving the same rows: a 38-digit number, a date and a
/// timestamp, a truth value, JSON, a quote, a null, an identity column
/// GENERATED ALWAYS and a foreign key's order, a generated column made
/// again of its own.
pub fn a_script_with_its_data_round_trips(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let source = database(scratch, &manager);
    for sql in [
        "CREATE TABLE CUSTOMERS (ID INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, NAME VARCHAR(40), BALANCE NUMERIC(38,2), JOINED DATE, SEEN TIMESTAMP, VIP BOOLEAN, PREFS JSON, INITIAL GENERATED ALWAYS AS (SUBSTRING(NAME FROM 1 FOR 1)))",
        "CREATE TABLE ORDERS (ID INTEGER PRIMARY KEY, CUSTOMER INTEGER REFERENCES CUSTOMERS (ID), TOTAL NUMERIC(38,0))",
        "INSERT INTO CUSTOMERS (NAME, BALANCE, JOINED, SEEN, VIP, PREFS) VALUES ('O''Neil', 123456789012345678901234567890123456.78, DATE '2024-01-02', TIMESTAMP '2024-01-02 10:30:00.5', TRUE, JSON('{\"a\": [1, 2]}'))",
        "INSERT INTO CUSTOMERS (NAME, BALANCE, JOINED, SEEN, VIP, PREFS) VALUES (NULL, NULL, NULL, NULL, FALSE, NULL)",
        "INSERT INTO ORDERS VALUES (1, 1, 12345678901234567890123456789012345678), (2, 2, -1)",
    ] {
        run(&manager, source, sql).unwrap();
    }
    let expected = rows_of(&manager, source);
    let parts = Catalog::of(&manager, source).schema_parts(OWNER).unwrap();
    let tables = [(OWNER.to_owned(), "ORDERS".to_owned()), (OWNER.to_owned(), "CUSTOMERS".to_owned())];
    let script = scratch.path("shop").with_extension("sql");
    std::fs::write(&script, schema_script(OWNER, &parts)).unwrap();
    let inserts = scratch.path("inserts").with_extension("sql");
    std::fs::copy(&script, &inserts).unwrap();
    let done = manager.script_data(source, &tables, DataScript::Inserts, &inserts).unwrap();
    assert_eq!(done.rows, 4);
    let text = std::fs::read_to_string(&inserts).unwrap();
    assert!(text.find("-- The rows of \"TESTER\".\"CUSTOMERS\"").unwrap() < text.find("-- The rows of \"TESTER\".\"ORDERS\"").unwrap());
    assert!(text.contains("OVERRIDING SYSTEM VALUE"), "{text}");
    let by_inserts = database(scratch, &manager);
    run_script(&manager, by_inserts, &inserts);
    assert_eq!(rows_of(&manager, by_inserts), expected);
    let done = manager.script_data(source, &tables, DataScript::Csv, &script).unwrap();
    assert_eq!(
        done.files,
        [data_file(&script, OWNER, "CUSTOMERS").display().to_string(), data_file(&script, OWNER, "ORDERS").display().to_string()]
    );
    let by_csv = database(scratch, &manager);
    run_script(&manager, by_csv, &script);
    run(&manager, by_csv, "ALTER TABLE CUSTOMERS ALTER COLUMN ID SET GENERATED BY DEFAULT").unwrap();
    import_files(&manager, by_csv, &done.files);
    assert_eq!(rows_of(&manager, by_csv), expected);
    for id in [source, by_inserts, by_csv] {
        manager.close(id).unwrap();
    }
}
