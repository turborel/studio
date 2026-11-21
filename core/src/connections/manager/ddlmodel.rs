//! A DDL script imported into a schema model (RULES.md D64): the `.sql`
//! file's definitions run, statement by statement, in an in-memory
//! database of its own, so Turborel's own parser and binder read each as
//! the server would, and the model read back of its catalog as of a live
//! schema. What is not a table's definition is left out of the model and
//! listed by its line, with why: a statement of data, of privileges or of
//! the server, never run; a definition of another kind, run, as a table
//! may need it, but not modeled; and a statement the database refuses,
//! with its refusal. Nothing is guessed.

use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use serde::Serialize;

use super::{ConnectionManager, RunAnswer};
use crate::embedded::{EmbeddedSpec, Place};
use crate::error::{Result, StudioError};
use crate::events::ConnectionId;
use crate::guard::classify::{Class, classify};
use crate::guard::policy::Guards;
use crate::worksheet::sqlfile::{FileStatement, MAX_LISTED, Statements, code_start, shown};

/// The most statements a DDL script imported into a model may hold.
pub const MAX_DDL_STATEMENTS: u64 = 100_000;

/// The kinds of definition a model holds: tables and their indexes, and
/// the schemas they are in.
const MODELED: [&str; 3] = ["TABLE", "INDEX", "SCHEMA"];

/// A statement left out of the model: its line, its text cut, and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeftOut {
    /// The line it begins on.
    pub line: u64,
    /// Its text, cut.
    pub statement: String,
    /// Why it is left out.
    pub why: String,
}

/// What a script's import into a model made: the in-memory database it
/// was run in, to read the model of and close; the schemas of its tables;
/// and what was left out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DdlModel {
    /// The connection to the in-memory database, which the caller closes.
    pub connection: ConnectionId,
    /// The schemas its tables are in, by name.
    pub schemas: Vec<String>,
    /// The statements of the script.
    pub statements: u64,
    /// The first `MAX_LISTED` statements left out.
    pub left_out: Vec<LeftOut>,
    /// The statements left out in all.
    pub left_out_count: u64,
}

/// The schemas of base tables of a database: those of the script's are
/// those it has after the script ran and had not before.
const SCHEMAS: &str = "SELECT DISTINCT TABLE_SCHEMA FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA";

/// What a statement of `text` defines, by its first words: the word after
/// CREATE, ALTER or DROP, past OR REPLACE, GLOBAL or LOCAL TEMPORARY and
/// UNIQUE; none of another statement.
fn defines(text: &str) -> Option<(String, String)> {
    let code = text.get(code_start(text)..).unwrap_or_default();
    let mut words = code.split(|c: char| c.is_whitespace() || c == '(').filter(|w| !w.is_empty()).map(str::to_ascii_uppercase);
    let verb = words.next()?;
    if !matches!(verb.as_str(), "CREATE" | "ALTER" | "DROP") {
        return None;
    }
    let what = words.find(|w| !matches!(w.as_str(), "OR" | "REPLACE" | "GLOBAL" | "LOCAL" | "TEMPORARY" | "UNIQUE"))?;
    Some((verb, what))
}

/// Why `s` is left out of a model, if it is, and whether it is run all
/// the same, as a definition a table may need.
fn judged(s: &FileStatement) -> (Option<String>, bool) {
    let class = classify(&s.text).class;
    match class {
        Class::ChangeSchema => match defines(&s.text) {
            Some((verb, what)) if MODELED.contains(&what.as_str()) || verb == "DROP" => (None, true),
            Some((_, what)) => (Some(format!("a definition of a {}, which a model does not hold", what.to_ascii_lowercase())), true),
            None => (Some("a definition a model does not hold".to_owned()), true),
        },
        Class::Session | Class::Transaction => (None, true),
        Class::Read | Class::WriteRows => (Some("a statement of data, not a definition: not run".to_owned()), false),
        Class::Security => (Some("a statement of privileges or users: not run".to_owned()), false),
        Class::Administration => (Some("a statement of the database or the server: not run".to_owned()), false),
        // A definition Studio cannot classify is run all the same: the
        // database reads it, and refuses it if it cannot.
        Class::Unclassified => match defines(&s.text) {
            Some((verb, what)) if MODELED.contains(&what.as_str()) || verb == "DROP" => (None, true),
            Some((_, what)) => (Some(format!("a definition of a {}, which a model does not hold", what.to_ascii_lowercase())), true),
            None => (Some("a statement Studio cannot classify: not run".to_owned()), false),
        },
    }
}

