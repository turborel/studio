//! An embedded database's worker (RULES.md D24, D59): the thread that owns
//! the session of one embedded database, takes the same requests as a
//! server connection's worker in turn, and answers each as that worker
//! does, by the embedded library's calls: a query prepared and read
//! through its cursor a page at a time, its large objects placed as a
//! server places them; another statement executed, or run directly; the
//! session's state read of the session itself. Autocommit commits each
//! statement's transaction as it completes, a query's once its cursor is
//! read through or closed.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc::Receiver;

use turborel::ast::AccessMode;
use turborel::db::{Completion, Cursor, Direct, Prepared, Session};
use turborel::storage::Row;
use turborel::value::Value;
use turborel::value::lob::{Lob, LobKind};
use turborel_protocol::{Column, Completed};

use crate::connections::cells::{Cell, ColumnInfo, ParameterInfo, cells};
use crate::connections::outcome::{Outcome, Ran, ResultId};
use crate::connections::pages::{PAGE_ROWS, Page, Pages};
use crate::connections::session::{SessionState, Transaction, Transport};
use crate::connections::values::{CHUNK_BYTES, ValueRead, parameter_value};
use crate::connections::worker::{Job, Reply, Request};
use crate::embedded::Embedded;
use crate::embedded::lobs::placed_row;
use crate::embedded::transfer::{export, import, script_rows};
use crate::error::{Result, StudioError};

/// The SQLSTATE of a statement that cannot be prepared, a rule broken or
/// no `<preparable statement>`, run directly instead, its own failure then
/// the one told.
const NOT_PREPARABLE: &str = "42000";
/// What makes the next transaction of a read-only connection READ ONLY.
const SET_READ_ONLY: &str = "SET TRANSACTION READ ONLY";
/// The setting of the catalog's name.
const CATALOG_NAME: &str = "CATALOG.NAME";
/// The first words of the statements whose rows changed are told.
const CHANGES: [&str; 4] = ["INSERT", "UPDATE", "DELETE", "MERGE"];

/// A result kept: its pages, and its cursor, while it has more, with the
/// row read past the last given, by which it is known to have more.
struct OpenResult {
    cursor: Option<Cursor>,
    ahead: Option<Row>,
    pages: Pages,
}

/// An embedded database's worker.
pub(crate) struct EmbeddedWorker {
    database: Arc<Embedded>,
    session: Option<Session>,
    autocommit: bool,
    results: BTreeMap<ResultId, OpenResult>,
    next_result: ResultId,
    spool: PathBuf,
}

/// The failure of `e`, the session's transaction told active or not.
fn failed(session: &Session, e: impl Into<StudioError>) -> StudioError {
    let mut error = e.into();
    error.active = session.transaction_mode().is_some();
    error
}

/// Up to `count` rows of `cursor`, each placed for `session`, `ahead` the
/// row read past the last before: and whether there are more, the row
/// read past them kept in `ahead`.
fn read(session: &Session, cursor: &mut Cursor, ahead: &mut Option<Row>, count: usize) -> Result<(Vec<Row>, bool)> {
    let mut rows = Vec::new();
    loop {
        let next = match ahead.take() {
            Some(row) => Some(row),
            None => cursor.fetch()?,
        };
        let Some(row) = next else { return Ok((rows, false)) };
        if rows.len() == count {
            *ahead = Some(row);
            return Ok((rows, true));
        }
        rows.push(placed_row(session, row)?);
    }
}

/// The columns of `of`, as the grid shows them, each with its declared type.
fn columns_of(of: &[turborel::binder::OutColumn]) -> Vec<ColumnInfo> {
    of.iter().map(|c| ColumnInfo::from(&Column::from(c).with_declared())).collect()
}

/// Whether `sql` changes rows, and so its count is told.
fn changes_rows(sql: &str) -> bool {
    let first = sql.trim_start().split(|c: char| !c.is_ascii_alphabetic()).next().unwrap_or_default().to_ascii_uppercase();
    CHANGES.contains(&first.as_str())
}

impl EmbeddedWorker {
    /// The worker of a session of `database`, its results spooled in `spool`.
    pub(crate) fn new(database: Arc<Embedded>, spool: PathBuf) -> EmbeddedWorker {
        let session = database.db.session(&database.user);
        EmbeddedWorker { database, session: Some(session), autocommit: false, results: BTreeMap::new(), next_result: 1, spool }
    }

    /// What cancels the session's statements.
    pub(crate) fn stop(&self) -> Option<Arc<turborel::txn::Stop>> {
        self.session.as_ref().map(Session::canceller)
    }

