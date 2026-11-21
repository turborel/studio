//! `.sql` files run without the editor (RULES.md D62), on an embedded
//! database: their transactions, their failures stopped at or logged,
//! the guards asked once of the whole file, progress told, and cancel.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use turborel_studio_core::connections::manager::ConnectionManager;
use turborel_studio_core::connections::manager::sqlfile::{Ending, FileAnswer, FileOptions, FileReport, Transactions};
use turborel_studio_core::connections::outcome::Outcome;
use turborel_studio_core::events::{ConnectionId, Event};
use turborel_studio_core::guard::policy::Guards;
use turborel_studio_core::saved::Environment;

use crate::{Scratch, open, run, spec};

/// A file of `text` in the scratch directory.
fn file(scratch: &Scratch, text: &str) -> PathBuf {
    let path = scratch.path("script").with_extension("sql");
    std::fs::write(&path, text).unwrap();
    path
}

/// A connection to a new database holding the table T (N INTEGER PRIMARY KEY).
fn with_table(scratch: &Scratch, manager: &ConnectionManager) -> ConnectionId {
    let id = open(manager, &spec(&scratch.path("db"), true)).unwrap().connection;
    manager.set_autocommit(id, true).unwrap();
    run(manager, id, "CREATE TABLE T (N INTEGER PRIMARY KEY)").unwrap();
    id
}

/// The values of T, in order, the table emptied after.
fn emptied(manager: &ConnectionManager, id: ConnectionId) -> Vec<String> {
    let Outcome::Rows { result, page, .. } = run(manager, id, "SELECT N FROM T ORDER BY N").unwrap().outcome else { panic!("no rows") };
    let _ = manager.close_result(id, result);
    run(manager, id, "DELETE FROM T WHERE N > 0").unwrap();
    page.rows.into_iter().map(|r| r[0].clone().unwrap()).collect()
}

/// What `path` did on `id`, run as `options` say, confirmed.
fn ran(manager: &ConnectionManager, id: ConnectionId, path: &Path, options: FileOptions) -> FileReport {
    match manager.run_file(id, path, options, true).unwrap() {
        FileAnswer::Ran { report } => report,
        FileAnswer::Confirm { confirm, .. } => panic!("asked again: {confirm:?}"),
    }
}

/// [DESIGN] D62 [DOC user/10-errors.md SQLCODE and SQLSTATE]: a file runs
/// in one transaction, a commit every so many statements, or each its
/// own; it stops at the first failure, what ran since the last commit
/// rolled back, or logs each failure by its line and SQLSTATE and goes
/// on, a statement that fails undone alone.
pub fn a_file_runs_by_its_transactions_and_error_policy(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let id = with_table(scratch, &manager);
    let path = file(
        scratch,
        "INSERT INTO T VALUES (1);\nINSERT INTO T VALUES (2);\n-- a duplicate\nINSERT INTO T VALUES (1);\nSELECT * FROM T;\nINSERT INTO T VALUES (3);\n",
    );
    let options = |transactions, stop_on_error| FileOptions { transactions, stop_on_error };
    let whole = ran(&manager, id, &path, options(Transactions::Whole, true));
    assert_eq!((whole.ending, whole.statements, whole.failed, whole.rolled_back), (Ending::Stopped, 3, 1, true));
    assert_eq!((whole.log[0].line, whole.log[0].number, whole.log[0].sqlstate.as_str()), (4, 3, "23000"));
    assert_eq!(whole.log[0].statement, "INSERT INTO T VALUES (1)");
    assert_eq!(emptied(&manager, id), Vec::<String>::new());
    let going_on = ran(&manager, id, &path, options(Transactions::Whole, false));
    assert_eq!((going_on.ending, going_on.statements, going_on.failed, going_on.rows_affected), (Ending::Finished, 5, 1, 3));
    assert_eq!(emptied(&manager, id), ["1", "2", "3"]);
    let every = ran(&manager, id, &path, options(Transactions::Every(1), true));
    assert_eq!((every.ending, every.rolled_back), (Ending::Stopped, false));
    assert_eq!(emptied(&manager, id), ["1", "2"]);
    let every_two = ran(&manager, id, &path, options(Transactions::Every(2), false));
    assert_eq!(every_two.ending, Ending::Finished);
    assert_eq!(emptied(&manager, id), ["1", "2", "3"]);
    let auto = ran(&manager, id, &path, options(Transactions::Autocommit, true));
    assert_eq!((auto.ending, auto.rolled_back), (Ending::Stopped, false));
    assert_eq!(emptied(&manager, id), ["1", "2"]);
    manager.close(id).unwrap();
}