impl ConnectionManager {
    /// Imports the DDL script at `path` into a model: its definitions run
    /// in an in-memory database, its unqualified names of `schema`, made
    /// if it is not; what the caller reads the model of, then closes.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the file cannot be read or is not text Studio
    /// reads, holds more than `MAX_DDL_STATEMENTS` statements, or `schema`
    /// cannot be made; the in-memory database's failure to open.
    pub fn ddl_model(&self, path: &Path, schema: &str) -> Result<DdlModel> {
        let spec =
            EmbeddedSpec { place: Place::Memory, create: true, keys: None, checksum_key: None, plugin_directories: None, user: None };
        let id = self.open_embedded(&spec, Guards::default())?.connection;
        let made = self.run_definitions(id, path, schema);
        if made.is_err() {
            let _ = self.close(id); // The failure told is the import's.
        }
        made
    }

    /// Runs the definitions of the script at `path` on `id`, as `ddl_model`.
    fn run_definitions(&self, id: ConnectionId, path: &Path, schema: &str) -> Result<DdlModel> {
        // Each definition its own transaction, as CREATE INDEX runs alone.
        self.set_autocommit(id, true)?;
        let before = self.table_schemas(id)?;
        let name = format!("\"{}\"", schema.replace('"', "\"\""));
        if !schema.is_empty() {
            let _ = self.run(id, &format!("CREATE SCHEMA {name}"), true); // It may be the session's own already.
            self.run(id, &format!("SET SCHEMA '{}'", schema.replace('\'', "''")), true)?;
        }
        let file = File::open(path).map_err(|e| StudioError::misuse(format!("[DESIGN] {}: {e}", path.display())))?;
        let mut statements = Statements::new(BufReader::new(file));
        let mut model = DdlModel { connection: id, schemas: Vec::new(), statements: 0, left_out: Vec::new(), left_out_count: 0 };
        while let Some(s) = statements.next_statement()? {
            model.statements = model.statements.saturating_add(1);
            if model.statements > MAX_DDL_STATEMENTS {
                return Err(StudioError::misuse(format!(
                    "[DESIGN] a script imported into a model holds at most {MAX_DDL_STATEMENTS} statements"
                )));
            }
            let (why, run) = judged(&s);
            let refused = if run {
                match self.run(id, &s.text, true) {
                    Ok(RunAnswer::Ran(_) | RunAnswer::Confirm(_)) => None,
                    Err(e) => Some(format!("refused: SQLSTATE {}: {}", e.sqlstate, e.message)),
                }
            } else {
                None
            };
            if let Some(why) = refused.or(why) {
                model.left_out_count = model.left_out_count.saturating_add(1);
                if model.left_out.len() < MAX_LISTED {
                    model.left_out.push(LeftOut { line: s.line, statement: shown(&s.text), why });
                }
            }
        }
        let _ = self.run(id, "COMMIT", true); // What a script's own transaction left open is kept.
        model.schemas = self.table_schemas(id)?.into_iter().filter(|s| !before.contains(s)).collect();
        Ok(model)
    }

    /// The schemas of base tables of the database of `id`.
    fn table_schemas(&self, id: ConnectionId) -> Result<Vec<String>> {
        Ok(self.catalog(id, SCHEMAS, (&[], 1000))?.into_iter().filter_map(|row| row.into_iter().next().flatten()).collect())
    }
}
