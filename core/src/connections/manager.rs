//! The connection manager (RULES.md D24, D59, R-SAFE-5): every open
//! connection, of a server or an embedded database, each on a worker
//! thread of its own that the manager starts, names and holds, its
//! requests sent to that worker and its answers awaited, the same requests
//! of either kind; cancel through turborel-client's canceller, or the
//! embedded session's, from the caller's thread (`[CLIENT Running
//! statements]`); reconnection with the settings it was made by, or a new
//! session of the same embedded database; an embedded database closed, a
//! checkpoint written and its lock given up, as its connection is.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;

use serde::Serialize;
use turborel::txn::Stop;
use turborel_client::Canceller;
use turborel_client::settings::Settings;

use crate::connections::imports::{ImportReport, ImportSpec};
use crate::connections::outcome::{Ran, ResultId};
use crate::connections::pages::Page;
use crate::connections::session::SessionState;
use crate::connections::spec::ConnectionSpec;
use crate::connections::worker::{Job, Reply, Request, Worker};
use crate::embedded::Embedded;
use crate::error::{Result, StudioError};
use crate::events::{ConnectionId, EventSink};
use crate::guard::policy::{Confirm, Guards};
use crate::secret::Secret;

/// The longest statement text Studio sends, in bytes: the protocol's
/// longest body (`[CLIENT Timeouts]`, `MAX_BODY`).
pub const MAX_SQL_BYTES: usize = 16 * 1024 * 1024;
/// The most values given a statement's dynamic parameters.
pub const MAX_VALUES: usize = 10_000;
/// The longest value given a dynamic parameter, in bytes.
pub const MAX_VALUE_BYTES: usize = 16 * 1024 * 1024;
/// The prefix of a worker thread's name (R-SAFE-5).
pub const WORKER_PREFIX: &str = "studio-connection-";
/// The prefix of an embedded database's worker thread's name (R-SAFE-5).
pub const EMBEDDED_PREFIX: &str = "studio-embedded-";

/// What a connection is of: a server, by the settings it was made by; or
/// an embedded database Studio holds.
enum Origin {
    Server(Box<Settings>),
    Embedded(Arc<Embedded>),
}

/// What cancels a connection's statement.
enum Stopper {
    Server(Option<Canceller>),
    Embedded(Option<Arc<Stop>>),
}

/// A connection's worker, as the manager holds it.
struct Handle {
    jobs: Sender<Job>,
    thread: JoinHandle<()>,
    stopper: Stopper,
    origin: Origin,
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

/// What an import through its guards gave: its report, or, of one the
/// guards ask about, what to confirm.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "answer")]
pub enum ImportAnswer {
    /// It ran.
    Imported(ImportReport),
    /// It runs once the user confirms this.
    Confirm(Confirm),
}

pub use embedded::EmbeddedInfo;

/// A connection opened: its number and its session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    /// Its number, to ask for it by.
    pub connection: ConnectionId,
    /// Its session.
    pub session: SessionState,
    /// What is told of its opening, as of an embedded database recovered.
    pub told: Option<String>,
}

/// Every open connection.
pub struct ConnectionManager {
    handles: Mutex<BTreeMap<ConnectionId, Handle>>,
    next: Mutex<ConnectionId>,
    spool: PathBuf,
    events: Arc<dyn EventSink>,
    key_cache: turborel_client::scram::KeyCache,
    /// What stops the file each connection runs, or the import, if one
    /// does (RULES.md D62, D63).
    files: Mutex<BTreeMap<ConnectionId, Arc<std::sync::atomic::AtomicBool>>>,
}

impl std::fmt::Debug for ConnectionManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConnectionManager").field("spool", &self.spool).finish_non_exhaustive()
    }
}

