//! The classifier against a corpus of statements, each written as people
//! and attackers write them: in any case, across lines, with comments,
//! quoted names, several to a script.

use super::{Class, classify, classify_script, strictest};

/// Each statement of the corpus, and the class it must have.
const CLASSES: &[(&str, Class)] = &[
    ("SELECT * FROM STAFF", Class::Read),
    ("select name from staff where id = 1", Class::Read),
    ("VALUES (1)", Class::Read),
    ("WITH T(N) AS (VALUES (1)) SELECT N FROM T", Class::Read),
    ("TABLE STAFF", Class::Read),
    ("SELECT * FROM FINAL TABLE (INSERT INTO STAFF (NAME) VALUES ('A'))", Class::WriteRows),
    ("COMMIT", Class::Transaction),
    ("ROLLBACK", Class::Transaction),
    ("SAVEPOINT S1", Class::Transaction),
    ("SET TRANSACTION READ ONLY", Class::Transaction),
    ("SET SCHEMA 'ANN'", Class::Session),
    ("SET TIME ZONE LOCAL", Class::Session),
    ("INSERT INTO STAFF (NAME) VALUES ('Ada')", Class::WriteRows),
    ("UPDATE STAFF SET NAME = 'B' WHERE ID = 1", Class::WriteRows),
    ("DELETE FROM STAFF WHERE ID = 1", Class::WriteRows),
    ("MERGE INTO STAFF S USING (VALUES (1)) AS V(ID) ON S.ID = V.ID WHEN MATCHED THEN DELETE", Class::WriteRows),
    ("CREATE TABLE T (A INTEGER)", Class::ChangeSchema),
    ("ALTER TABLE T ADD COLUMN B INTEGER", Class::ChangeSchema),
    ("CREATE INDEX I ON T (A)", Class::ChangeSchema),
    ("CREATE VIEW V AS SELECT A FROM T", Class::ChangeSchema),
    ("GRANT SELECT ON T TO BOB", Class::Security),
    ("REVOKE SELECT ON T FROM BOB CASCADE", Class::Security),
    ("CREATE USER BOB PASSWORD 'x'", Class::Security),
    ("SET SESSION AUTHORIZATION 'BOB'", Class::Security),
    ("SET DATABASE SERVER.LOGIN_DELAY_MS = 0", Class::Administration),
    ("END CONNECTION 7", Class::Administration),
    ("CALL P()", Class::Unclassified),
    ("EXECUTE IMMEDIATE 'DROP TABLE T CASCADE'", Class::Unclassified),
    ("PREPARE S FROM 'DELETE FROM T'", Class::Unclassified),
    ("BEGIN DELETE FROM T; END", Class::Unclassified),
    ("NOT SQL AT ALL", Class::Unclassified),
    ("SELECT * FROM T; DROP TABLE T CASCADE", Class::Unclassified),
    ("RELEASE SAVEPOINT S1", Class::Transaction),
    ("SET CONSTRAINTS ALL DEFERRED", Class::Transaction),
    ("SET CATALOG 'TURBOREL'", Class::Session),
    ("SET ROLE 'CLERK'", Class::Session),
    ("CREATE SEQUENCE ORDER_NO START WITH 1000", Class::ChangeSchema),
    ("CREATE DOMAIN MONEY AS DECIMAL(9,2) DEFAULT 0 CONSTRAINT NOT_NEGATIVE CHECK (VALUE >= 0)", Class::ChangeSchema),
    ("CREATE ASSERTION BALANCED CHECK (NOT EXISTS (SELECT * FROM LEDGER WHERE AMOUNT > 1000))", Class::ChangeSchema),
    ("CREATE FUNCTION DOUBLED (N INTEGER) RETURNS INTEGER DETERMINISTIC CONTAINS SQL RETURN N * 2", Class::ChangeSchema),
    ("CREATE TYPE MONEY AS DECIMAL(10,2)", Class::ChangeSchema),
    ("CREATE VIEW PAYROLL (DEPT, TOTAL) AS SELECT DEPT, SUM(SALARY) FROM STAFF GROUP BY DEPT", Class::ChangeSchema),
    ("ALTER INDEX STAFF_NAME SET (FILL = 50)", Class::ChangeSchema),
    ("DECLARE LOCAL TEMPORARY TABLE MODULE.SCRATCH (K INTEGER, V VARCHAR(10)) ON COMMIT PRESERVE ROWS", Class::ChangeSchema),
    ("CREATE ROLE CLERK", Class::Security),
    ("CREATE RESTORE POINT before_migration", Class::Administration),
    ("CREATE EXTENSION EXAMPLE", Class::Administration),
    ("CANCEL CONNECTION 2", Class::Administration),
    ("EXECUTE GQL ON GRAPH NET 'MATCH (p) RETURN p'", Class::Unclassified),
    ("EXPLAIN SELECT * FROM STAFF", Class::Read),
    ("explain analyze select * from staff", Class::Read),
    ("EXPLAIN ANALYZE (SELECT ID FROM PARTS) FETCH FIRST 3 ROWS ONLY", Class::Read),
    ("EXPLAIN ANALYZE SELECT * FROM FINAL TABLE (INSERT INTO STAFF (NAME) VALUES ('A'))", Class::WriteRows),
    ("EXPLAIN DELETE FROM STAFF", Class::Read),
    ("EXPLAIN UPDATE STAFF SET NAME = 'Ada' WHERE ID = 1", Class::Read),
    ("explain insert into STAFF (NAME) values ('Ada')", Class::Read),
    ("EXPLAIN MERGE INTO STAFF S USING (VALUES (1)) AS V(ID) ON S.ID = V.ID WHEN MATCHED THEN DELETE", Class::Read),
    ("EXPLAIN DELETE STAFF", Class::Unclassified),
    ("EXPLAIN ANALYZE INSERT INTO STAFF (NAME) VALUES ('Ada')", Class::WriteRows),
    ("explain analyze update staff set name = 'B' where id = 1", Class::WriteRows),
    ("EXPLAIN ANALYZE DELETE FROM STAFF WHERE ID = 1", Class::WriteRows),
    ("EXPLAIN ANALYZE MERGE INTO STAFF S USING (VALUES (1)) AS V(ID) ON S.ID = V.ID WHEN MATCHED THEN DELETE", Class::WriteRows),
    ("EXPLAIN\n  -- runs it for real\n  ANALYZE UPDATE OFFERS SET PRICE = PRICE + 1 WHERE PRICE <= 50", Class::WriteRows),
    ("EXPLAIN ANALYZE", Class::Unclassified),
    ("EXPLAIN", Class::Unclassified),
    ("SELECT NAME FROM STAFF WHERE ID = ?", Class::Read),
    ("INSERT INTO STAFF (ID, NAME) VALUES (?, ?)", Class::WriteRows),
    ("DELETE FROM STAFF WHERE ID = ?", Class::WriteRows),
];

