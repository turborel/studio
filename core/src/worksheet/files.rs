//! The worksheets kept between sessions, and the favourite queries
//! (RULES.md D36, R-FMT-1): each a file of format 1 in the application's
//! configuration, its owner's alone. A worksheet keeps its text, so one
//! not saved to a file of its own comes back after a crash or a restart.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Result, StudioError};
use crate::store::{self, FORMAT};

/// The worksheets' file.
pub const WORKSHEETS_FILE: &str = "worksheets.json";
/// The favourite queries' file.
pub const QUERIES_FILE: &str = "queries.json";
/// The most worksheets kept.
pub const MAX_WORKSHEETS: usize = 200;
/// The most favourite queries kept.
pub const MAX_QUERIES: usize = 1000;
/// The longest text of a worksheet or a query, in bytes.
pub const MAX_TEXT_BYTES: usize = 16 * 1024 * 1024;
/// The longest the worksheets' file may be, in bytes.
const MAX_WORKSHEETS_FILE_BYTES: u64 = 256 * 1024 * 1024;
/// The longest the queries' file may be, in bytes.
const MAX_QUERIES_FILE_BYTES: u64 = 64 * 1024 * 1024;
/// The longest identifier, title or name, in characters.
const MAX_NAME_CHARS: usize = 200;
/// The longest path of a file, in characters.
const MAX_PATH_CHARS: usize = 4096;

/// A worksheet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Worksheet {
    /// Its identifier.
    pub id: String,
    /// Its title, as its tab shows it.
    pub title: String,
    /// Its text.
    pub text: String,
    /// The saved connection it runs on, if it names one.
    pub connection: Option<String>,
    /// Whether its tab is pinned, so closing the others leaves it.
    pub pinned: bool,
    /// The file it was saved to or opened from, if any.
    pub path: Option<String>,
    /// Whether its text has changed since that file was written.
    pub modified: bool,
}

/// A favourite query.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Query {
    /// Its identifier.
    pub id: String,
    /// Its name.
    pub name: String,
    /// Its text.
    pub sql: String,
}

/// The worksheets' file.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorksheetsFile {
    format: u32,
    worksheets: Vec<Worksheet>,
}

/// The queries' file.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct QueriesFile {
    format: u32,
    queries: Vec<Query>,
}

/// `value` refused if empty, longer than `max` characters, or holding a
/// control character.
fn named(what: &str, value: &str, max: usize) -> Result<()> {
    if value.is_empty() || value.chars().count() > max || value.chars().any(char::is_control) {
        return Err(StudioError::misuse(format!("[DESIGN] {what} is 1 to {max} characters, none a control")));
    }
    Ok(())
}

/// `text` refused if longer than `MAX_TEXT_BYTES`.
fn bounded(text: &str) -> Result<()> {
    if text.len() > MAX_TEXT_BYTES {
        return Err(StudioError::misuse(format!("[DESIGN] a worksheet's text is at most {MAX_TEXT_BYTES} bytes")));
    }
    Ok(())
}

impl Worksheet {
    /// Checks the worksheet's bounds.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of a field out of its bounds.
    pub fn validate(&self) -> Result<()> {
        named("a worksheet's identifier", &self.id, MAX_NAME_CHARS)?;
        named("a worksheet's title", &self.title, MAX_NAME_CHARS)?;
        bounded(&self.text)?;
        if let Some(connection) = &self.connection {
            named("a worksheet's connection", connection, MAX_NAME_CHARS)?;
        }
        if let Some(path) = &self.path {
            named("a worksheet's file", path, MAX_PATH_CHARS)?;
        }
        Ok(())
    }
}

/// The worksheets and favourite queries, in a directory of the user's own.
#[derive(Debug, Clone)]
pub struct Kept {
    dir: PathBuf,
}

impl Kept {
    /// The worksheets and queries kept in `dir`.
    pub fn new(dir: &Path) -> Self {
        Kept { dir: dir.to_owned() }
    }

    /// The worksheets, as last kept.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the file cannot be read.
    pub fn worksheets(&self) -> Result<Vec<Worksheet>> {
        let file = store::read::<WorksheetsFile>(&self.dir.join(WORKSHEETS_FILE), MAX_WORKSHEETS_FILE_BYTES)?;
        Ok(file.map(|f| f.worksheets).unwrap_or_default())
    }

    /// Keeps `worksheets`, in their order, in place of those kept.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of too many, of one out of its bounds, or if the file
    /// cannot be written.
    pub fn keep_worksheets(&self, worksheets: Vec<Worksheet>) -> Result<()> {
        if worksheets.len() > MAX_WORKSHEETS {
            return Err(StudioError::misuse(format!("[DESIGN] at most {MAX_WORKSHEETS} worksheets are kept")));
        }
        worksheets.iter().try_for_each(Worksheet::validate)?;
        store::write(&self.dir.join(WORKSHEETS_FILE), &WorksheetsFile { format: FORMAT, worksheets })
    }

    /// The favourite queries.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the file cannot be read.
    pub fn queries(&self) -> Result<Vec<Query>> {
        Ok(store::read::<QueriesFile>(&self.dir.join(QUERIES_FILE), MAX_QUERIES_FILE_BYTES)?.map(|f| f.queries).unwrap_or_default())
    }

