//! A connection's session: cancel, transactions, loss and reconnection,
//! and the manager's workers (`[CLIENT Running statements]`).

use turborel_studio_core::connections::manager::{ConnectionManager, WORKER_PREFIX};
use turborel_studio_core::connections::outcome::{Outcome, ResultId};
use turborel_studio_core::connections::spec::ConnectionSpec;
use turborel_studio_core::error::StudioError;
use turborel_studio_core::events::{ConnectionId, Event};
use turborel_studio_core::guard::policy::Guards;

use crate::connect::column;
use crate::{Live, no_environment};

/// A query that runs long enough to be cancelled.
const LONG: &str =
    "WITH RECURSIVE T(N) AS (VALUES (CAST(1 AS BIGINT)) UNION ALL SELECT N + 1 FROM T WHERE N < 1000000000) SELECT COUNT(*) FROM T";
/// The SQLCODE of a statement cancelled.
const CANCELLED: i32 = -920;
/// How many times the test asks to cancel before it gives up.
const CANCEL_TRIES: u32 = 600;

/// `sql` run on connection `id`, cancelled from another thread through
/// the canceller until it fails; its failure.
fn cancelled(manager: &ConnectionManager, id: ConnectionId, sql: &str) -> StudioError {
    std::thread::scope(|scope| {
        let running = scope.spawn(|| crate::run(manager, id, sql));
        let mut tries = 0;
        while !running.is_finished() && tries < CANCEL_TRIES {
            manager.cancel(id).unwrap();
            tries += 1;
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        running.join().unwrap().unwrap_err()
    })
}

/// [CLIENT Running statements] A statement running is cancelled from
/// another thread through the canceller, and fails as cancelled.
pub fn a_running_statement_is_cancelled(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    let error = cancelled(&manager, id, LONG);
    assert_eq!(error.sqlcode, CANCELLED, "{error}");
    assert_eq!(column(&manager, id, "VALUES (1)"), [Some("1".to_owned())]);
    manager.close(id).unwrap();
}

/// The result `sql` gave on connection `id`, closed.
fn result_of(manager: &ConnectionManager, id: ConnectionId, sql: &str) -> ResultId {
    let Outcome::Rows { result, .. } = crate::run(manager, id, sql).unwrap().outcome else { panic!("no rows") };
    manager.close_result(id, result).unwrap();
    result
}

/// [CLIENT Running statements] [DESIGN] D25: a query that fails, or is
/// cancelled, in its first fetch is answered by its failure alone, so the
/// worksheet shows the error and no result, not even its columns.
pub fn a_query_failed_before_its_rows_is_its_error_alone(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    let first = result_of(&manager, id, "VALUES (1)");
    assert_eq!(cancelled(&manager, id, LONG).sqlcode, CANCELLED);
    let error = crate::run(&manager, id, "SELECT 1 / (N - 1) FROM (VALUES (1)) AS T(N)").unwrap_err();
    assert_eq!(error.sqlstate, "22012", "{error}");
    assert_eq!(result_of(&manager, id, "VALUES (2)"), first + 1, "a failed query kept no result");
    assert!(!manager.session(id).unwrap().lost);
    manager.close(id).unwrap();
}

/// [CLIENT Running statements] Without autocommit a change begins a
/// transaction, which the session shows until ROLLBACK ends it; with it,
/// each statement is its own.
pub fn the_transaction_is_followed(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    crate::run(&manager, id, "CREATE TABLE T1 (A INTEGER)").unwrap();
    assert!(!manager.set_autocommit(id, false).unwrap().transaction.autocommit);
    let ran = crate::run(&manager, id, "INSERT INTO T1 VALUES (1)").unwrap();
    assert!(ran.session.transaction.active);
    assert!(!crate::run(&manager, id, "ROLLBACK").unwrap().session.transaction.active);
    manager.set_autocommit(id, true).unwrap();
    assert_eq!(column(&manager, id, "SELECT COUNT(*) FROM T1"), [Some("0".to_owned())]);
    crate::run(&manager, id, "DROP TABLE T1 CASCADE").unwrap();
    manager.close(id).unwrap();
}

/// [CLIENT Connecting] [DOC sql/statements/end-connection.md DESCRIPTION]
/// A connection the server ends is told lost, once, and connected again by
/// the settings it was made by.
pub fn a_lost_connection_is_told_and_reconnected(live: &Live) {
    let (manager, events) = live.manager();
    let operator = live.owner(&manager);
    let uri = Some("turborel://localhost/?application_name=victim".to_owned());
    let spec = ConnectionSpec { uri, ..live.spec() };
    let victim = manager.open((&spec, Guards::default()), Some(&live.password()), no_environment).unwrap().connection;
    let ids = column(&manager, operator, "SELECT ID FROM INFORMATION_SCHEMA.CONNECTIONS WHERE APPLICATION = 'victim'");
    let [Some(server_id)] = ids.as_slice() else { panic!("{ids:?}") };
    crate::run(&manager, operator, &format!("END CONNECTION {server_id}")).unwrap();
    let error = crate::run(&manager, victim, "VALUES (1)").unwrap_err();
    assert!(error.ends_connection(), "{error}");
    let lost: Vec<_> = events.take().into_iter().filter(|e| matches!(e, Event::Lost { connection, .. } if *connection == victim)).collect();
    assert_eq!(lost.len(), 1);
    assert!(manager.session(victim).unwrap().lost);
    assert!(!manager.reconnect(victim).unwrap().lost);
    assert_eq!(column(&manager, victim, "VALUES (1)"), [Some("1".to_owned())]);
    manager.close(victim).unwrap();
    manager.close(operator).unwrap();
}

/// [RULE] R-SAFE-5: each connection's worker is named and held by the
/// manager, and none is left once the connections are closed.
pub fn each_connection_has_a_named_worker(live: &Live) {
    let (manager, _) = live.manager();
    let (a, b) = (live.owner(&manager), live.owner(&manager));
    let names: Vec<String> = manager.threads().into_iter().map(|t| t.name).collect();
    assert_eq!(names, [format!("{WORKER_PREFIX}{a}"), format!("{WORKER_PREFIX}{b}")]);
    manager.close(a).unwrap();
    drop(manager);
    let (manager, _) = live.manager();
    assert_eq!(manager.threads(), []);
}

/// [CLIENT Controlling the session] Ping asks whether the server answers.
pub fn ping_answers(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.ping(id).unwrap();
    manager.close(id).unwrap();
    assert_eq!(manager.ping(id).unwrap_err().sqlstate, "TB910");
}