/// [DESIGN] D62: a file leaves the session's autocommit as it was, and
/// runs only when no transaction of the session is open.
pub fn a_file_leaves_autocommit_as_it_was(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let id = with_table(scratch, &manager);
    let path = file(scratch, "INSERT INTO T VALUES (1);\nINSERT INTO T VALUES (1);\n");
    let options = |transactions, stop_on_error| FileOptions { transactions, stop_on_error };
    ran(&manager, id, &path, options(Transactions::Whole, true));
    assert!(manager.session(id).unwrap().transaction.autocommit);
    manager.set_autocommit(id, false).unwrap();
    ran(&manager, id, &path, options(Transactions::Autocommit, false));
    assert!(!manager.session(id).unwrap().transaction.autocommit);
    run(&manager, id, "INSERT INTO T VALUES (9)").unwrap();
    let open = manager.run_file(id, &path, options(Transactions::Whole, false), true).unwrap_err();
    assert!(open.message.contains("transaction is open"), "{open}");
    manager.close(id).unwrap();
}

/// [RULE] R-SEC-8 [DESIGN] D62: the guards are asked once of the whole
/// file, by its scan, before any statement runs; confirmed, it runs. A
/// read-only connection refuses a file that writes; production asks of
/// any write.
pub fn a_file_is_judged_whole_by_the_guards(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let id = with_table(scratch, &manager);
    let path = file(scratch, "INSERT INTO T VALUES (1);\nDELETE FROM T;\nINSERT INTO T VALUES (2);");
    let options = FileOptions { transactions: Transactions::Autocommit, stop_on_error: true };
    let FileAnswer::Confirm { confirm, scan } = manager.run_file(id, &path, options, false).unwrap() else { panic!("not asked") };
    assert_eq!(confirm.destroys, ["line 2: DELETE of every row of T, with no WHERE"]);
    assert_eq!(scan.statements, 3);
    assert_eq!(emptied(&manager, id), Vec::<String>::new());
    assert_eq!(ran(&manager, id, &path, options).ending, Ending::Finished);
    assert_eq!(emptied(&manager, id), ["2"]);
    manager.close(id).unwrap();
    let dir = scratch.path("guarded");
    let made = open(&manager, &spec(&dir, true)).unwrap().connection;
    manager.close(made).unwrap();
    let read_only = manager.open_embedded(&spec(&dir, false), Guards { environment: Environment::Development, read_only: true }).unwrap();
    let refused = manager.run_file(read_only.connection, &path, options, true).unwrap_err();
    assert_eq!(refused.sqlstate, "25006");
    let reads = file(scratch, "VALUES (1);");
    assert_eq!(ran(&manager, read_only.connection, &reads, options).ending, Ending::Finished);
    manager.close(read_only.connection).unwrap();
    let production = manager.open_embedded(&spec(&dir, false), Guards { environment: Environment::Production, read_only: false }).unwrap();
    let inserts = file(scratch, "CREATE TABLE U (A INTEGER);");
    assert!(
        matches!(manager.run_file(production.connection, &inserts, options, false).unwrap(), FileAnswer::Confirm { confirm, .. } if confirm.production)
    );
    manager.close(production.connection).unwrap();
}

/// [DESIGN] D62: a run tells its progress as it goes, the last of it at
/// its end; cancelled, it runs no statement after the one running.
pub fn a_file_tells_its_progress_and_is_cancelled(scratch: &Scratch) {
    let (manager, events) = scratch.manager();
    let id = with_table(scratch, &manager);
    let count = 3000;
    let text = (1..=count).fold(String::new(), |mut text, n| {
        let _ = writeln!(text, "INSERT INTO T VALUES ({n});"); // Writing to a String cannot fail.
        text
    });
    let path = file(scratch, &text);
    let options = FileOptions { transactions: Transactions::Every(500), stop_on_error: true };
    let report = ran(&manager, id, &path, options);
    assert_eq!((report.statements, report.rows_affected), (count, count));
    let told: Vec<_> =
        events.take().into_iter().filter_map(|e| if let Event::SqlFile { progress, .. } = e { Some(progress) } else { None }).collect();
    let last = told.last().unwrap();
    assert_eq!((last.statements, last.bytes, last.total), (count, u64::try_from(text.len()).unwrap(), u64::try_from(text.len()).unwrap()));
    emptied(&manager, id);
    let long =
        "WITH RECURSIVE R(N) AS (VALUES (CAST(1 AS BIGINT)) UNION ALL SELECT N + 1 FROM R WHERE N < 1000000000) SELECT COUNT(*) FROM R;\n";
    let slow = file(scratch, &format!("INSERT INTO T VALUES (1);\n{}INSERT INTO T VALUES (2);\n", long.repeat(3)));
    let report = std::thread::scope(|scope| {
        let running = scope.spawn(|| ran(&manager, id, &slow, FileOptions { transactions: Transactions::Whole, stop_on_error: false }));
        while !running.is_finished() {
            let _ = manager.cancel_file(id); // None runs until the run begins.
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        running.join().unwrap()
    });
    assert_eq!(report.ending, Ending::Cancelled);
    assert!(report.rolled_back);
    assert!(report.statements < 5, "{report:?}");
    assert_eq!(emptied(&manager, id), Vec::<String>::new());
    assert!(manager.cancel_file(id).unwrap_err().message.contains("no file runs"));
    manager.close(id).unwrap();
}
