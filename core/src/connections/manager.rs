//! The connection manager (RULES.md D24, R-SAFE-5): every open connection,
//! each on a worker thread of its own that the manager starts, names and
//! holds, its requests sent to that worker and its answers awaited;
//! cancel through turborel-client's canceller, from the caller's thread
//! (`[CLIENT Running statements]`); reconnection with the settings it was
//! made by.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;

use serde::Serialize;
use turborel_client::Canceller;
use turborel_client::settings::Settings;

use crate::connections::outcome::{Ran, ResultId};
use crate::connections::pages::Page;
use crate::connections::session::SessionState;
use crate::connections::spec::ConnectionSpec;
use crate::connections::worker::{Job, Reply, Request, Worker};
use crate::error::{Result, StudioError};
use crate::events::{ConnectionId, EventSink};
use crate::guard::policy::{Confirm, Guards};
use crate::secret::Secret;

/// The longest statement text Studio sends, in bytes: the protocol's
/// longest body (`[CLIENT Timeouts]`, `MAX_BODY`).
pub const MAX_SQL_BYTES: usize = 16 * 1024 * 1024;
/// The prefix of a worker thread's name (R-SAFE-5).
pub const WORKER_PREFIX: &str = "studio-connection-";

/// A connection's worker, as the manager holds it.
struct Handle {
    jobs: Sender<Job>,
    thread: JoinHandle<()>,
    canceller: Option<Canceller>,
    settings: Settings,
    guards: Guards,
}

/// A thread the manager holds, as `threads` lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadInfo {
    /// Its name.
    pub name: String,
    /// The connection it serves.
    pub connection: ConnectionId,
}

/// What running a statement answers: what it gave, or, of a statement the
/// guards ask about, what to confirm.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "answer")]
pub enum RunAnswer {
    /// It ran.
    Ran(Box<Ran>),
    /// It runs once the user confirms this.
    Confirm(Confirm),
}

/// A connection opened: its number and its session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    /// Its number, to ask for it by.
    pub connection: ConnectionId,
    /// Its session.
    pub session: SessionState,
}

/// Every open connection.
pub struct ConnectionManager {
    handles: Mutex<BTreeMap<ConnectionId, Handle>>,
    next: Mutex<ConnectionId>,
    spool: PathBuf,
    events: Arc<dyn EventSink>,
    key_cache: turborel_client::scram::KeyCache,
}

impl std::fmt::Debug for ConnectionManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConnectionManager").field("spool", &self.spool).finish_non_exhaustive()
    }
}

/// The worker's name of connection `id`.
fn worker_name(id: ConnectionId) -> String {
    format!("{WORKER_PREFIX}{id}")
}

impl ConnectionManager {
    /// A manager with no connection, spooling results in `spool`, telling
    /// `events` what happens unasked.
    pub fn new(spool: PathBuf, events: Arc<dyn EventSink>) -> ConnectionManager {
        ConnectionManager {
            handles: Mutex::new(BTreeMap::new()),
            next: Mutex::new(1),
            spool,
            events,
            key_cache: turborel_client::scram::KeyCache::new(),
        }
    }

    /// The handles, held.
    fn handles(&self) -> MutexGuard<'_, BTreeMap<ConnectionId, Handle>> {
        self.handles.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Opens a connection as `spec` says, proving `password` if given, the
    /// environment read by `variable`.
    ///
    /// # Errors
    ///
    /// The settings' (`ConnectionSpec::resolve`); the connection's, as
    /// turborel-client gives it.
    pub fn open(
        &self,
        (spec, guards): (&ConnectionSpec, Guards),
        password: Option<&Secret>,
        variable: impl Fn(&str) -> Option<String>,
    ) -> Result<Opened> {
        let mut settings = spec.resolve(password, variable)?;
        settings.key_cache = self.key_cache.clone();
        let id = {
            let mut next = self.next.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let id = *next;
            *next = next.saturating_add(1);
            id
        };
        let (handle, session) = self.start(id, settings, guards)?;
        self.handles().insert(id, handle);
        Ok(Opened { connection: id, session })
    }