    /// Answers each job until Terminate, or until no one can ask more.
    pub(crate) fn serve(mut self, jobs: &Receiver<Job>) {
        while let Ok((request, reply)) = jobs.recv() {
            let ending = matches!(request, Request::Terminate);
            let answer = self.answer(request);
            // A caller that stopped waiting needs no answer.
            let _ = reply.send(answer);
            if ending {
                return;
            }
        }
        self.terminate();
    }

    /// The session, while it is not ended.
    fn session(&self) -> Result<&Session> {
        self.session.as_ref().ok_or_else(|| StudioError::lost("[DESIGN] the session is ended"))
    }

    /// The session's state, as the status bar shows it.
    pub(crate) fn state(&self) -> Result<SessionState> {
        let session = self.session()?;
        let mode = session.transaction_mode();
        let catalog = session.setting(CATALOG_NAME).ok().filter(|v| !v.is_null()).map(|v| v.to_string());
        Ok(SessionState {
            server: format!("{} (embedded)", turborel::product()),
            authorization: session.current_authorization(),
            schema: Some(session.default_schema()),
            catalog,
            transaction: Transaction {
                active: mode.is_some(),
                autocommit: self.autocommit,
                read_only: mode.is_some_and(|m| m.access == AccessMode::ReadOnly),
            },
            server_read_only: !session.takes_changes(),
            owner: session.is_owner(),
            transport: if self.database.in_memory() { Transport::InMemory } else { Transport::Embedded },
            lost: false,
        })
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
            Request::Parameters(sql) => self.parameters(&sql).map(Reply::Parameters),
            Request::Rows { result, from, count } => self.rows(result, from, count).map(Reply::Page),
            Request::CloseResult(result) => self.close_result(result).map(|()| Reply::Done),
            Request::Session => self.state().map(Reply::Session),
            Request::Autocommit(on) => {
                self.autocommit = on;
                self.state().map(Reply::Session)
            }
            Request::Ping => self.session().map(|_| Reply::Done),
            Request::Catalog { sql, params, cap } => self.catalog(&sql, &params, cap).map(Reply::Rows),
            Request::Describe(sql) => self.describe(&sql).map(Reply::Columns),
            Request::Value { result, row, column } => self.value(result, row, column).map(Reply::Value),
            Request::Export { sql, path, format } => {
                let mut file =
                    std::fs::File::create(&path).map_err(|e| StudioError::misuse(format!("[DESIGN] {}: {e}", path.display())))?;
                let session = self.session()?;
                export(session, &sql, &mut file, format).map(Reply::Exported).map_err(|e| failed(session, e))
            }
            Request::ScriptRows { sql, prefix, path } => {
                let session = self.session()?;
                script_rows(session, &sql, &prefix, &path).map(Reply::Exported).map_err(|e| failed(session, e))
            }
            Request::Import { spec, stop, tell } => {
                let session = self.session()?;
                let watch = crate::connections::imports::Watch { stop: &stop, tell: &*tell.0 };
                import(session, &spec, Some(&watch)).map(Reply::Imported).map_err(|e| failed(session, e))
            }
            Request::Terminate => {
                self.terminate();
                Ok(Reply::Done)
            }
        }
    }

    /// Makes the next transaction READ ONLY, unless one is active.
    fn begin_read_only(&self) -> Result<()> {
        let session = self.session()?;
        if session.transaction_mode().is_none() {
            session.run(SET_READ_ONLY).map_err(|e| failed(session, e))?;
        }
        Ok(())
    }

    /// Commits the session's transaction, where autocommit says and no
    /// result's cursor reads in it.
    fn autocommitted(&self) -> Result<()> {
        let session = self.session()?;
        let reading = self.results.values().any(|r| r.cursor.is_some());
        if self.autocommit && !reading && session.transaction_mode().is_some() {
            session.commit().map_err(|e| failed(session, e))?;
        }
        Ok(())
    }

    /// `values`, as text or null, each cast to the type of `prepared`'s
    /// input parameter in its place: of a CALL, the IN and INOUT ones, not
    /// the OUT ones, whose values its row gives back.
    fn bound(&self, prepared: &Prepared, values: &[Option<String>]) -> Result<Vec<Value>> {
        let session = self.session()?;
        let types = prepared.inputs();
        if types.len() != values.len() {
            return Err(StudioError::misuse(format!(
                "[DESIGN] the statement has {} parameters, and {} values were given",
                types.len(),
                values.len()
            )));
        }
        let mut write = |kind: LobKind, octets: &[u8]| -> Result<Lob> {
            let locator = session.create_lob(kind);
            for chunk in octets.chunks(usize::try_from(CHUNK_BYTES).unwrap_or(usize::MAX)) {
                session.append_lob(locator, chunk)?;
            }
            let chars = match kind {
                LobKind::Character => u64::try_from(String::from_utf8_lossy(octets).chars().count()).unwrap_or(u64::MAX),
                LobKind::Binary => 0,
            };
            Ok(Lob::of_locator(kind, locator, (u64::try_from(octets.len()).unwrap_or(u64::MAX), chars)))
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

    /// Runs `sql`: a query through its cursor, another statement executed,
    /// one that cannot be prepared run directly.
    fn run(&mut self, sql: &str, values: &[Option<String>]) -> Result<Ran> {
        let session = self.session()?;
        let (outcome, warnings) = match session.prepare(sql) {
            Ok(prepared) => {
                let values = self.bound(&prepared, values)?;
                if prepared.is_query() { self.open(&prepared, &values)? } else { self.execute(sql, &prepared, &values)? }
            }
            Err(e) if e.sqlstate().as_str() == NOT_PREPARABLE && values.is_empty() => self.direct(sql)?,
            Err(e) => return Err(failed(session, e)),
        };
        self.autocommitted()?;
        Ok(Ran { outcome, warnings, server_time: None, session: self.state()? })
    }

    /// The warning of `completion`, if it is one.
    fn warned(completion: Completion) -> Vec<StudioError> {
        match completion {
            Completion::Warning(state) => vec![StudioError::new(0, state.as_str(), format!("a warning, SQLSTATE {}", state.as_str()))],
            Completion::Success | Completion::NoData => Vec::new(),
        }
    }

    /// Executes `prepared`, not a query: its completion, or a CALL's output
    /// parameters as a row.
    fn execute(&mut self, sql: &str, prepared: &Prepared, values: &[Value]) -> Result<(Outcome, Vec<StudioError>)> {
        let session = self.session()?;
        let (done, outputs) = session.execute_prepared_out(prepared, values).map_err(|e| failed(session, e))?;
        if prepared.has_outputs() {
            let row = placed_row(session, outputs)?;
            let pages = Pages::new(&self.spool, &[row], false)?;
            let columns = columns_of(prepared.columns());
            return Ok((self.keep(None, None, pages, columns)?, Self::warned(done)));
        }
        Ok((self.done(sql, done)?, Self::warned(done)))
    }

    /// The outcome of `done`, a statement's completion.
    fn done(&self, sql: &str, done: Completion) -> Result<Outcome> {
        let session = self.session()?;
        let rows = changes_rows(sql).then(|| u64::try_from(session.row_count()).unwrap_or(u64::MAX));
        let generated: Vec<String> = session.generated().iter().map(ToString::to_string).collect();
        Ok(Outcome::done(&Completed::from(done), rows, &generated))
    }

    /// Opens `prepared`'s cursor, a query, and keeps its result.
    fn open(&mut self, prepared: &Prepared, values: &[Value]) -> Result<(Outcome, Vec<StudioError>)> {
        let session = self.session()?;
        let cursor = session.open_prepared(prepared, values).map_err(|e| failed(session, e))?;
        let warnings = session.warning().map(Completion::Warning).map(Self::warned).unwrap_or_default();
        let columns = columns_of(&cursor.columns);
        Ok((self.kept(cursor, columns)?, warnings))
    }

    /// Runs `sql` directly, as a statement that cannot be prepared is.
    fn direct(&mut self, sql: &str) -> Result<(Outcome, Vec<StudioError>)> {
        let session = self.session()?;
        match session.direct(sql).map_err(|e| failed(session, e))? {
            Direct::Rows(cursor) => {
                let columns = columns_of(&cursor.columns);
                Ok((self.kept(cursor, columns)?, Vec::new()))
            }
            Direct::Done(done) => Ok((self.done(sql, done)?, Self::warned(done))),
        }
    }

    /// Keeps `cursor`'s result, its first page read.
    fn kept(&mut self, mut cursor: Cursor, columns: Vec<ColumnInfo>) -> Result<Outcome> {
        let session = self.session()?;
        let mut ahead = None;
        let (rows, more) =
            read(session, &mut cursor, &mut ahead, usize::try_from(PAGE_ROWS).unwrap_or(usize::MAX)).map_err(|e| failed(session, e))?;
        let pages = Pages::new(&self.spool, &rows, more)?;
        self.keep(more.then_some(cursor), ahead, pages, columns)
    }

    /// Keeps a result of `pages`, its cursor `cursor`'s if it has more.
    fn keep(&mut self, cursor: Option<Cursor>, ahead: Option<Row>, mut pages: Pages, columns: Vec<ColumnInfo>) -> Result<Outcome> {
        let result = self.next_result;
        self.next_result = self.next_result.saturating_add(1);
        let page = pages.rows(0, PAGE_ROWS, &mut || Err(StudioError::misuse("[DESIGN] the first page is read")))?;
        self.results.insert(result, OpenResult { cursor, ahead, pages });
        Ok(Outcome::Rows { result, columns, page })
    }

    /// Rows of `result`, fetched as far as they are asked for.
    fn rows(&mut self, result: ResultId, from: u64, count: u32) -> Result<Page> {
        let EmbeddedWorker { session, results, .. } = self;
        let session = session.as_ref().ok_or_else(|| StudioError::lost("[DESIGN] the session is ended"))?;
        let open = results.get_mut(&result).ok_or_else(|| StudioError::misuse(format!("[DESIGN] result {result} is not open")))?;
        let OpenResult { cursor, ahead, pages } = open;
        let page = pages.rows(from, count, &mut || {
            let cursor = cursor.as_mut().ok_or_else(|| StudioError::misuse("[DESIGN] the result is read whole"))?;
            read(session, cursor, ahead, usize::try_from(PAGE_ROWS).unwrap_or(usize::MAX))
        })?;
        if !open.pages.read().1 {
            open.cursor = None;
            self.autocommitted()?;
        }
        Ok(page)
    }

    /// Closes `result`, its cursor with it.
    fn close_result(&mut self, result: ResultId) -> Result<()> {
        self.results.remove(&result).ok_or_else(|| StudioError::misuse(format!("[DESIGN] result {result} is not open")))?;
        self.autocommitted()
    }

    /// The rows of the catalog's query `sql`, its parameters `params` as
    /// character strings, at most `cap` of them; the transaction it began
    /// for itself ended.
    fn catalog(&self, sql: &str, params: &[String], cap: u32) -> Result<Vec<Vec<Cell>>> {
        let session = self.session()?;
        let began = session.transaction_mode().is_none();
        let read_rows = || -> Result<Vec<Vec<Cell>>> {
            let prepared = session.prepare(sql)?;
            let values: Vec<Value> = params.iter().map(|p| Value::Char(p.clone().into())).collect();
            let mut cursor = session.open_prepared(&prepared, &values)?;
            let mut rows = Vec::new();
            while u32::try_from(rows.len()).unwrap_or(u32::MAX) < cap {
                let Some(row) = cursor.fetch()? else { break };
                rows.push(cells(&row));
            }
            Ok(rows)
        };
        let rows = read_rows();
        if began && session.transaction_mode().is_some() {
            let _ = session.rollback(); // It read alone: nothing of it is kept.
        }
        rows.map_err(|e| failed(session, e))
    }

    /// The large object of `result`'s row `row`, column `column`, placed by
    /// its locator, read a chunk at a time, at most `MAX_VALUE_BYTES`.
    fn value(&self, result: ResultId, row: u64, column: usize) -> Result<ValueRead> {
        let session = self.session()?;
        let open = self.results.get(&result).ok_or_else(|| StudioError::misuse(format!("[DESIGN] result {result} is not open")))?;
        let lob = open.pages.lob(row, column).ok_or_else(|| StudioError::misuse("[DESIGN] the value came whole, in its row"))?;
        let locator = lob.locator().ok_or_else(|| StudioError::misuse("[DESIGN] the value came whole, in its row"))?;
        let wanted = crate::connections::values::wanted(lob);
        let mut bytes = Vec::new();
        while u64::try_from(bytes.len()).unwrap_or(u64::MAX) < wanted {
            let from = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
            let count = wanted.saturating_sub(from).min(CHUNK_BYTES);
            let chunk = session.read_lob(locator, (from, count), false).map_err(|e| failed(session, e))?;
            if chunk.is_empty() {
                break;
            }
            bytes.extend(chunk);
        }
        Ok(crate::connections::values::read(lob, &bytes))
    }

    /// `sql`'s dynamic parameters, in order, each its type, mode and
    /// position, prepared, never run.
    fn parameters(&self, sql: &str) -> Result<Vec<ParameterInfo>> {
        let session = self.session()?;
        let prepared = session.prepare(sql).map_err(|e| failed(session, e))?;
        Ok(prepared.parameters().iter().map(ParameterInfo::from).collect())
    }

    /// The columns `sql` would give, prepared, never run.
    fn describe(&self, sql: &str) -> Result<Vec<ColumnInfo>> {
        let session = self.session()?;
        let prepared = session.prepare(sql).map_err(|e| failed(session, e))?;
        Ok(columns_of(prepared.columns()))
    }

    /// Ends the session: its results let go, an open transaction rolled
    /// back, as the window asked about it before.
    fn terminate(&mut self) {
        self.results.clear();
        if let Some(session) = self.session.take()
            && session.transaction_mode().is_some()
        {
            let _ = session.rollback(); // The window asked first; what is left is undone.
        }
    }
}
