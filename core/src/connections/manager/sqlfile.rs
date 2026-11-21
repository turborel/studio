//! A `.sql` file run on a connection, statement by statement, without the
//! editor (RULES.md D62): scanned and judged by the connection's guards
//! first, asked once of the whole file; run in one transaction, a commit
//! every so many statements, or each its own; stopped at the first
//! failure, or each failure logged by its line and SQLSTATE and the run
//! gone on; its progress told as it goes, and cancelled between
//! statements or within one.

use std::fmt::Write as _;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::{ConnectionManager, RunAnswer, unknown};
use crate::connections::outcome::Outcome;
use crate::error::{Result, StudioError};
use crate::events::{ConnectionId, Event};
use crate::guard::policy::Confirm;
use crate::worksheet::sqlfile::{FileStatement, Scan, Statements, scan, shown};

/// The failures a run's log keeps, at most; those past it are counted.
pub const MAX_LOGGED: usize = 10_000;
/// How often a run tells its progress, at most.
const TOLD_EVERY: Duration = Duration::from_millis(250);
/// The SQLCODE of a statement cancelled (`[CLIENT Running statements]`).
const CANCELLED: i32 = -920;

/// How a file's statements are made transactions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "every")]
pub enum Transactions {
    /// Each statement its own, as autocommit makes it.
    Autocommit,
    /// The whole file one, committed at its end, rolled back if it stops.
    Whole,
    /// A commit after each so many statements.
    Every(u64),
}

/// How a file is run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileOptions {
    /// How its statements are made transactions.
    pub transactions: Transactions,
    /// Whether the run stops at the first statement that fails, rather
    /// than log it and go on.
    pub stop_on_error: bool,
}

/// A statement of a file that failed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileFailure {
    /// Its number among the file's statements.
    pub number: u64,
    /// The line it begins on.
    pub line: u64,
    /// Its SQLSTATE.
    pub sqlstate: String,
    /// Its SQLCODE.
    pub sqlcode: i32,
    /// What it says.
    pub message: String,
    /// The statement, cut.
    pub statement: String,
}

/// How far a run has come, as it tells it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileProgress {
    /// The statements run.
    pub statements: u64,
    /// The file's bytes read.
    pub bytes: u64,
    /// Its bytes in all.
    pub total: u64,
    /// The statements that failed.
    pub failed: u64,
}

/// How a run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Ending {
    /// Every statement ran.
    Finished,
    /// A statement failed, and the run stopped there.
    Stopped,
    /// The user cancelled it.
    Cancelled,
}

/// What a run did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileReport {
    /// How it ended.
    pub ending: Ending,
    /// The statements run, those that failed among them.
    pub statements: u64,
    /// The rows they inserted, updated, deleted or merged, as told.
    pub rows_affected: u64,
    /// The statements that failed.
    pub failed: u64,
    /// The first `MAX_LOGGED` of them.
    pub log: Vec<FileFailure>,
    /// Whether what ran was rolled back at the end: of a whole file's
    /// transaction, or the statements since the last commit.
    pub rolled_back: bool,
    /// How long it took, in milliseconds.
    pub millis: u64,
}

/// What running a file answers: what it did, or, of a file the guards
/// ask about, what to confirm, with the scan they judged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum FileAnswer {
    /// It ran.
    Ran {
        /// What it did.
        report: FileReport,
    },
    /// It runs once the user confirms this.
    Confirm {
        /// What the guards ask.
        confirm: Confirm,
        /// What the file holds.
        scan: Box<Scan>,
    },
}

/// The log of `report`, a run of the file `name`, as it is saved: what the
/// run did, then each failure kept, by its line, SQLSTATE and SQLCODE.
pub fn log_text(name: &str, report: &FileReport) -> String {
    let ending = match report.ending {
        Ending::Finished => "finished",
        Ending::Stopped => "stopped at a failure",
        Ending::Cancelled => "cancelled",
    };
    let mut text = format!(
        "{name}: {ending}; {} statements run, {} failed, {} rows affected, in {} ms{}\n",
        report.statements,
        report.failed,
        report.rows_affected,
        report.millis,
        if report.rolled_back { "; what ran since the last commit was rolled back" } else { "" }
    );
    for f in &report.log {
        let _ = writeln!(
            text,
            "line {}, statement {}: SQLSTATE {} (SQLCODE {}): {}\n    {}",
            f.line, f.number, f.sqlstate, f.sqlcode, f.message, f.statement
        ); // Writing to a String cannot fail.
    }
    let more = report.failed.saturating_sub(u64::try_from(report.log.len()).unwrap_or(u64::MAX));
    if more > 0 {
        let _ = writeln!(text, "and {more} more failures, not kept"); // Writing to a String cannot fail.
    }
    text
}

