//! A DDL script imported into a model (RULES.md D64): its definitions run
//! in an in-memory database of their own, the model read of its catalog,
//! and what a model does not hold listed by its line, with why.

use turborel_studio_core::catalog::Catalog;

use crate::Scratch;

/// [DESIGN] D64: a script's tables, keys, foreign keys and indexes are
/// read back as Turborel defines them, of the schema named or the one
/// chosen for unqualified names; a view is run but not modeled, a
/// statement of data or of privileges is not run, and a definition the
/// database refuses is told with its refusal, each by its line.
pub fn a_ddl_script_becomes_a_model(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let script = scratch.path("schema").with_extension("sql");
    std::fs::write(
        &script,
        "-- The shop.\nCREATE TABLE CUSTOMERS (ID INTEGER PRIMARY KEY, NAME VARCHAR(40) NOT NULL, BALANCE NUMERIC(38,2) DEFAULT 0);\n\
         CREATE SCHEMA SALES;\n\
         CREATE TABLE SALES.ORDERS (ID INTEGER PRIMARY KEY, CUSTOMER INTEGER REFERENCES SHOP.CUSTOMERS (ID) ON DELETE CASCADE, PLACED DATE);\n\
         CREATE INDEX ORDERS_AT ON SALES.ORDERS (PLACED);\n\
         CREATE VIEW BIG AS SELECT * FROM CUSTOMERS WHERE BALANCE > 1000;\n\
         INSERT INTO CUSTOMERS VALUES (1, 'Ada', 5);\n\
         GRANT SELECT ON CUSTOMERS TO PUBLIC;\n\
         CREATE TABLE BROKEN (A NOT_A_TYPE);\n\
         ALTER TABLE CUSTOMERS ADD CONSTRAINT NAMED UNIQUE (NAME);\n",
    )
    .unwrap();
    let made = manager.ddl_model(&script, "SHOP").unwrap();
    assert_eq!(made.schemas, ["SALES", "SHOP"]);
    assert_eq!(made.statements, 9);
    let left: Vec<(u64, &str)> = made.left_out.iter().map(|l| (l.line, l.why.as_str())).collect();
    assert_eq!(left[0], (6, "a definition of a view, which a model does not hold"));
    assert_eq!(left[1], (7, "a statement of data, not a definition: not run"));
    assert_eq!(left[2], (8, "a statement of privileges or users: not run"));
    assert_eq!(left[3].0, 9);
    assert!(left[3].1.starts_with("refused: SQLSTATE"), "{left:?}");
    assert_eq!(made.left_out_count, 4);
    let catalog = Catalog::of(&manager, made.connection);
    let customers = catalog.table("SHOP", "CUSTOMERS").unwrap();
    let columns: Vec<(&str, &str, bool)> =
        customers.columns.iter().map(|c| (c.name.as_str(), c.type_written.as_str(), c.nullable)).collect();
    assert_eq!(columns, [("ID", "INTEGER", false), ("NAME", "CHARACTER VARYING(40)", false), ("BALANCE", "NUMERIC(38,2)", true)]);
    assert!(customers.constraints.iter().any(|c| c.kind == "UNIQUE" && c.name == "NAMED"));
    let orders = catalog.table("SALES", "ORDERS").unwrap();
    let foreign = orders.constraints.iter().find(|c| c.kind == "FOREIGN KEY").unwrap();
    assert_eq!(foreign.references.as_ref().map(|r| (r.table.as_str(), r.on_delete.as_str())), Some(("CUSTOMERS", "CASCADE")));
    assert!(orders.indexes.iter().any(|i| i.name == "ORDERS_AT"));
    manager.close(made.connection).unwrap();
    let missing = scratch.path("missing").with_extension("sql");
    assert!(manager.ddl_model(&missing, "SHOP").is_err());
    assert_eq!(manager.threads().len(), 0, "the in-memory database of a failed import is closed");
}
