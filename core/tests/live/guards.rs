//! The guards on what runs, against a live server (RULES.md D29, R-SEC-7,
//! R-SEC-8).

use turborel_studio_core::connections::manager::RunAnswer;
use turborel_studio_core::connections::outcome::Outcome;
use turborel_studio_core::guard::classify::Class;
use turborel_studio_core::guard::policy::{Guards, READ_ONLY_REFUSAL};
use turborel_studio_core::saved::Environment;

use crate::connect::column;
use crate::{Live, no_environment, run};

/// [RULE] R-SEC-7 [DOC sql/statements/set-transaction.md DESCRIPTION] A
/// read-only connection begins each transaction READ ONLY, as the server
/// then tells, and refuses a write before it is sent, EXPLAIN ANALYZE of a
/// data change among them; plain EXPLAIN of one, which runs nothing, it
/// runs (D70).
pub fn a_read_only_connection_reads_alone(live: &Live) {
    let (manager, _) = live.manager();
    let owner = live.owner(&manager);
    manager.set_autocommit(owner, true).unwrap();
    run(&manager, owner, "CREATE TABLE RO_KEPT (A INTEGER)").unwrap();
    let guards = Guards { environment: Environment::Development, read_only: true };
    let id = manager.open((&live.spec(), guards), Some(&live.password()), no_environment).unwrap().connection;
    let ran = run(&manager, id, "VALUES (1)").unwrap();
    assert!(ran.session.transaction.read_only);
    // Plain EXPLAIN of a data change runs nothing (D70): run as a query is.
    let explained = run(&manager, id, "EXPLAIN DELETE FROM RO_KEPT WHERE A = 1").unwrap();
    assert!(matches!(explained.outcome, Outcome::Rows { .. }), "{:?}", explained.outcome);
    let error = manager.run(id, "CREATE TABLE NEVER (A INTEGER)", true).unwrap_err();
    assert_eq!(error.sqlstate, READ_ONLY_REFUSAL);
    // EXPLAIN ANALYZE of a data change runs it: a write, refused as one.
    let analyzed = manager.run(id, "EXPLAIN ANALYZE DELETE FROM INFORMATION_SCHEMA.TABLES WHERE 1 = 0", true).unwrap_err();
    assert_eq!(analyzed.sqlstate, READ_ONLY_REFUSAL);
    run(&manager, id, "ROLLBACK").unwrap();
    assert_eq!(column(&manager, id, "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'NEVER'"), [Some("0".to_owned())]);
    manager.close(id).unwrap();
    run(&manager, owner, "DROP TABLE RO_KEPT CASCADE").unwrap();
    manager.close(owner).unwrap();
}

/// [RULE] R-SEC-7: a production connection answers a write with what to
/// confirm, EXPLAIN ANALYZE of a data change among them, runs nothing
/// until it is confirmed, and runs a read at once, plain EXPLAIN of a
/// data change among them (D70).
pub fn production_asks_before_a_write(live: &Live) {
    let (manager, _) = live.manager();
    let guards = Guards { environment: Environment::Production, read_only: false };
    let id = manager.open((&live.spec(), guards), Some(&live.password()), no_environment).unwrap().connection;
    assert!(matches!(manager.run(id, "VALUES (1)", false).unwrap(), RunAnswer::Ran(_)));
    let RunAnswer::Confirm(confirm) = manager.run(id, "CREATE TABLE PROD (A INTEGER)", false).unwrap() else { panic!("ran unconfirmed") };
    assert!(confirm.production);
    assert_eq!(confirm.class, Class::ChangeSchema);
    let analyzed = manager.run(id, "EXPLAIN ANALYZE UPDATE PROD SET A = 1 WHERE A = 2", false).unwrap();
    let RunAnswer::Confirm(analyzed) = analyzed else { panic!("analyzed a write unconfirmed") };
    assert_eq!((analyzed.production, analyzed.class), (true, Class::WriteRows));
    assert_eq!(column(&manager, id, "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'PROD'"), [Some("0".to_owned())]);
    assert!(matches!(manager.run(id, "CREATE TABLE PROD (A INTEGER)", true).unwrap(), RunAnswer::Ran(_)));
    // Plain EXPLAIN of a data change runs nothing (D70): a read, run at once.
    let RunAnswer::Ran(explained) = manager.run(id, "EXPLAIN DELETE FROM PROD WHERE A = 1", false).unwrap() else {
        panic!("asked before explaining a change")
    };
    assert!(matches!(explained.outcome, Outcome::Rows { .. }), "{:?}", explained.outcome);
    run(&manager, id, "DROP TABLE PROD CASCADE").unwrap();
    run(&manager, id, "COMMIT").unwrap();
    manager.close(id).unwrap();
}

/// [RULE] R-SEC-8: a DROP, or EXPLAIN ANALYZE of a DELETE without WHERE,
/// asks first on any connection, and runs once confirmed.
pub fn a_drop_asks_first(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    run(&manager, id, "CREATE TABLE GONE (A INTEGER)").unwrap();
    let RunAnswer::Confirm(confirm) = manager.run(id, "DROP TABLE GONE CASCADE", false).unwrap() else { panic!("dropped unconfirmed") };
    assert_eq!(confirm.destroys, ["DROP TABLE"]);
    let RunAnswer::Confirm(every) = manager.run(id, "EXPLAIN ANALYZE DELETE FROM GONE", false).unwrap() else {
        panic!("deleted every row unconfirmed")
    };
    assert_eq!(every.destroys, ["DELETE of every row of GONE, with no WHERE"]);
    assert!(!confirm.production);
    run(&manager, id, "DROP TABLE GONE CASCADE").unwrap();
    run(&manager, id, "ROLLBACK").unwrap();
    manager.close(id).unwrap();
}
