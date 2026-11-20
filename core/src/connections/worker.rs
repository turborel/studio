//! A connection's worker (RULES.md D24, R-SAFE-5): the thread that owns
//! one connection, takes its requests in turn, and answers each. A query
//! is prepared and read through its cursor, a page at a time (R-SAFE-1);
//! a statement that cannot be prepared is run directly.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc::{Receiver, Sender};

use turborel_client::Notice;
use turborel_client::agent::Connected;
use turborel_client::statements::Statement;

use crate::connections::cells::ColumnInfo;
use crate::connections::outcome::{Outcome, Ran, ResultId, ServerTime};
use crate::connections::pages::{PAGE_ROWS, Page, Pages};
use crate::connections::session::SessionState;
use crate::error::{DiagnosticsView, Result, StudioError};
use crate::events::{ConnectionId, Event, EventSink};

/// The SQLSTATE of a statement that cannot be prepared, which is run
/// directly instead (`[CLIENT Prepared statements]`).
const NOT_PREPARABLE: &str = "37000";
/// What makes the next transaction of a read-only connection READ ONLY.
const SET_READ_ONLY: &str = "SET TRANSACTION READ ONLY";
/// The SQLSTATE of a cursor not open, as one a transaction's end closed.
const CURSOR_NOT_OPEN: &str = "24000";

/// What a worker is asked.
#[derive(Debug)]
pub(crate) enum Request {
    /// Run a statement; on a read-only connection, in a transaction begun
    /// READ ONLY.
    Run { sql: String, read_only: bool },
    /// Rows of a result.
    Rows { result: ResultId, from: u64, count: u32 },
    /// Close a result.
    CloseResult(ResultId),
    /// The session, as told.
    Session,
    /// Make each statement its own transaction, or not.
    Autocommit(bool),
    /// Ask whether the server answers.
    Ping,
    /// End the connection, and the worker.
    Terminate,
}

/// What a worker answers.
#[derive(Debug)]
pub(crate) enum Reply {
    Ran(Box<Ran>),
    Page(Page),
    Session(SessionState),
    Done,
}

/// A statement's warnings and the server's time for it.
type Told = (Vec<StudioError>, Option<ServerTime>);

/// A request, and where its answer goes.
pub(crate) type Job = (Request, Sender<Result<Reply>>);

/// A result kept: its pages, and its statement, whose cursor gives more,
/// if it has one; a result whose rows came whole has none.
struct OpenResult {
    statement: Option<Statement>,
    pages: Pages,
}

/// A connection's worker.
pub(crate) struct Worker {
    id: ConnectionId,
    connection: Option<Connected>,
    results: BTreeMap<ResultId, OpenResult>,
    next_result: ResultId,
    spool: PathBuf,
    events: Arc<dyn EventSink>,
    told_lost: bool,
}

/// A notice as the front end is told it.
fn notice_event(connection: ConnectionId, notice: &Notice) -> Event {
    Event::Notice {
        connection,
        sqlstate: notice.sqlstate.clone(),
        message: notice.message.clone(),
        diagnostics: DiagnosticsView::from(&notice.diagnostics),
    }
}

impl Worker {
    /// The worker of `connection`, numbered `id`, its notices told to
    /// `events`, its results spooled in `spool`.
    pub(crate) fn new(id: ConnectionId, mut connection: Connected, spool: PathBuf, events: Arc<dyn EventSink>) -> Worker {
        let sink = Arc::clone(&events);
        connection.set_notice_handler(Some(Box::new(move |notice: &Notice| sink.emit(notice_event(id, notice)))));
        Worker { id, connection: Some(connection), results: BTreeMap::new(), next_result: 1, spool, events, told_lost: false }
    }

    /// Answers each job until Terminate, or until no one can ask more.
    pub(crate) fn serve(mut self, jobs: &Receiver<Job>) {
        while let Ok((request, reply)) = jobs.recv() {
            let ending = matches!(request, Request::Terminate);
            let answer = self.answer(request);
            self.tell_if_lost();
            // A caller that stopped waiting needs no answer.
            let _ = reply.send(answer);
            if ending {
                return;
            }
        }
        // No one can ask more: the connection ends with the worker.
        let _ = self.terminate();
    }