/// The file at `path`, opened to be read.
fn opened(path: &Path) -> Result<BufReader<File>> {
    File::open(path).map(BufReader::new).map_err(|e| StudioError::misuse(format!("[DESIGN] {}: {e}", path.display())))
}

/// A run under way: its connection, its options, what it has done, and
/// when it last told its progress.
struct Run<'a> {
    manager: &'a ConnectionManager,
    id: ConnectionId,
    options: FileOptions,
    stop: &'a AtomicBool,
    report: FileReport,
    total: u64,
    told: Instant,
    /// The statements run since the last commit.
    since_commit: u64,
}

impl Run<'_> {
    /// Tells the progress, at most every `TOLD_EVERY` but for the last.
    fn tell(&mut self, bytes: u64, last: bool) {
        if last || self.told.elapsed() >= TOLD_EVERY {
            self.told = Instant::now();
            let progress = FileProgress { statements: self.report.statements, bytes, total: self.total, failed: self.report.failed };
            self.manager.events.emit(Event::SqlFile { connection: self.id, progress });
        }
    }

    /// Runs `s`: whether the run goes on.
    fn statement(&mut self, s: &FileStatement) -> Result<bool> {
        self.report.statements = self.report.statements.saturating_add(1);
        match self.manager.run(self.id, &s.text, true) {
            Ok(RunAnswer::Ran(ran)) => {
                match ran.outcome {
                    Outcome::Rows { result, .. } => self.manager.close_result(self.id, result)?,
                    Outcome::Done { rows_affected, .. } => {
                        self.report.rows_affected = self.report.rows_affected.saturating_add(rows_affected.unwrap_or(0));
                    }
                }
                Ok(true)
            }
            Ok(RunAnswer::Confirm(_)) => Err(StudioError::misuse("[DESIGN] a statement of a file confirmed is asked of again")),
            Err(e) if e.sqlstate == crate::error::CONNECTION_SQLSTATE => Err(e),
            Err(e) => {
                if e.sqlcode == CANCELLED && self.stop.load(Ordering::SeqCst) {
                    self.report.ending = Ending::Cancelled;
                    return Ok(false);
                }
                self.report.failed = self.report.failed.saturating_add(1);
                // A failure of class 40 rolled the transaction back: what ran
                // in it is gone, so the run cannot go on as if it were not.
                let rolled_back = e.sqlstate.starts_with("40") && self.options.transactions != Transactions::Autocommit;
                if self.report.log.len() < MAX_LOGGED {
                    self.report.log.push(FileFailure {
                        number: s.number,
                        line: s.line,
                        sqlstate: e.sqlstate,
                        sqlcode: e.sqlcode,
                        message: e.message,
                        statement: shown(&s.text),
                    });
                }
                if self.options.stop_on_error || rolled_back {
                    self.report.ending = Ending::Stopped;
                    return Ok(false);
                }
                Ok(true)
            }
        }
    }

    /// Commits if `Every` says one is due.
    fn commit_if_due(&mut self) -> Result<()> {
        self.since_commit = self.since_commit.saturating_add(1);
        if let Transactions::Every(n) = self.options.transactions
            && self.since_commit >= n.max(1)
        {
            self.ending("COMMIT")?;
            self.since_commit = 0;
        }
        Ok(())
    }

    /// Runs `sql`, which ends the transaction, again if a cancel meant for
    /// the statement before it caught it.
    fn ending(&self, sql: &str) -> Result<()> {
        match self.manager.run(self.id, sql, true) {
            Err(e) if e.sqlcode == CANCELLED => self.manager.run(self.id, sql, true).map(drop),
            other => other.map(drop),
        }
    }

    /// Ends the run's transaction: committed if it finished, else rolled
    /// back.
    fn end(&mut self) -> Result<()> {
        if self.options.transactions == Transactions::Autocommit {
            return Ok(());
        }
        if self.report.ending == Ending::Finished {
            self.ending("COMMIT")?;
        } else {
            self.ending("ROLLBACK")?;
            self.report.rolled_back = self.since_commit > 0 || self.options.transactions == Transactions::Whole;
        }
        Ok(())
    }
}

