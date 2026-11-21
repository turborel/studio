//! A generated script's data (RULES.md D65): the rows of the tables
//! chosen, in the order their foreign keys need, appended to the script
//! as INSERTs, which Run SQL File (D62) loads back; or each table's rows
//! written beside it as a CSV file of a header, which the import wizard
//! (D63) and `turborel --import` load back, by copy; each large object
//! read whole; and each identity column restarted past the rows.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{ConnectionManager, unexpected};
use crate::catalog::Catalog;
use crate::catalog::ddl::ordered;
use std::io::Write as _;

use crate::catalog::model::TableDetail;
use crate::connections::scripted::{RowsAs, Scripted, appended, restart_with, scripted};
use crate::connections::worker::{Reply, Request};
use crate::error::{Result, StudioError};
use crate::events::ConnectionId;

/// How a generated script carries its tables' rows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DataScript {
    /// As INSERT statements at the script's end.
    Inserts,
    /// As a CSV file of each table beside the script.
    Csv,
}

/// What a script's data came to: the rows written, and the files beside it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptedData {
    /// The rows written.
    pub rows: u64,
    /// The CSV files written beside the script, by path.
    pub files: Vec<String>,
}

/// `name` as a delimited identifier.
fn delimited(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// The CSV file of `schema`.`table` beside the script at `script`:
/// `<script's stem>.<schema>.<table>.csv`, its names' characters a file
/// name cannot hold made `_`.
pub fn data_file(script: &Path, schema: &str, table: &str) -> PathBuf {
    let plain = |s: &str| s.chars().map(|c| if c.is_alphanumeric() || matches!(c, '_' | '-') { c } else { '_' }).collect::<String>();
    let stem = script.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    script.with_file_name(format!("{stem}.{}.{}.csv", plain(schema), plain(table)))
}

/// The increment of each identity column of a table, by its schema,
/// table and name.
const INCREMENT: &str = "SELECT IDENTITY_INCREMENT FROM INFORMATION_SCHEMA.COLUMNS \
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?";

impl ConnectionManager {
    /// Writes the rows `rows` of a table on `id`, as `how` says: appended
    /// to `script`, or to the CSV file `file`.
    fn script_rows(&self, id: ConnectionId, rows: &Scripted, how: DataScript, (script, file): (&Path, &Path)) -> Result<u64> {
        let (how, path, append) = match how {
            DataScript::Inserts => {
                let heading = format!("\n-- The rows of {}.\n", rows.table);
                appended(script)?
                    .write_all(heading.as_bytes())
                    .map_err(|e| StudioError::misuse(format!("[DESIGN] cannot write the script: {e}")))?;
                (RowsAs::Inserts(rows.prefix.clone()), script, true)
            }
            DataScript::Csv => (RowsAs::Csv(rows.columns.clone()), file, false),
        };
        match self.ask(id, Request::ScriptRows { sql: rows.query.clone(), how, path: path.to_owned(), append })? {
            Reply::Exported(count) => Ok(count),
            _ => Err(unexpected()),
        }
    }

    /// The statements that restart each identity column of `table` on `id`
    /// past its rows ([DOC sql/statements/alter-table.md SYNOPSIS]): with
    /// the greatest value plus the increment, or the least, of one below 0.
    fn restarts(&self, id: ConnectionId, table: &TableDetail) -> Result<Vec<String>> {
        let qualified = format!("{}.{}", delimited(&table.schema), delimited(&table.name));
        let mut found = Vec::new();
        for column in table.columns.iter().filter(|c| c.identity.is_some()) {
            let params = [table.schema.clone(), table.name.clone(), column.name.clone()];
            let increment = self.catalog(id, INCREMENT, (&params, 1))?.into_iter().next().and_then(|r| r.into_iter().next().flatten());
            let increment = increment.unwrap_or_else(|| "1".to_owned());
            let edge = if increment.trim().starts_with('-') { "MIN" } else { "MAX" };
            let sql = format!("SELECT {edge}({}) FROM {qualified}", delimited(&column.name));
            let value = self.catalog(id, &sql, (&[], 1))?.into_iter().next().and_then(|r| r.into_iter().next().flatten());
            if let Some(next) = restart_with(value.as_deref(), &increment) {
                found.push(format!("ALTER TABLE {qualified} ALTER COLUMN {} RESTART WITH {next};\n", delimited(&column.name)));
            }
        }
        Ok(found)
    }

    /// Writes the rows of the base tables `tables`, each its schema and
    /// name, on connection `id`, as `how` says, of the script at `script`,
    /// which holds their definitions already.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 for an unknown connection, a table not read, a value
    /// not scripted, or a file that cannot be written; a query's failure.
    pub fn script_data(&self, id: ConnectionId, tables: &[(String, String)], how: DataScript, script: &Path) -> Result<ScriptedData> {
        let catalog = Catalog::of(self, id);
        let details = tables.iter().map(|(schema, name)| catalog.table(schema, name)).collect::<Result<Vec<_>>>()?;
        let mut done = ScriptedData { rows: 0, files: Vec::new() };
        let mut restarts = Vec::new();
        for table in ordered(details) {
            let Some(rows) = scripted(&table) else { continue };
            let file = data_file(script, &table.schema, &table.name);
            done.rows = done.rows.saturating_add(self.script_rows(id, &rows, how, (script, &file))?);
            if how == DataScript::Csv {
                done.files.push(file.display().to_string());
            }
            restarts.extend(self.restarts(id, &table)?);
        }
        if !restarts.is_empty() {
            let text = format!("\n-- Each identity column restarted past its rows.\n{}", restarts.concat());
            appended(script)?
                .write_all(text.as_bytes())
                .map_err(|e| StudioError::misuse(format!("[DESIGN] cannot write the script: {e}")))?;
        }
        Ok(done)
    }
}
