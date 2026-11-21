//! Studio's live tests (RULES.md R-TEST-7, R-TEST-8): the backend against a
//! real server. The program is its own harness: it starts the server
//! `TURBOREL_TEST_SERVER` names once, runs every test, each in turn, and
//! stops the server, so nothing is left running whatever fails. With no
//! server named, or the variable empty, as CI sets it where it has none,
//! every test is skipped.
//!
//! A test is a function `pub fn <name>(live: &Live)`, listed in `TESTS`,
//! its doc comment citing what it verifies (R-TRACE-1).

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

mod analyzer;
mod catalog;
mod certs;
mod connect;
mod data;
mod guards;
mod server;
mod session;
mod statements;

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;

use turborel_studio_core::connections::manager::{ConnectionManager, RunAnswer};
use turborel_studio_core::connections::outcome::Ran;
use turborel_studio_core::connections::spec::ConnectionSpec;
use turborel_studio_core::error::StudioError;
use turborel_studio_core::events::{ConnectionId, EventSink, KeptEvents};
use turborel_studio_core::guard::policy::Guards;
use turborel_studio_core::secret::Secret;

use crate::server::{OWNER, OWNER_PASSWORD, PORT, SERVER_VARIABLE, Server};

/// What every live test is given: the running server.
pub struct Live {
    /// The server.
    pub server: Server,
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

/// No environment: a test's settings are its own alone.
pub fn no_environment(_: &str) -> Option<String> {
    None
}

impl Live {
    /// Settings that reach the server over TLS, verified by the tests'
    /// authority, as the owner.
    pub fn spec(&self) -> ConnectionSpec {
        ConnectionSpec {
            host: Some("localhost".into()),
            port: Some(PORT.to_string()),
            user: Some(OWNER.into()),
            tls_mode: Some("verify-full".into()),
            tls_roots: Some(self.server.certs.authority.display().to_string()),
            ..ConnectionSpec::default()
        }
    }

    /// A manager whose results are spooled in the server's directory, and
    /// the events it tells.
    pub fn manager(&self) -> (ConnectionManager, Arc<KeptEvents>) {
        let events = Arc::new(KeptEvents::default());
        let spool: PathBuf = self.server.dir.join("spool");
        std::fs::create_dir_all(&spool).unwrap();
        let sink: Arc<dyn EventSink> = events.clone();
        (ConnectionManager::new(spool, sink), events)
    }

    /// The owner's password.
    pub fn password(&self) -> Secret {
        Secret::new(OWNER_PASSWORD)
    }

    /// Makes the owner's schema, where the tests' tables are made.
    pub fn prepare(&self) {
        let (manager, _) = self.manager();
        let id = self.owner(&manager);
        run(&manager, id, &format!("CREATE SCHEMA AUTHORIZATION {OWNER}")).unwrap();
        run(&manager, id, "COMMIT").unwrap();
        manager.close(id).unwrap();
    }