impl ConnectionManager {
    /// Scans the `.sql` file at `path`: what it holds, as its guards judge
    /// it before it runs, and what they would ask of it on connection
    /// `id`, if anything.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection, a file that cannot be read
    /// or is not text Studio reads, or a statement too long; the guards'
    /// refusal.
    pub fn scan_file(&self, id: ConnectionId, path: &Path) -> Result<(Scan, Option<Confirm>)> {
        let guards = self.handles().get(&id).ok_or_else(|| unknown(id))?.guards;
        let scan = scan(opened(path)?)?;
        let confirm = guards.judge_scan(&scan)?;
        Ok((scan, confirm))
    }

    /// Runs the `.sql` file at `path` on connection `id` as `options` say,
    /// its guards asked first of the whole file: what they ask, unless
    /// `confirmed`. The session's autocommit is as it was after.
    ///
    /// # Errors
    ///
    /// As `scan_file`'s; SQLCODE -910 if a transaction of the session is
    /// open; the connection's loss.
    pub fn run_file(&self, id: ConnectionId, path: &Path, options: FileOptions, confirmed: bool) -> Result<FileAnswer> {
        let (scan, confirm) = self.scan_file(id, path)?;
        if let Some(confirm) = confirm
            && !confirmed
        {
            return Ok(FileAnswer::Confirm { confirm, scan: Box::new(scan) });
        }
        let before = self.session(id)?.transaction;
        if before.active && !before.autocommit {
            return Err(StudioError::misuse("[DESIGN] the session's transaction is open: commit it or roll it back before a file runs"));
        }
        let stop = Arc::new(AtomicBool::new(false));
        self.files().insert(id, Arc::clone(&stop));
        let started = Instant::now();
        let autocommit = options.transactions == Transactions::Autocommit;
        let ran = self.set_autocommit(id, autocommit).and_then(|_| self.run_statements(id, path, options, (&stop, scan.bytes)));
        self.files().remove(&id);
        let restored = self.set_autocommit(id, before.autocommit);
        let mut report = ran?;
        restored?;
        report.millis = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
        Ok(FileAnswer::Ran { report })
    }

    /// Runs the statements of the file at `path`, as `run_file` does.
    fn run_statements(&self, id: ConnectionId, path: &Path, options: FileOptions, (stop, total): (&AtomicBool, u64)) -> Result<FileReport> {
        let mut statements = Statements::new(opened(path)?);
        let report = FileReport {
            ending: Ending::Finished,
            statements: 0,
            rows_affected: 0,
            failed: 0,
            log: Vec::new(),
            rolled_back: false,
            millis: 0,
        };
        let mut run = Run { manager: self, id, options, stop, report, total, told: Instant::now(), since_commit: 0 };
        loop {
            if stop.load(Ordering::SeqCst) {
                run.report.ending = Ending::Cancelled;
                break;
            }
            let Some(s) = statements.next_statement()? else { break };
            if !run.statement(&s)? {
                break;
            }
            run.commit_if_due()?;
            run.tell(statements.bytes_read(), false);
        }
        run.end()?;
        run.tell(statements.bytes_read(), true);
        Ok(run.report)
    }

    /// Cancels the file running on connection `id`, if one is: no
    /// statement after the one running is run, and that one is cancelled.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if no file runs on it; the cancel's failure.
    pub fn cancel_file(&self, id: ConnectionId) -> Result<()> {
        let stop = self.files().get(&id).cloned().ok_or_else(|| StudioError::misuse("[DESIGN] no file runs on the connection"))?;
        stop.store(true, Ordering::SeqCst);
        self.cancel(id)
    }
}
