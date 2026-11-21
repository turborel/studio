//! A connection's worker (RULES.md D24, R-SAFE-5): the thread that owns
//! one connection, takes its requests in turn, and answers each. A query
//! is prepared and read through its cursor, a page at a time (R-SAFE-1);
//! a statement that cannot be prepared is run directly.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc::{Receiver, Sender};

use turborel::value::Value;
use turborel::value::lob::{Lob, LobKind};
use turborel_client::Notice;
use turborel_client::agent::Connected;
use turborel_client::export::ExportFormat;
use turborel_client::statements::Statement;

use crate::connections::cells::ColumnInfo;
use crate::connections::imports::{ImportReport, ImportSpec, Teller, Watch, run_import};
use crate::connections::outcome::{Outcome, Ran, ResultId, ServerTime};
use crate::connections::pages::{PAGE_ROWS, Page, Pages};
use crate::connections::session::SessionState;
use crate::connections::values::{CHUNK_BYTES, ValueRead, parameter_value};
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
    /// Run a statement, its dynamic parameters given `values` as text, or
    /// null, if it has any; on a read-only connection, in a transaction
    /// begun READ ONLY.
    Run { sql: String, read_only: bool, values: Vec<Option<String>> },
    /// The types of a statement's dynamic parameters, prepared and let
    /// go, not run.
    Parameters(String),
    /// Rows of a result.
    Rows { result: ResultId, from: u64, count: u32 },
    /// Close a result.
    CloseResult(ResultId),
    /// The session, as told.
    Session,
    /// Make each statement its own transaction, or not.
    Autocommit(bool),
    /// Read the catalog: the rows of a query with text parameters, at
    /// most `cap` of them.
    Catalog { sql: String, params: Vec<String>, cap: u32 },
    /// The columns a statement would give, prepared and let go, not run.
    Describe(String),
    /// A large object of a result, read whole for a viewer.
    Value { result: ResultId, row: u64, column: usize },
    /// A query's rows written to a file as they come, as CSV or native.
    Export { sql: String, path: PathBuf, format: ExportFormat },
    /// A query's rows appended to a script as INSERTs, each begun `prefix`.
    ScriptRows { sql: String, prefix: String, path: PathBuf },
    /// A file's rows imported into a table, cancelled when `stop` is set,
    /// its progress told to `tell`.
    Import { spec: Box<ImportSpec>, stop: Arc<std::sync::atomic::AtomicBool>, tell: Teller },
    /// Ask whether the server answers.
    Ping,
    /// End the connection, and the worker.
    Terminate,
}

