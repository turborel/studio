//! Studio's embedded tests (RULES.md D59, R-TEST-7): the backend on
//! embedded databases in temporary directories, in Studio's own process,
//! as the user opens them. The program is its own harness, as the live
//! tests' is: it runs every test in turn, each in a directory of its own,
//! and removes them all. It needs no server, so it always runs.
//!
//! A test that needs another process holding a database runs this program
//! again, told by `CHILD` what to do (`child`): hold a database open until
//! its input ends, or write to one and wait to be killed.
//!
//! A test is a function `pub fn <name>(scratch: &Scratch)`, listed in
//! `TESTS`, its doc comment citing what it verifies (R-TRACE-1).

// A test program may assert, panic and print (R-TEST-4); being its own
// harness, it is not compiled as a test, so the workspace's allowances
// for tests are given here.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::print_stdout,
    clippy::arithmetic_side_effects,
    clippy::missing_panics_doc,
    clippy::panic_in_result_fn,
    reason = "a test program, whose failures are panics (R-TEST-4)"
)]

mod child;
mod files;
mod imports;
mod models;
mod opening;
mod requests;
mod scripts;

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use turborel_studio_core::connections::manager::{ConnectionManager, Opened, RunAnswer};
use turborel_studio_core::connections::outcome::Ran;
use turborel_studio_core::embedded::{EmbeddedSpec, Place};
use turborel_studio_core::error::StudioError;
use turborel_studio_core::events::{ConnectionId, EventSink, KeptEvents};
use turborel_studio_core::guard::policy::Guards;

/// The identifier the tests' databases are owned by.
pub const OWNER: &str = "TESTER";

/// What every embedded test is given: a directory of its own to work in.
pub struct Scratch {
    /// The directory, removed once the tests end.
    pub root: PathBuf,
    next: AtomicU32,
}

impl Scratch {
    /// A new directory's path, not made.
    pub fn path(&self, name: &str) -> PathBuf {
        let n = self.next.fetch_add(1, Ordering::Relaxed);
        self.root.join(format!("{name}-{n}"))
    }

    /// A manager whose results are spooled in the scratch directory.
    pub fn manager(&self) -> (ConnectionManager, Arc<KeptEvents>) {
        let events = Arc::new(KeptEvents::default());
        let spool = self.path("spool");
        std::fs::create_dir_all(&spool).unwrap();
        let sink: Arc<dyn EventSink> = events.clone();
        (ConnectionManager::new(spool, sink), events)
    }
}

/// What opens the database in `dir`, made if `create`, as `OWNER`.
pub fn spec(dir: &Path, create: bool) -> EmbeddedSpec {
    EmbeddedSpec {
        place: Place::Directory { path: dir.to_owned() },
        create,
        keys: None,
        checksum_key: None,
        plugin_directories: None,
        user: Some(OWNER.into()),
    }
}

/// Opens the database `spec` says with `manager`.
///
/// # Errors
///
/// Its opening's.
pub fn open(manager: &ConnectionManager, spec: &EmbeddedSpec) -> Result<Opened, StudioError> {
    manager.open_embedded(spec, Guards::default())
}

/// Runs `sql` on `id`, confirmed, and gives what it gave.
///
/// # Errors
///
/// The statement's failure.
pub fn run(manager: &ConnectionManager, id: ConnectionId, sql: &str) -> Result<Ran, StudioError> {
    match manager.run(id, sql, true)? {
        RunAnswer::Ran(ran) => Ok(*ran),
        RunAnswer::Confirm(confirm) => panic!("{sql} asked to confirm, confirmed: {confirm:?}"),
    }
}

/// An embedded test.
type Test = fn(&Scratch);

/// Every embedded test, by name.
const TESTS: &[(&str, Test)] = &[
    ("a_new_database_is_made_and_opened_again", opening::a_new_database_is_made_and_opened_again),
    ("what_is_no_database_is_not_opened", opening::what_is_no_database_is_not_opened),
    ("a_database_another_process_holds_is_refused", opening::a_database_another_process_holds_is_refused),
    ("closing_writes_a_checkpoint", opening::closing_writes_a_checkpoint),
    ("a_killed_process_is_recovered", opening::a_killed_process_is_recovered),
    ("an_in_memory_database_is_not_saved", opening::an_in_memory_database_is_not_saved),
    ("plug_ins_are_listed", opening::plug_ins_are_listed),
    ("the_assistant_opens_a_session_beside_the_users", opening::the_assistant_opens_a_session_beside_the_users),
    ("a_query_is_paged_through_its_cursor", requests::a_query_is_paged_through_its_cursor),
    ("parameters_and_large_objects", requests::parameters_and_large_objects),
    ("the_transaction_is_followed", requests::the_transaction_is_followed),
    ("rows_are_exported_and_imported", requests::rows_are_exported_and_imported),
    ("large_objects_are_exported_as_their_values", requests::large_objects_are_exported_as_their_values),
    ("the_catalog_and_plans_are_read", requests::the_catalog_and_plans_are_read),
    ("settings_change_as_on_a_server", requests::settings_change_as_on_a_server),
    ("each_database_has_a_named_worker", requests::each_database_has_a_named_worker),
    ("read_only_runs_and_a_procedures_outputs", requests::read_only_runs_and_a_procedures_outputs),
    ("refusals_are_told_and_an_open_transaction_undone", requests::refusals_are_told_and_an_open_transaction_undone),
    ("an_analyzed_change_is_rolled_back", requests::an_analyzed_change_is_rolled_back),
    ("a_38_digit_number_round_trips", requests::a_38_digit_number_round_trips),
    ("a_sheet_is_read_by_rows", imports::a_sheet_is_read_by_rows),
    ("a_ddl_script_becomes_a_model", models::a_ddl_script_becomes_a_model),
    ("a_script_with_its_data_round_trips", scripts::a_script_with_its_data_round_trips),
    ("each_format_is_imported", imports::each_format_is_imported),
    ("an_import_is_limited_and_cancelled", imports::an_import_is_limited_and_cancelled),
    ("a_file_runs_by_its_transactions_and_error_policy", files::a_file_runs_by_its_transactions_and_error_policy),
    ("a_file_leaves_autocommit_as_it_was", files::a_file_leaves_autocommit_as_it_was),
    ("a_file_is_judged_whole_by_the_guards", files::a_file_is_judged_whole_by_the_guards),
    ("a_file_tells_its_progress_and_is_cancelled", files::a_file_tells_its_progress_and_is_cancelled),
];

fn main() -> ExitCode {
    if let Some(code) = child::run_if_asked() {
        return code;
    }
    let filter = std::env::args().skip(1).find(|a| !a.starts_with('-'));
    let root = std::env::temp_dir().join(format!("studio-embedded-tests-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let scratch = Scratch { root, next: AtomicU32::new(0) };
    let mut failed = Vec::new();
    for (name, test) in TESTS.iter().filter(|(name, _)| filter.as_deref().is_none_or(|f| name.contains(f))) {
        let passed = catch_unwind(AssertUnwindSafe(|| test(&scratch))).is_ok();
        println!("embedded {name} ... {}", if passed { "ok" } else { "FAILED" });
        if !passed {
            failed.push(*name);
        }
    }
    let _ = std::fs::remove_dir_all(&scratch.root); // A directory left behind in temp is no failure.
    println!("embedded: {} failed: {failed:?}", failed.len());
    if failed.is_empty() { ExitCode::SUCCESS } else { ExitCode::FAILURE }
}