/// [RULE] R-SEC-8 [DESIGN] D29 [DOC sql/statements/explain.md EXPLAIN ANALYZE]: each
/// statement of the corpus has its class, EXPLAIN and EXPLAIN ANALYZE of a
/// query its query's, EXPLAIN ANALYZE of a data change the change's, as it
/// runs the change for real.
#[test]
fn each_statement_has_its_class() {
    for (sql, class) in CLASSES {
        assert_eq!(classify(sql).class, *class, "{sql}");
    }
}

/// Statements that destroy, and what each destroys.
const DESTROYS: &[(&str, &str)] = &[
    ("DROP TABLE STAFF CASCADE", "DROP TABLE"),
    ("drop table staff restrict", "DROP TABLE"),
    ("DROP VIEW V CASCADE", "DROP VIEW"),
    ("DROP SCHEMA ANN CASCADE", "DROP SCHEMA"),
    ("DROP INDEX I", "DROP INDEX"),
    ("TRUNCATE TABLE STAFF", "TRUNCATE TABLE STAFF"),
    ("DELETE FROM STAFF", "DELETE of every row of STAFF, with no WHERE"),
    ("UPDATE STAFF SET NAME = 'x'", "UPDATE of every row of STAFF, with no WHERE"),
    ("DELETE\nFROM\n  \"staff\"", "DELETE of every row of staff, with no WHERE"),
    ("/* a comment */ DELETE FROM STAFF -- and another", "DELETE of every row of STAFF, with no WHERE"),
    ("DROP DOMAIN MONEY RESTRICT", "DROP DOMAIN"),
    ("DROP SEQUENCE S RESTRICT", "DROP SEQUENCE"),
    ("DROP EXTENSION EXAMPLE", "DROP EXTENSION"),
    ("EXPLAIN ANALYZE DELETE FROM STAFF", "DELETE of every row of STAFF, with no WHERE"),
    ("explain analyze update staff set name = 'x'", "UPDATE of every row of STAFF, with no WHERE"),
];

