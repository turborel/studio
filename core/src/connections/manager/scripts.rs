//! A generated script's data (RULES.md D65): the rows of the tables
//! chosen, in the order their foreign keys need, appended to the script
//! as INSERTs, which Run SQL File (D62) loads back; or each table's rows
//! written beside it as a CSV file of a header, which the import wizard
//! (D63) and `turborel --import` load back, by copy.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use turborel_client::export::ExportFormat;

use super::{ConnectionManager, unexpected};
use crate::catalog::Catalog;
use crate::catalog::ddl::ordered;
use crate::connections::scripted::{appended, scripted};
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

/// The CSV file of `schema`.`table` beside the script at `script`:
/// `<script's stem>.<schema>.<table>.csv`, its names' characters a file
/// name cannot hold made `_`.
pub fn data_file(script: &Path, schema: &str, table: &str) -> PathBuf {
    let plain = |s: &str| s.chars().map(|c| if c.is_alphanumeric() || matches!(c, '_' | '-') { c } else { '_' }).collect::<String>();
    let stem = script.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    script.with_file_name(format!("{stem}.{}.{}.csv", plain(schema), plain(table)))
}

impl ConnectionManager {
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
        for table in ordered(details) {
            let Some(rows) = scripted(&table) else { continue };
            let written = match how {
                DataScript::Inserts => {
                    use std::io::Write as _;
                    let heading = format!("\n-- The rows of {}.\n", rows.table);
                    appended(script)?
                        .write_all(heading.as_bytes())
                        .map_err(|e| StudioError::misuse(format!("[DESIGN] cannot write the script: {e}")))?;
                    let request = Request::ScriptRows { sql: rows.query, prefix: rows.prefix, path: script.to_owned() };
                    match self.ask(id, request)? {
                        Reply::Exported(count) => count,
                        _ => return Err(unexpected()),
                    }
                }
                DataScript::Csv => {
                    let file = data_file(script, &table.schema, &table.name);
                    let count = self.export(id, &rows.query, (&file, ExportFormat::Csv))?;
                    done.files.push(file.display().to_string());
                    count
                }
            };
            done.rows = done.rows.saturating_add(written);
        }
        Ok(done)
    }
}