    /// The connection, while it is not terminated.
    fn connection(&mut self) -> Result<&mut Connected> {
        self.connection.as_mut().ok_or_else(|| StudioError::lost("[DESIGN] the connection is ended"))
    }

    /// The answer to `request`.
    fn answer(&mut self, request: Request) -> Result<Reply> {
        match request {
            Request::Run { sql, read_only } => {
                if read_only {
                    self.begin_read_only()?;
                }
                self.run(&sql).map(|ran| Reply::Ran(Box::new(ran)))
            }
            Request::Rows { result, from, count } => self.rows(result, from, count).map(Reply::Page),
            Request::CloseResult(result) => self.close_result(result).map(|()| Reply::Done),
            Request::Session => self.session().map(Reply::Session),
            Request::Autocommit(on) => {
                self.connection()?.set_autocommit(on);
                self.session().map(Reply::Session)
            }
            Request::Ping => self.connection()?.ping().map(|()| Reply::Done).map_err(StudioError::from),
            Request::Terminate => self.terminate().map(|()| Reply::Done),
        }
    }

    /// Makes the next transaction READ ONLY, unless one is active
    /// ([DOC sql/statements/set-transaction.md DESCRIPTION]).
    fn begin_read_only(&mut self) -> Result<()> {
        let connection = self.connection()?;
        if !connection.in_transaction() {
            connection.query(SET_READ_ONLY)?;
        }
        Ok(())
    }

    /// The session, as the server last told it.
    fn session(&mut self) -> Result<SessionState> {
        Ok(SessionState::of(self.connection()?))
    }

    /// Tells the front end once that the connection is lost.
    fn tell_if_lost(&mut self) {
        let lost = self.connection.as_ref().is_some_and(Connected::is_lost);
        if lost && !self.told_lost {
            self.told_lost = true;
            let error = StudioError::lost("[DESIGN] the connection to the server was lost: reconnect to go on");
            self.events.emit(Event::Lost { connection: self.id, error });
        }
    }

    /// Runs `sql`: a query through its cursor, another statement executed,
    /// one that cannot be prepared run directly.
    fn run(&mut self, sql: &str) -> Result<Ran> {
        let connection = self.connection()?;
        let _ = connection.take_conditions(); // Those of an earlier statement are not this one's.
        let (outcome, told) = match connection.prepare(sql) {
            Ok(statement) if !statement.columns().is_empty() => self.open(statement)?,
            Ok(statement) => self.execute(statement)?,
            Err(failure) if failure.sqlstate == NOT_PREPARABLE => self.direct(sql)?,
            Err(failure) => return Err(failure.into()),
        };
        let (warnings, server_time) = told;
        Ok(Ran { outcome, warnings, server_time, session: SessionState::of(self.connection()?) })
    }

    /// What the server told of the statement just completed: its warnings
    /// and its time, read before any other request replaces them.
    fn told(&mut self) -> Result<Told> {
        let connection = self.connection()?;
        let warnings = connection.take_conditions().into_iter().map(StudioError::from).collect();
        Ok((warnings, connection.server_time().map(ServerTime::from)))
    }

    /// Executes `statement`, not a query, then lets it go.
    fn execute(&mut self, statement: Statement) -> Result<(Outcome, Told)> {
        let connection = self.connection()?;
        let executed = connection.execute(&statement, &[]);
        let outcome = match executed {
            Ok(turborel_client::connection::Outcome::Done(done)) => {
                Ok(Outcome::done(&done, connection.rows_affected(), connection.last_generated()))
            }
            Ok(turborel_client::connection::Outcome::Rows { columns, rows }) => self.whole(&columns, &rows),
            Err(failure) => Err(failure.into()),
        };
        let told = self.told()?;
        // A statement the server no longer holds is let go all the same.
        let _ = self.connection()?.deallocate(statement);
        Ok((outcome?, told))
    }