    /// Starts connection `id`'s worker, which connects by `settings`, and
    /// waits for it to be connected.
    fn start(&self, id: ConnectionId, settings: Settings, guards: Guards) -> Result<(Handle, SessionState)> {
        let (jobs, inbox) = mpsc::channel::<Job>();
        let (ready, connected) = mpsc::channel::<Result<(SessionState, Option<Canceller>)>>();
        let (spool, events, worker_settings) = (self.spool.clone(), Arc::clone(&self.events), settings.clone());
        let thread = std::thread::Builder::new()
            .name(worker_name(id))
            .spawn(move || match worker_settings.connect() {
                Ok(connection) => {
                    let canceller = connection.canceller();
                    let _ = ready.send(Ok((SessionState::of(&connection), canceller))); // The opener waits for it.
                    Worker::new(id, connection, spool, events).serve(&inbox);
                }
                Err(failure) => {
                    let _ = ready.send(Err(failure.into())); // The opener waits for it.
                }
            })
            .map_err(|e| StudioError::misuse(format!("[DESIGN] the connection's worker cannot start: {e}")))?;
        let started = connected.recv().map_err(|_| StudioError::lost("[DESIGN] the connection's worker ended"));
        match started.and_then(|r| r) {
            Ok((session, canceller)) => Ok((Handle { jobs, thread, canceller, settings, guards }, session)),
            Err(error) => {
                let _ = thread.join(); // It has ended: its failure is the one given.
                Err(error)
            }
        }
    }

    /// Sends `request` to connection `id`'s worker and waits for its answer.
    fn ask(&self, id: ConnectionId, request: Request) -> Result<Reply> {
        let jobs = self.handles().get(&id).map(|h| h.jobs.clone()).ok_or_else(|| unknown(id))?;
        let (reply, answer) = mpsc::channel();
        jobs.send((request, reply)).map_err(|_| StudioError::lost("[DESIGN] the connection's worker ended"))?;
        answer.recv().map_err(|_| StudioError::lost("[DESIGN] the connection's worker ended"))?
    }

    /// Runs `sql` on connection `id`, through its guards (D29): a statement
    /// the guards ask about runs only once `confirmed`, and is otherwise
    /// answered with what to confirm.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for SQL longer than `MAX_SQL_BYTES`, or an unknown
    /// connection; SQLSTATE 25006 for a write on a read-only connection;
    /// the statement's failure, as the server gives it.
    pub fn run(&self, id: ConnectionId, sql: &str, confirmed: bool) -> Result<RunAnswer> {
        if sql.len() > MAX_SQL_BYTES {
            return Err(StudioError::misuse(format!("[DESIGN] a statement is at most {MAX_SQL_BYTES} bytes")));
        }
        let guards = self.handles().get(&id).ok_or_else(|| unknown(id))?.guards;
        if let Some(confirm) = guards.judge(sql)?
            && !confirmed
        {
            return Ok(RunAnswer::Confirm(confirm));
        }
        match self.ask(id, Request::Run { sql: sql.to_owned(), read_only: guards.read_only })? {
            Reply::Ran(ran) => Ok(RunAnswer::Ran(ran)),
            Reply::Rows(_) | Reply::Columns(_) | Reply::Page(_) | Reply::Session(_) | Reply::Done => Err(unexpected()),
        }
    }

    /// At most `count` rows of `result` from row `from`.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection or result, or too many rows
    /// asked for; the fetch's failure.
    pub fn rows(&self, id: ConnectionId, result: ResultId, (from, count): (u64, u32)) -> Result<Page> {
        match self.ask(id, Request::Rows { result, from, count })? {
            Reply::Page(page) => Ok(page),
            Reply::Ran(_) | Reply::Rows(_) | Reply::Columns(_) | Reply::Session(_) | Reply::Done => Err(unexpected()),
        }
    }

    /// Closes `result` of connection `id`.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection or result; the server's.
    pub fn close_result(&self, id: ConnectionId, result: ResultId) -> Result<()> {
        self.ask(id, Request::CloseResult(result)).map(drop)
    }

    /// Connection `id`'s session, as the server last told it.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection.
    pub fn session(&self, id: ConnectionId) -> Result<SessionState> {
        session(self.ask(id, Request::Session)?)
    }

    /// Makes each statement of connection `id` its own transaction, or not.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection.
    pub fn set_autocommit(&self, id: ConnectionId, on: bool) -> Result<SessionState> {
        session(self.ask(id, Request::Autocommit(on))?)
    }