/// [RULE] R-SEC-8: every DROP, TRUNCATE, and DELETE or UPDATE without WHERE
/// is known to destroy, however it is written.
#[test]
fn every_destroying_statement_is_known() {
    for (sql, destroys) in DESTROYS {
        assert_eq!(classify(sql).destroys.as_deref(), Some(*destroys), "{sql}");
    }
    for sql in ["DELETE FROM STAFF WHERE ID = 1", "UPDATE STAFF SET NAME = 'x' WHERE ID = 1", "SELECT * FROM STAFF"] {
        assert_eq!(classify(sql).destroys, None, "{sql}");
    }
}

/// Statements the hard floor holds: the assistant can never run them.
const FLOOR: &[&str] = &[
    "DROP TABLE STAFF CASCADE",
    "DROP SCHEMA ANN CASCADE",
    "TRUNCATE TABLE STAFF",
    "DELETE FROM STAFF",
    "UPDATE STAFF SET NAME = 'x'",
    "EXPLAIN ANALYZE DELETE FROM STAFF",
    "EXPLAIN ANALYZE UPDATE STAFF SET NAME = 'x'",
    "CREATE USER BOB PASSWORD 'x'",
    "DROP USER BOB",
    "GRANT SELECT ON STAFF TO BOB",
    "REVOKE SELECT ON STAFF FROM BOB CASCADE",
    "SET SESSION AUTHORIZATION 'BOB'",
    "END CONNECTION 7",
    "ALTER DATABASE OWNER TO BOB",
    "CREATE ROLE CLERK",
    "CREATE RESTORE POINT before_migration",
    "CREATE EXTENSION EXAMPLE",
    "DROP EXTENSION EXAMPLE",
    "CANCEL CONNECTION 2",
];

/// [DESIGN] D29: each statement of the hard floor is held by it.
#[test]
fn the_floor_holds_its_statements() {
    for sql in FLOOR {
        assert!(classify(sql).floor.is_some(), "{sql}");
    }
    assert_eq!(classify("DELETE FROM STAFF WHERE ID = 1").floor, None);
}

/// [DESIGN] D29: a script smuggling a write after a read is as strict as
/// its strictest statement, however it is split across lines.
#[test]
fn a_script_is_as_strict_as_its_strictest_statement() {
    let script = "SELECT 1 FROM T;\n-- harmless?\nselect 2 from t ;  DROP\nTABLE t CASCADE;";
    let statements = classify_script(script);
    assert_eq!(statements.len(), 3);
    assert_eq!(strictest(&statements), Class::ChangeSchema);
    assert_eq!(statements[2].destroys.as_deref(), Some("DROP TABLE"));
    assert_eq!(strictest(&classify_script("")), Class::Read);
}

/// [DESIGN] D29: a SET TRANSACTION that makes the next READ WRITE is known.
#[test]
fn read_write_is_known() {
    assert!(classify("SET TRANSACTION READ WRITE").read_write);
    assert!(classify("set transaction isolation level serializable, read write").read_write);
    assert!(!classify("SET TRANSACTION READ ONLY").read_write);
}