    /// Runs `sql` directly, as a statement that cannot be prepared is.
    fn direct(&mut self, sql: &str) -> Result<(Outcome, Told)> {
        let connection = self.connection()?;
        let outcome = match connection.query(sql)? {
            turborel_client::connection::Outcome::Done(done) => {
                Outcome::done(&done, connection.rows_affected(), connection.last_generated())
            }
            turborel_client::connection::Outcome::Rows { columns, rows } => self.whole(&columns, &rows)?,
        };
        Ok((outcome, self.told()?))
    }

    /// A result whose rows came whole, as a CALL's output parameters do:
    /// paged as any other, with no cursor left to read.
    fn whole(&mut self, columns: &[turborel_client::Column], rows: &[turborel::storage::Row]) -> Result<Outcome> {
        let pages = Pages::new(&self.spool, rows, false)?;
        self.keep(None, pages, columns)
    }

    /// Opens `statement`'s cursor, a query, and keeps its result.
    fn open(&mut self, statement: Statement) -> Result<(Outcome, Told)> {
        let batch = match self.connection()?.open_cursor(&statement, &[], PAGE_ROWS) {
            Ok(batch) => batch,
            Err(failure) => {
                let _ = self.connection()?.deallocate(statement); // Let go; the failure is the one told.
                return Err(failure.into());
            }
        };
        let told = self.told()?;
        let pages = Pages::new(&self.spool, &batch.rows, batch.more)?;
        let columns = statement.columns().to_vec();
        Ok((self.keep(Some(statement), pages, &columns)?, told))
    }

    /// Keeps a result of `pages`, its cursor `statement`'s if it has one.
    fn keep(&mut self, statement: Option<Statement>, mut pages: Pages, columns: &[turborel_client::Column]) -> Result<Outcome> {
        let result = self.next_result;
        self.next_result = self.next_result.saturating_add(1);
        let page = pages.rows(0, PAGE_ROWS, &mut || Err(StudioError::misuse("[DESIGN] the first page is read")))?;
        let columns = columns.iter().map(ColumnInfo::from).collect();
        self.results.insert(result, OpenResult { statement, pages });
        Ok(Outcome::Rows { result, columns, page })
    }

    /// Rows of `result`, fetched as far as they are asked for.
    fn rows(&mut self, result: ResultId, from: u64, count: u32) -> Result<Page> {
        let Worker { connection, results, .. } = self;
        let connection = connection.as_mut().ok_or_else(|| StudioError::lost("[DESIGN] the connection is ended"))?;
        let open = results.get_mut(&result).ok_or_else(|| StudioError::misuse(format!("[DESIGN] result {result} is not open")))?;
        let statement = open.statement.as_ref();
        open.pages.rows(from, count, &mut || {
            let statement = statement.ok_or_else(|| StudioError::misuse("[DESIGN] the result came whole"))?;
            let batch = connection.fetch(statement, PAGE_ROWS)?;
            Ok((batch.rows, batch.more))
        })
    }

    /// Closes `result`: its cursor, if still open, and its statement.
    fn close_result(&mut self, result: ResultId) -> Result<()> {
        let open = self.results.remove(&result).ok_or_else(|| StudioError::misuse(format!("[DESIGN] result {result} is not open")))?;
        let Some(statement) = open.statement else { return Ok(()) };
        let connection = self.connection()?;
        if !open.pages.read().1 {
            match connection.close(&statement) {
                Err(failure) if failure.sqlstate != CURSOR_NOT_OPEN => return Err(failure.into()),
                Ok(()) | Err(_) => {}
            }
        }
        connection.deallocate(statement).map_err(StudioError::from)
    }

    /// Ends the connection, its results with it.
    fn terminate(&mut self) -> Result<()> {
        self.results.clear();
        match self.connection.take() {
            Some(connection) if !connection.is_lost() => connection.terminate().map_err(StudioError::from),
            _ => Ok(()),
        }
    }
}