    /// The rows of the catalog's query `sql` on connection `id`, its
    /// parameters `params`, at most `cap` of them. The query is Studio's
    /// own, a read of the Information Schema, so it passes no guard.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection; the server's.
    pub fn catalog(
        &self,
        id: ConnectionId,
        sql: &str,
        (params, cap): (&[String], u32),
    ) -> Result<Vec<Vec<crate::connections::cells::Cell>>> {
        let request = Request::Catalog { sql: sql.to_owned(), params: params.to_vec(), cap };
        match self.ask(id, request)? {
            Reply::Rows(rows) => Ok(rows),
            Reply::Ran(_) | Reply::Columns(_) | Reply::Page(_) | Reply::Session(_) | Reply::Done => Err(unexpected()),
        }
    }

    /// The columns `sql` would give on connection `id`, as the server
    /// declares them: prepared and let go, never run.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection; the server's.
    pub fn describe(&self, id: ConnectionId, sql: &str) -> Result<Vec<crate::connections::cells::ColumnInfo>> {
        match self.ask(id, Request::Describe(sql.to_owned()))? {
            Reply::Columns(columns) => Ok(columns),
            Reply::Ran(_) | Reply::Rows(_) | Reply::Page(_) | Reply::Session(_) | Reply::Done => Err(unexpected()),
        }
    }

    /// Asks whether connection `id`'s server answers.
    ///
    /// # Errors
    ///
    /// The connection's failure, if it does not.
    pub fn ping(&self, id: ConnectionId) -> Result<()> {
        self.ask(id, Request::Ping).map(drop)
    }

    /// Cancels the statement connection `id` runs, from this thread.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection, or one with no canceller;
    /// the cancel's failure, if the server cannot be reached.
    pub fn cancel(&self, id: ConnectionId) -> Result<()> {
        let canceller = self.handles().get(&id).ok_or_else(|| unknown(id))?.canceller.clone();
        let canceller = canceller.ok_or_else(|| StudioError::misuse("[DESIGN] the connection cannot be cancelled"))?;
        canceller.cancel().map_err(StudioError::from)
    }

    /// Ends connection `id`, waiting for its worker to end.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection; the server's failure as the
    /// session ends, as a deferred constraint's at its commit.
    pub fn close(&self, id: ConnectionId) -> Result<()> {
        let answer = self.ask(id, Request::Terminate).map(drop);
        let handle = self.handles().remove(&id);
        if let Some(handle) = handle {
            let _ = handle.thread.join(); // It has answered Terminate, and ends.
        }
        answer
    }

    /// Connects connection `id` again, by the settings it was made by: its
    /// old session ended, its results with it.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection; the connection's failure.
    pub fn reconnect(&self, id: ConnectionId) -> Result<SessionState> {
        let old = self.handles().remove(&id).ok_or_else(|| unknown(id))?;
        let (reply, _) = mpsc::channel();
        let _ = old.jobs.send((Request::Terminate, reply)); // A worker already ended needs no Terminate.
        let _ = old.thread.join(); // It ends as it is told, or has ended.
        let (handle, session) = self.start(id, old.settings, old.guards)?;
        self.handles().insert(id, handle);
        Ok(session)
    }

    /// The threads the manager holds, one for each open connection.
    pub fn threads(&self) -> Vec<ThreadInfo> {
        self.handles().keys().map(|&connection| ThreadInfo { name: worker_name(connection), connection }).collect()
    }
}

impl Drop for ConnectionManager {
    /// Every connection ended, and its worker with it (R-SAFE-5).
    fn drop(&mut self) {
        let ids: Vec<ConnectionId> = self.handles().keys().copied().collect();
        for id in ids {
            let _ = self.close(id); // Each is ended; a failure as it ends has no one to tell.
        }
    }
}

/// The session `reply` gives.
fn session(reply: Reply) -> Result<SessionState> {
    match reply {
        Reply::Session(session) => Ok(session),
        Reply::Ran(_) | Reply::Rows(_) | Reply::Columns(_) | Reply::Page(_) | Reply::Done => Err(unexpected()),
    }
}

/// An unknown connection.
fn unknown(id: ConnectionId) -> StudioError {
    StudioError::misuse(format!("[DESIGN] connection {id} is not open"))
}

/// A worker's answer of the wrong kind, which no worker gives.
fn unexpected() -> StudioError {
    StudioError::misuse("[DESIGN] the connection's worker answered out of turn")
}