/// The worker's name of connection `id`, of a server's or of an embedded database.
fn worker_name(id: ConnectionId, embedded: bool) -> String {
    if embedded { format!("{EMBEDDED_PREFIX}{id}") } else { format!("{WORKER_PREFIX}{id}") }
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
            files: Mutex::new(BTreeMap::new()),
        }
    }

    /// What stops the file each connection runs, held.
    fn files(&self) -> MutexGuard<'_, BTreeMap<ConnectionId, Arc<std::sync::atomic::AtomicBool>>> {
        self.files.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
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
        let id = self.next_id();
        let (handle, session) = self.start(id, settings, guards)?;
        self.handles().insert(id, handle);
        Ok(Opened { connection: id, session, told: None })
    }

    /// A new connection's number.
    fn next_id(&self) -> ConnectionId {
        let mut next = self.next.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let id = *next;
        *next = next.saturating_add(1);
        id
    }

    /// Starts connection `id`'s worker, which connects by `settings`, and
    /// waits for it to be connected.
    fn start(&self, id: ConnectionId, settings: Settings, guards: Guards) -> Result<(Handle, SessionState)> {
        let (jobs, inbox) = mpsc::channel::<Job>();
        let (ready, connected) = mpsc::channel::<Result<(SessionState, Option<Canceller>)>>();
        let (spool, events, worker_settings) = (self.spool.clone(), Arc::clone(&self.events), settings.clone());
        let thread = std::thread::Builder::new()
            .name(worker_name(id, false))
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
            Ok((session, canceller)) => Ok((
                Handle { jobs, thread, stopper: Stopper::Server(canceller), origin: Origin::Server(Box::new(settings)), guards },
                session,
            )),
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
        self.run_with(id, (sql, &[]), confirmed)
    }

    /// As `run`, the statement's dynamic parameters given `values`, as
    /// text or null, each cast to its parameter's type.
    ///
    /// # Errors
    ///
    /// As `run`'s; SQLCODE -910 if the values are not as many as the
    /// parameters, or too many or too long; a value's cast's failure.
    pub fn run_with(&self, id: ConnectionId, (sql, values): (&str, &[Option<String>]), confirmed: bool) -> Result<RunAnswer> {
        if values.len() > MAX_VALUES || values.iter().flatten().any(|v| v.len() > MAX_VALUE_BYTES) {
            return Err(StudioError::misuse(format!(
                "[DESIGN] at most {MAX_VALUES} values are given, each at most {MAX_VALUE_BYTES} bytes"
            )));
        }
        if sql.len() > MAX_SQL_BYTES {
            return Err(StudioError::misuse(format!("[DESIGN] a statement is at most {MAX_SQL_BYTES} bytes")));
        }
        let guards = self.handles().get(&id).ok_or_else(|| unknown(id))?.guards;
        if let Some(confirm) = guards.judge(sql)?
            && !confirmed
        {
            return Ok(RunAnswer::Confirm(confirm));
        }
        match self.ask(id, Request::Run { sql: sql.to_owned(), read_only: guards.read_only, values: values.to_vec() })? {
            Reply::Ran(ran) => Ok(RunAnswer::Ran(ran)),
            Reply::Rows(_)
            | Reply::Columns(_)
            | Reply::Types(_)
            | Reply::Value(_)
            | Reply::Exported(_)
            | Reply::Imported(_)
            | Reply::Page(_)
            | Reply::Session(_)
            | Reply::Done => Err(unexpected()),
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
            Reply::Ran(_)
            | Reply::Rows(_)
            | Reply::Columns(_)
            | Reply::Types(_)
            | Reply::Value(_)
            | Reply::Exported(_)
            | Reply::Imported(_)
            | Reply::Session(_)
            | Reply::Done => Err(unexpected()),
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
            Reply::Ran(_)
            | Reply::Columns(_)
            | Reply::Types(_)
            | Reply::Value(_)
            | Reply::Exported(_)
            | Reply::Imported(_)
            | Reply::Page(_)
            | Reply::Session(_)
            | Reply::Done => Err(unexpected()),
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
            Reply::Ran(_)
            | Reply::Rows(_)
            | Reply::Types(_)
            | Reply::Value(_)
            | Reply::Exported(_)
            | Reply::Imported(_)
            | Reply::Page(_)
            | Reply::Session(_)
            | Reply::Done => Err(unexpected()),
        }
    }

    /// The types of `sql`'s dynamic parameters on connection `id`, in
    /// order, as SQL writes them: prepared and let go, never run.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for SQL longer than `MAX_SQL_BYTES` or an unknown
    /// connection; the server's, as of a statement that cannot be prepared.
    pub fn parameters(&self, id: ConnectionId, sql: &str) -> Result<Vec<String>> {
        if sql.len() > MAX_SQL_BYTES {
            return Err(StudioError::misuse(format!("[DESIGN] a statement is at most {MAX_SQL_BYTES} bytes")));
        }
        match self.ask(id, Request::Parameters(sql.to_owned()))? {
            Reply::Types(types) => Ok(types),
            Reply::Ran(_)
            | Reply::Rows(_)
            | Reply::Columns(_)
            | Reply::Value(_)
            | Reply::Exported(_)
            | Reply::Imported(_)
            | Reply::Page(_)
            | Reply::Session(_)
            | Reply::Done => Err(unexpected()),
        }
    }

    /// The large object of `result`'s row `row`, column `column`, on
    /// connection `id`, that came by its locator, read whole for a viewer,
    /// at most `MAX_VALUE_BYTES` of it.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection or result, or a value that
    /// came whole in its row; the read's, as SQLSTATE 0F001 of a locator its
    /// transaction's end let go.
    pub fn value(&self, id: ConnectionId, result: ResultId, (row, column): (u64, usize)) -> Result<crate::connections::values::ValueRead> {
        match self.ask(id, Request::Value { result, row, column })? {
            Reply::Value(value) => Ok(value),
            Reply::Ran(_)
            | Reply::Rows(_)
            | Reply::Columns(_)
            | Reply::Types(_)
            | Reply::Exported(_)
            | Reply::Imported(_)
            | Reply::Page(_)
            | Reply::Session(_)
            | Reply::Done => Err(unexpected()),
        }
    }

    /// Runs the query `sql` on connection `id` and writes its rows to `path`,
    /// as CSV or native rows, as they come: how many. Only a query is
    /// exported, as its guards judge it, a read (RULES.md D39).
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection or a statement that is no
    /// query; the file's; the query's.
    pub fn export(
        &self,
        id: ConnectionId,
        sql: &str,
        (path, format): (&std::path::Path, turborel_client::export::ExportFormat),
    ) -> Result<u64> {
        let classified = crate::guard::classify::classify(sql);
        if classified.class != crate::guard::classify::Class::Read {
            return Err(StudioError::misuse("[DESIGN] an export runs a query, which reads alone"));
        }
        match self.ask(id, Request::Export { sql: sql.to_owned(), path: path.to_owned(), format })? {
            Reply::Exported(rows) => Ok(rows),
            Reply::Ran(_)
            | Reply::Rows(_)
            | Reply::Columns(_)
            | Reply::Types(_)
            | Reply::Value(_)
            | Reply::Imported(_)
            | Reply::Page(_)
            | Reply::Session(_)
            | Reply::Done => Err(unexpected()),
        }
    }

    /// Imports the rows of the file `spec` names into its table on
    /// connection `id`, the guards asked first as of an INSERT into it:
    /// what they ask, unless `confirmed` (RULES.md D43).
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection, a table name too long, or
    /// an import that stops; SQLSTATE 25006 on a read-only connection.
    pub fn import(&self, id: ConnectionId, spec: ImportSpec, confirmed: bool) -> Result<ImportAnswer> {
        if spec.table.len() > MAX_SQL_BYTES || spec.fields.len() > MAX_VALUES {
            return Err(StudioError::misuse(format!(
                "[DESIGN] an import names a table of at most {MAX_SQL_BYTES} bytes, and at most {MAX_VALUES} fields"
            )));
        }
        let guards = self.handles().get(&id).ok_or_else(|| unknown(id))?.guards;
        if let Some(confirm) = guards.judge(&format!("INSERT INTO {} DEFAULT VALUES", spec.table))?
            && !confirmed
        {
            return Ok(ImportAnswer::Confirm(confirm));
        }
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        self.files().insert(id, Arc::clone(&stop));
        let events = Arc::clone(&self.events);
        let tell = crate::connections::imports::Teller(Arc::new(move |progress| {
            events.emit(crate::events::Event::Import { connection: id, progress });
        }));
        let asked = self.ask(id, Request::Import { spec: Box::new(spec), stop, tell });
        self.files().remove(&id);
        match asked? {
            Reply::Imported(report) => Ok(ImportAnswer::Imported(report)),
            Reply::Ran(_)
            | Reply::Rows(_)
            | Reply::Columns(_)
            | Reply::Types(_)
            | Reply::Value(_)
            | Reply::Exported(_)
            | Reply::Page(_)
            | Reply::Session(_)
            | Reply::Done => Err(unexpected()),
        }
    }

    /// Cancels the import running on connection `id`, if one is: no record
    /// after the one being read is imported, and the batch under way is
    /// rolled back.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if no import runs on it.
    pub fn cancel_import(&self, id: ConnectionId) -> Result<()> {
        let stop = self.files().get(&id).cloned().ok_or_else(|| StudioError::misuse("[DESIGN] no import runs on the connection"))?;
        stop.store(true, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }

    /// The environment of connection `id`, as its guards were given it.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of a connection not open.
    pub fn environment(&self, id: ConnectionId) -> Result<crate::saved::Environment> {
        Ok(self.handles().get(&id).ok_or_else(|| unknown(id))?.guards.environment)
    }

    /// What connection `id`'s guards would ask of `script` before it runs,
    /// if anything (RULES.md D29).
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection; SQLSTATE 25006 if the
    /// connection is read-only and the script may write.
    pub fn judge(&self, id: ConnectionId, script: &str) -> Result<Option<Confirm>> {
        let guards = self.handles().get(&id).ok_or_else(|| unknown(id))?.guards;
        guards.judge(script)
    }

    /// Asks whether connection `id`'s server answers.
    ///
    /// # Errors
    ///
    /// The connection's failure, if it does not.
    pub fn ping(&self, id: ConnectionId) -> Result<()> {
        self.ask(id, Request::Ping).map(drop)
    }
}

/// The session `reply` gives.
fn session(reply: Reply) -> Result<SessionState> {
    match reply {
        Reply::Session(session) => Ok(session),
        Reply::Ran(_)
        | Reply::Rows(_)
        | Reply::Columns(_)
        | Reply::Types(_)
        | Reply::Value(_)
        | Reply::Exported(_)
        | Reply::Imported(_)
        | Reply::Page(_)
        | Reply::Done => Err(unexpected()),
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

pub mod ddlmodel;
mod embedded;
mod ending;
pub mod sqlfile;