/// What a worker answers.
#[derive(Debug)]
pub(crate) enum Reply {
    Ran(Box<Ran>),
    Rows(Vec<Vec<crate::connections::cells::Cell>>),
    Columns(Vec<ColumnInfo>),
    Types(Vec<String>),
    Value(ValueRead),
    Exported(u64),
    Imported(ImportReport),
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

/// `values`, as text or null, each cast to the type of `statement`'s
/// parameter in its place ([DOC sql/statements/prepare.md DESCRIPTION]).
///
/// # Errors
///
/// SQLCODE -910 if they are not as many as its parameters; the cast's
/// failure, as SQLSTATE 22018 of a value no number.
fn bound(connection: &mut Connected, statement: &Statement, values: &[Option<String>]) -> Result<Vec<Value>> {
    let types = statement.parameters();
    if types.len() != values.len() {
        return Err(StudioError::misuse(format!(
            "[DESIGN] the statement has {} parameters, and {} values were given",
            types.len(),
            values.len()
        )));
    }
    let mut write = |kind: LobKind, octets: &[u8]| -> Result<Lob> {
        let mut writer = connection.create_lob(kind)?;
        for chunk in octets.chunks(usize::try_from(CHUNK_BYTES).unwrap_or(usize::MAX)) {
            std::io::Write::write_all(&mut writer, chunk)
                .map_err(|e| StudioError::misuse(format!("[DESIGN] the value could not be written: {e}")))?;
        }
        writer.finish().map_err(StudioError::from)
    };
    types
        .iter()
        .zip(values)
        .map(|(parameter, value)| match value {
            None => Ok(Value::Null),
            Some(text) => parameter_value(&parameter.clone().data_type(), text, &mut write),
        })
        .collect()
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
            Request::Run { sql, read_only, values } => {
                if read_only {
                    self.begin_read_only()?;
                }
                self.run(&sql, &values).map(|ran| Reply::Ran(Box::new(ran)))
            }
            Request::Parameters(sql) => self.parameters(&sql).map(Reply::Types),
            Request::Rows { result, from, count } => self.rows(result, from, count).map(Reply::Page),
            Request::CloseResult(result) => self.close_result(result).map(|()| Reply::Done),
            Request::Session => self.session().map(Reply::Session),
            Request::Autocommit(on) => {
                self.connection()?.set_autocommit(on);
                self.session().map(Reply::Session)
            }
            Request::Ping => self.connection()?.ping().map(|()| Reply::Done).map_err(StudioError::from),
            Request::Catalog { sql, params, cap } => self.catalog(&sql, &params, cap).map(Reply::Rows),
            Request::Describe(sql) => self.describe(&sql).map(Reply::Columns),
            Request::Value { result, row, column } => self.value(result, row, column).map(Reply::Value),
            Request::Export { sql, path, format } => self.export(&sql, &path, format).map(Reply::Exported),
            Request::ScriptRows { sql, prefix, path } => self.script_rows(&sql, &prefix, &path).map(Reply::Exported),
            Request::Import { spec, stop, tell } => {
                let watch = Watch { stop: &stop, tell: &*tell.0 };
                run_import(self.connection()?, &spec, Some(&watch)).map(Reply::Imported)
            }
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
    fn run(&mut self, sql: &str, values: &[Option<String>]) -> Result<Ran> {
        let connection = self.connection()?;
        let _ = connection.take_conditions(); // Those of an earlier statement are not this one's.
        let (outcome, told) = match connection.prepare(sql) {
            Ok(statement) => {
                let values = match bound(connection, &statement, values) {
                    Ok(values) => values,
                    Err(failure) => {
                        let _ = self.connection()?.deallocate(statement); // Let go; the failure is the one told.
                        return Err(failure);
                    }
                };
                if statement.columns().is_empty() { self.execute(statement, &values)? } else { self.open(statement, &values)? }
            }
            Err(failure) if failure.sqlstate == NOT_PREPARABLE && values.is_empty() => self.direct(sql)?,
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
    fn execute(&mut self, statement: Statement, values: &[Value]) -> Result<(Outcome, Told)> {
        let connection = self.connection()?;
        let executed = connection.execute(&statement, values);
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
    fn open(&mut self, statement: Statement, values: &[Value]) -> Result<(Outcome, Told)> {
        let batch = match self.connection()?.open_cursor(&statement, values, PAGE_ROWS) {
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

    /// The rows of the catalog's query `sql`, its parameters `params` as
    /// character strings, at most `cap` of them, read through a cursor
    /// closed after (R-SAFE-1).
    fn catalog(&mut self, sql: &str, params: &[String], cap: u32) -> Result<Vec<Vec<crate::connections::cells::Cell>>> {
        let connection = self.connection()?;
        let statement = connection.prepare(sql)?;
        let values: Vec<Value> = params.iter().map(|p| Value::Char(p.clone())).collect();
        let read = connection.open_cursor(&statement, &values, cap);
        if read.as_ref().is_ok_and(|batch| batch.more) {
            // Rows past the cap are not wanted: the cursor is closed.
            let _ = connection.close(&statement);
        }
        let _ = connection.deallocate(statement); // Let go; the rows, or the failure, are what is told.
        Ok(read?.rows.iter().map(crate::connections::cells::cells).collect())
    }

    /// The large object of `result`'s row `row`, column `column`, that came
    /// by its locator, read a chunk at a time, at most `MAX_VALUE_BYTES`.
    fn value(&mut self, result: ResultId, row: u64, column: usize) -> Result<ValueRead> {
        let Worker { connection, results, .. } = self;
        let connection = connection.as_mut().ok_or_else(|| StudioError::lost("[DESIGN] the connection is ended"))?;
        let open = results.get(&result).ok_or_else(|| StudioError::misuse(format!("[DESIGN] result {result} is not open")))?;
        let lob = open.pages.lob(row, column).ok_or_else(|| StudioError::misuse("[DESIGN] the value came whole, in its row"))?;
        let wanted = crate::connections::values::wanted(lob);
        let mut bytes = Vec::new();
        while u64::try_from(bytes.len()).unwrap_or(u64::MAX) < wanted {
            let from = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
            let count = wanted.saturating_sub(from).min(CHUNK_BYTES);
            let chunk = connection.read_lob(lob, (from, count), false)?;
            if chunk.is_empty() {
                break;
            }
            bytes.extend(chunk);
        }
        Ok(crate::connections::values::read(lob, &bytes))
    }

    /// Runs the query `sql` and writes its rows to `path` as `format` says,
    /// as they come: how many.
    fn export(&mut self, sql: &str, path: &std::path::Path, format: ExportFormat) -> Result<u64> {
        let mut file = std::fs::File::create(path).map_err(|e| StudioError::misuse(format!("[DESIGN] {}: {e}", path.display())))?;
        let connection = self.connection()?;
        connection.export(sql, &mut file, format).map_err(StudioError::from)
    }

    /// Appends the rows of the query `sql` to the script at `path` as
    /// INSERTs begun `prefix`, as they come: how many.
    fn script_rows(&mut self, sql: &str, prefix: &str, path: &std::path::Path) -> Result<u64> {
        let mut file = crate::connections::scripted::appended(path)?;
        let mut writer = crate::connections::scripted::InsertWriter::new(&mut file, prefix);
        match self.connection()?.query_into(sql, &mut writer)? {
            turborel_client::connection::Streamed::Rows(_) => writer.finish(),
            turborel_client::connection::Streamed::Done(_) => Err(StudioError::misuse("[DESIGN] a table's rows are read by a query")),
        }
    }

    /// The types of `sql`'s dynamic parameters, in order, as SQL writes
    /// them, prepared and let go, never run.
    fn parameters(&mut self, sql: &str) -> Result<Vec<String>> {
        let connection = self.connection()?;
        let statement = connection.prepare(sql)?;
        let types = statement.parameters().iter().map(|p| p.clone().data_type().to_string()).collect();
        let _ = connection.deallocate(statement); // Let go; the types are what is told.
        Ok(types)
    }

    /// The columns `sql` would give, as the server declares them, prepared
    /// and let go, never run.
    fn describe(&mut self, sql: &str) -> Result<Vec<ColumnInfo>> {
        let connection = self.connection()?;
        let statement = connection.prepare(sql)?;
        let columns = statement.columns().iter().map(ColumnInfo::from).collect();
        let _ = connection.deallocate(statement); // Let go; the columns are what is told.
        Ok(columns)
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