    /// A connection of `manager`'s, the owner's over TLS.
    pub fn owner(&self, manager: &ConnectionManager) -> ConnectionId {
        manager.open((&self.spec(), Guards::default()), Some(&self.password()), no_environment).unwrap().connection
    }
}

/// A live test.
type Test = fn(&Live);

/// Every live test, by name.
const TESTS: &[(&str, Test)] = &[
    ("connect_over_tls_by_scram", connect::connect_over_tls_by_scram),
    ("an_untrusted_certificate_is_refused", connect::an_untrusted_certificate_is_refused),
    ("a_password_is_refused_over_plain_tcp", connect::a_password_is_refused_over_plain_tcp),
    ("a_local_socket_is_trusted", connect::a_local_socket_is_trusted),
    ("connect_by_uri", connect::connect_by_uri),
    ("connect_by_service_file", connect::connect_by_service_file),
    ("connect_by_password_file", connect::connect_by_password_file),
    ("connect_by_certificate", connect::connect_by_certificate),
    ("the_next_host_is_tried", connect::the_next_host_is_tried),
    ("the_application_is_named", connect::the_application_is_named),
    ("a_query_is_paged_through_its_cursor", statements::a_query_is_paged_through_its_cursor),
    ("declared_types_are_shown", statements::declared_types_are_shown),
    ("a_change_tells_its_rows_and_generated_values", statements::a_change_tells_its_rows_and_generated_values),
    ("a_failure_is_kept_whole", statements::a_failure_is_kept_whole),
    ("warnings_come_with_the_outcome", statements::warnings_come_with_the_outcome),
    ("a_statement_not_preparable_runs_directly", statements::a_statement_not_preparable_runs_directly),
    ("a_cursor_fails_or_closes_early", statements::a_cursor_fails_or_closes_early),
    ("parameters_are_given_values_as_text", statements::parameters_are_given_values_as_text),
    ("a_plan_is_explained_and_analyzed", statements::a_plan_is_explained_and_analyzed),
    ("a_large_object_is_read_whole", statements::a_large_object_is_read_whole),
    ("a_result_is_exported", statements::a_result_is_exported),
    ("a_cursor_ends_its_transaction_under_autocommit", statements::a_cursor_ends_its_transaction_under_autocommit),
    ("every_type_is_shown_as_its_text", statements::every_type_is_shown_as_its_text),
    ("rows_are_imported_from_a_file", data::rows_are_imported_from_a_file),
    ("the_table_dialogs_ddl_runs", data::the_table_dialogs_ddl_runs),
    ("a_comparisons_script_syncs_the_target", data::a_comparisons_script_syncs_the_target),
    ("a_models_script_migrates_the_schema", data::a_models_script_migrates_the_schema),
    ("a_built_query_runs", data::a_built_query_runs),
    ("a_schemas_analysis_finds_what_its_rules_say", analyzer::a_schemas_analysis_finds_what_its_rules_say),
    ("a_what_if_index_changes_the_plan", analyzer::a_what_if_index_changes_the_plan),
    ("the_built_in_reports_run", analyzer::the_built_in_reports_run),
    ("a_running_statement_is_cancelled", session::a_running_statement_is_cancelled),
    ("the_transaction_is_followed", session::the_transaction_is_followed),
    ("a_lost_connection_is_told_and_reconnected", session::a_lost_connection_is_told_and_reconnected),
    ("each_connection_has_a_named_worker", session::each_connection_has_a_named_worker),
    ("ping_answers", session::ping_answers),
    ("a_read_only_connection_reads_alone", guards::a_read_only_connection_reads_alone),
    ("production_asks_before_a_write", guards::production_asks_before_a_write),
    ("a_drop_asks_first", guards::a_drop_asks_first),
    ("the_explorer_reads_a_schema", catalog::the_explorer_reads_a_schema),
    ("routines_and_users_are_read", catalog::routines_and_users_are_read),
    ("dependencies_and_search", catalog::dependencies_and_search),
    ("a_table_is_made_again_of_its_definition", catalog::a_table_is_made_again_of_its_definition),
    ("the_manuals_definition_is_written", catalog::the_manuals_definition_is_written),
    ("partitions_and_index_options_are_read", catalog::partitions_and_index_options_are_read),
    ("types_are_read_and_made_again", catalog::types_are_read_and_made_again),
    ("privileges_and_roles_are_read", catalog::privileges_and_roles_are_read),
    ("property_graphs_are_read", catalog::property_graphs_are_read),
];

fn main() -> ExitCode {
    let Some(spec) = std::env::var(SERVER_VARIABLE).ok().filter(|spec| !spec.is_empty()) else {
        println!("live: {} tests skipped, as {SERVER_VARIABLE} names no server", TESTS.len());
        return ExitCode::SUCCESS;
    };
    let filter = std::env::args().skip(1).find(|a| !a.starts_with('-'));
    let live = Live { server: Server::start(&spec) };
    live.prepare();
    let mut failed = Vec::new();
    for (name, test) in TESTS.iter().filter(|(name, _)| filter.as_deref().is_none_or(|f| name.contains(f))) {
        let passed = catch_unwind(AssertUnwindSafe(|| test(&live))).is_ok();
        println!("live {name} ... {}", if passed { "ok" } else { "FAILED" });
        if !passed {
            failed.push(*name);
        }
    }
    live.server.stop();
    println!("live: {} failed: {failed:?}", failed.len());
    if failed.is_empty() { ExitCode::SUCCESS } else { ExitCode::FAILURE }
}