    /// Keeps `query`, in place of the one of its identifier, else last.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of a query out of its bounds, too many, or if the file
    /// cannot be read or written.
    pub fn keep_query(&self, query: Query) -> Result<Vec<Query>> {
        named("a query's identifier", &query.id, MAX_NAME_CHARS)?;
        named("a query's name", &query.name, MAX_NAME_CHARS)?;
        if query.sql.is_empty() {
            return Err(StudioError::misuse("[DESIGN] a favourite query has text"));
        }
        bounded(&query.sql)?;
        let mut queries = self.queries()?;
        let full = queries.len() >= MAX_QUERIES;
        match queries.iter_mut().find(|q| q.id == query.id) {
            Some(kept) => *kept = query,
            None if full => return Err(StudioError::misuse(format!("[DESIGN] at most {MAX_QUERIES} queries are kept"))),
            None => queries.push(query),
        }
        store::write(&self.dir.join(QUERIES_FILE), &QueriesFile { format: FORMAT, queries: queries.clone() })?;
        Ok(queries)
    }

    /// Forgets the query `id`, if kept.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the file cannot be read or written.
    pub fn forget_query(&self, id: &str) -> Result<Vec<Query>> {
        let queries: Vec<Query> = self.queries()?.into_iter().filter(|q| q.id != id).collect();
        store::write(&self.dir.join(QUERIES_FILE), &QueriesFile { format: FORMAT, queries: queries.clone() })?;
        Ok(queries)
    }
}

#[cfg(test)]
mod tests {
    use super::{Kept, MAX_WORKSHEETS, Query, Worksheet};
    use crate::testing::scratch;

    /// A worksheet `id`.
    fn worksheet(id: &str) -> Worksheet {
        Worksheet {
            id: id.into(),
            title: "Untitled".into(),
            text: "SELECT 1".into(),
            connection: Some("ab".into()),
            pinned: false,
            path: None,
            modified: true,
        }
    }

    /// [RULE] R-FMT-1 [DESIGN] D36: worksheets are kept whole and in order,
    /// in place of those kept before; too many, or one out of bounds, are
    /// refused.
    #[test]
    fn worksheets_come_back_as_kept() {
        let kept = Kept::new(&scratch("worksheets"));
        assert_eq!(kept.worksheets().unwrap(), Vec::new());
        kept.keep_worksheets(vec![worksheet("b"), worksheet("a")]).unwrap();
        assert_eq!(kept.worksheets().unwrap().iter().map(|w| w.id.as_str()).collect::<Vec<_>>(), ["b", "a"]);
        kept.keep_worksheets(vec![worksheet("c")]).unwrap();
        assert_eq!(kept.worksheets().unwrap().len(), 1);
        let many = (0..=MAX_WORKSHEETS).map(|i| worksheet(&i.to_string())).collect();
        assert_eq!(kept.keep_worksheets(many).unwrap_err().sqlstate, "TB910");
        let untitled = Worksheet { title: String::new(), ..worksheet("d") };
        assert_eq!(kept.keep_worksheets(vec![untitled]).unwrap_err().sqlstate, "TB910");
        let filed = Worksheet { path: Some("x\ny".into()), ..worksheet("e") };
        assert_eq!(kept.keep_worksheets(vec![filed]).unwrap_err().sqlstate, "TB910");
        let bound = Worksheet { connection: Some(String::new()), ..worksheet("f") };
        assert!(bound.validate().is_err());
    }

    /// [DESIGN] D36: a favourite query is kept, changed in place by its
    /// identifier, and forgotten; one of no name or no text is refused.
    #[test]
    fn favourite_queries_are_kept_and_forgotten() {
        let kept = Kept::new(&scratch("queries"));
        let query = Query { id: "q1".into(), name: "Staff".into(), sql: "SELECT * FROM STAFF".into() };
        assert_eq!(kept.keep_query(query.clone()).unwrap().len(), 1);
        let renamed = Query { name: "All staff".into(), ..query.clone() };
        assert_eq!(kept.keep_query(renamed).unwrap()[0].name, "All staff");
        assert_eq!(kept.keep_query(Query { id: "q2".into(), ..query.clone() }).unwrap().len(), 2);
        assert_eq!(kept.forget_query("q1").unwrap().len(), 1);
        assert_eq!(kept.keep_query(Query { name: String::new(), ..query.clone() }).unwrap_err().sqlstate, "TB910");
        assert_eq!(kept.keep_query(Query { sql: String::new(), ..query }).unwrap_err().sqlstate, "TB910");
    }

    /// [RULE] R-FMT-2 [STUDIO worksheets.json] [STUDIO queries.json]: the
    /// manual's examples of the files are ones Studio reads.
    #[test]
    fn the_manuals_examples_are_read() {
        let dir = scratch("worksheets-manual");
        std::fs::write(dir.join(super::WORKSHEETS_FILE), crate::testing::manual_json("appendix/d-files.md", "worksheets.json")).unwrap();
        std::fs::write(dir.join(super::QUERIES_FILE), crate::testing::manual_json("appendix/d-files.md", "queries.json")).unwrap();
        let kept = Kept::new(&dir);
        assert_eq!(kept.worksheets().unwrap()[0].title, "report.sql");
        assert_eq!(kept.queries().unwrap()[0].name, "All staff");
    }
}
