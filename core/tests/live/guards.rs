//! The guards on what runs, against a live server (RULES.md D29, R-SEC-7,
//! R-SEC-8).

use turborel_studio_core::connections::manager::RunAnswer;
use turborel_studio_core::guard::classify::Class;
use turborel_studio_core::guard::policy::{Guards, READ_ONLY_REFUSAL};
use turborel_studio_core::saved::Environment;

use crate::connect::column;
use crate::{Live, no_environment, run};

/// [RULE] R-SEC-7 [DOC sql/statements/set-transaction.md DESCRIPTION] A
/// read-only connection begins each transaction READ ONLY, as the server
/// then tells, and refuses a write before it is sent.
pub fn a_read_only_connection_reads_alone(live: &Live) {
    let (manager, _) = live.manager();
    let guards = Guards { environment: Environment::Development, read_only: true };
    let id = manager.open((&live.spec(), guards), Some(&live.password()), no_environment).unwrap().connection;
    let ran = run(&manager, id, "VALUES (1)").unwrap();
    assert!(ran.session.transaction.read_only);
    let error = manager.run(id, "CREATE TABLE NEVER (A INTEGER)", true).unwrap_err();
    assert_eq!(error.sqlstate, READ_ONLY_REFUSAL);
    run(&manager, id, "ROLLBACK").unwrap();
    assert_eq!(column(&manager, id, "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'NEVER'"), [Some("0".to_owned())]);
    manager.close(id).unwrap();
}

/// [RULE] R-SEC-7: a production connection answers a write with what to
/// confirm, runs nothing until it is confirmed, and runs a read at once.
pub fn production_asks_before_a_write(live: &Live) {
    let (manager, _) = live.manager();
    let guards = Guards { environment: Environment::Production, read_only: false };
    let id = manager.open((&live.spec(), guards), Some(&live.password()), no_environment).unwrap().connection;
    assert!(matches!(manager.run(id, "VALUES (1)", false).unwrap(), RunAnswer::Ran(_)));
    let RunAnswer::Confirm(confirm) = manager.run(id, "CREATE TABLE PROD (A INTEGER)", false).unwrap() else { panic!("ran unconfirmed") };
    assert!(confirm.production);
    assert_eq!(confirm.class, Class::ChangeSchema);
    assert_eq!(column(&manager, id, "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'PROD'"), [Some("0".to_owned())]);
    assert!(matches!(manager.run(id, "CREATE TABLE PROD (A INTEGER)", true).unwrap(), RunAnswer::Ran(_)));
    run(&manager, id, "DROP TABLE PROD CASCADE").unwrap();
    run(&manager, id, "COMMIT").unwrap();
    manager.close(id).unwrap();
}

/// [RULE] R-SEC-8: a DROP asks first on any connection, and runs once
/// confirmed.
pub fn a_drop_asks_first(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    run(&manager, id, "CREATE TABLE GONE (A INTEGER)").unwrap();
    let RunAnswer::Confirm(confirm) = manager.run(id, "DROP TABLE GONE CASCADE", false).unwrap() else { panic!("dropped unconfirmed") };
    assert_eq!(confirm.destroys, ["DROP TABLE"]);
    assert!(!confirm.production);
    run(&manager, id, "DROP TABLE GONE CASCADE").unwrap();
    run(&manager, id, "ROLLBACK").unwrap();
    manager.close(id).unwrap();
}
