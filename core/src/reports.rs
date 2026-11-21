//! Reports (RULES.md D52): a query and how its rows are shown, as a table
//! or a chart. The built-in reports read the Information Schema; the
//! user's own are kept in `reports.json`, format 1, in the application's
//! configuration, its owner's alone. A report runs in a worksheet, as any
//! query does: through the connection's guards, its parameters asked.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Result, StudioError};
use crate::store::{self, FORMAT};

#[cfg(test)]
mod tests;

/// The reports' file.
pub const REPORTS_FILE: &str = "reports.json";
/// The most reports kept.
pub const MAX_REPORTS: usize = 1000;
/// The most columns a chart draws.
pub const MAX_CHART_VALUES: usize = 8;
/// The longest the reports' file may be, in bytes.
const MAX_REPORTS_FILE_BYTES: u64 = 64 * 1024 * 1024;
/// The longest text of a report's query, in bytes.
const MAX_SQL_BYTES: usize = 1024 * 1024;
/// The longest identifier, name or column's name, in characters.
const MAX_NAME_CHARS: usize = 200;

/// How a chart draws its rows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChartKind {
    /// A bar of each row, of each value, side by side.
    Bar,
    /// A line of each value, through the rows in order.
    Line,
}

/// A chart of a report's rows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Chart {
    /// How it draws them.
    pub kind: ChartKind,
    /// The column whose values name the rows.
    pub label: String,
    /// The columns whose numbers it draws.
    pub values: Vec<String>,
}

/// A report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Report {
    /// Its identifier.
    pub id: String,
    /// Its name.
    pub name: String,
    /// Its query.
    pub sql: String,
    /// Its chart, or none to show its rows as a table.
    pub chart: Option<Chart>,
}

/// The reports' file.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReportsFile {
    format: u32,
    reports: Vec<Report>,
}

/// A built-in report: its identifier, name, query and chart.
fn built_in(id: &str, name: &str, sql: &str, chart: Option<Chart>) -> Report {
    Report { id: format!("built-in:{id}"), name: name.to_owned(), sql: sql.to_owned(), chart }
}

/// The built-in reports, of the Information Schema.
pub fn built_in_reports() -> Vec<Report> {
    vec![
        built_in(
            "objects",
            "Objects by Schema",
            "SELECT TABLE_SCHEMA AS SCHEMA_NAME, TABLE_TYPE AS KIND, COUNT(*) AS OBJECTS FROM INFORMATION_SCHEMA.TABLES GROUP BY TABLE_SCHEMA, TABLE_TYPE\n\
             UNION ALL SELECT ROUTINE_SCHEMA, ROUTINE_TYPE, COUNT(*) FROM INFORMATION_SCHEMA.ROUTINES GROUP BY ROUTINE_SCHEMA, ROUTINE_TYPE\n\
             UNION ALL SELECT SEQUENCE_SCHEMA, 'SEQUENCE', COUNT(*) FROM INFORMATION_SCHEMA.SEQUENCES GROUP BY SEQUENCE_SCHEMA\n\
             UNION ALL SELECT TABLE_SCHEMA, 'INDEX', COUNT(*) FROM INFORMATION_SCHEMA.INDEXES GROUP BY TABLE_SCHEMA\n\
             ORDER BY 1, 2",
            None,
        ),
        built_in(
            "files",
            "Files",
            "SELECT KIND, CLASS, COUNT(*) AS FILES, SUM(READS) AS READS, SUM(WRITES) AS WRITES, SUM(SYNCS) AS SYNCS\n\
             FROM INFORMATION_SCHEMA.FILES GROUP BY KIND, CLASS ORDER BY KIND, CLASS",
            Some(Chart {
                kind: ChartKind::Bar,
                label: "KIND".to_owned(),
                values: vec!["READS".to_owned(), "WRITES".to_owned(), "SYNCS".to_owned()],
            }),
        ),
        built_in(
            "indexes",
            "Indexes",
            "SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, METHOD_NAME, IS_UNIQUE, COLUMN_NAMES\n\
             FROM INFORMATION_SCHEMA.INDEXES ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME",
            None,
        ),
        built_in(
            "privileges",
            "Table Privileges",
            "SELECT GRANTEE, TABLE_SCHEMA, TABLE_NAME, PRIVILEGE_TYPE, IS_GRANTABLE, GRANTOR\n\
             FROM INFORMATION_SCHEMA.TABLE_PRIVILEGES ORDER BY GRANTEE, TABLE_SCHEMA, TABLE_NAME, PRIVILEGE_TYPE",
            None,
        ),
        built_in(
            "sessions",
            "Sessions",
            "SELECT ID, USER_NAME, PEER, SECURE, STATE, APPLICATION FROM INFORMATION_SCHEMA.CONNECTIONS ORDER BY ID",
            None,
        ),
        built_in(
            "settings",
            "Settings Changed",
            "SELECT SETTING_NAME, SETTING_VALUE, DEFAULT_VALUE, VALUE_SOURCE, TAKES_EFFECT, IS_PENDING\n\
             FROM INFORMATION_SCHEMA.SETTINGS WHERE VALUE_SOURCE <> 'DEFAULT' ORDER BY SETTING_NAME",
            None,
        ),
    ]
}

/// `value` refused if empty, longer than `MAX_NAME_CHARS` characters, or
/// holding a control character.
fn named(what: &str, value: &str) -> Result<()> {
    if value.is_empty() || value.chars().count() > MAX_NAME_CHARS || value.chars().any(char::is_control) {
        return Err(StudioError::misuse(format!("[DESIGN] {what} is 1 to {MAX_NAME_CHARS} characters, none a control")));
    }
    Ok(())
}

impl Report {
    /// Checks the report's bounds.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of a field out of its bounds.
    pub fn validate(&self) -> Result<()> {
        named("a report's identifier", &self.id)?;
        named("a report's name", &self.name)?;
        if self.id.starts_with("built-in:") {
            return Err(StudioError::misuse("[DESIGN] a built-in report is not kept"));
        }
        if self.sql.trim().is_empty() || self.sql.len() > MAX_SQL_BYTES {
            return Err(StudioError::misuse(format!("[DESIGN] a report's query is 1 to {MAX_SQL_BYTES} bytes")));
        }
        if let Some(chart) = &self.chart {
            named("a chart's label column", &chart.label)?;
            if chart.values.is_empty() || chart.values.len() > MAX_CHART_VALUES {
                return Err(StudioError::misuse(format!("[DESIGN] a chart draws 1 to {MAX_CHART_VALUES} columns")));
            }
            chart.values.iter().try_for_each(|v| named("a chart's column", v))?;
        }
        Ok(())
    }
}

/// The user's reports, in a directory of the user's own.
#[derive(Debug, Clone)]
pub struct Reports {
    dir: PathBuf,
}

impl Reports {
    /// The reports kept in `dir`.
    pub fn new(dir: &Path) -> Self {
        Reports { dir: dir.to_owned() }
    }

    /// The user's reports, as kept.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the file cannot be read.
    pub fn list(&self) -> Result<Vec<Report>> {
        Ok(store::read::<ReportsFile>(&self.dir.join(REPORTS_FILE), MAX_REPORTS_FILE_BYTES)?.map(|f| f.reports).unwrap_or_default())
    }

    /// Keeps `report`, in place of the one of its identifier, else last.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of a report out of its bounds, too many, or if the
    /// file cannot be read or written.
    pub fn keep(&self, report: Report) -> Result<Vec<Report>> {
        report.validate()?;
        let mut reports = self.list()?;
        let full = reports.len() >= MAX_REPORTS;
        match reports.iter_mut().find(|r| r.id == report.id) {
            Some(kept) => *kept = report,
            None if full => return Err(StudioError::misuse(format!("[DESIGN] at most {MAX_REPORTS} reports are kept"))),
            None => reports.push(report),
        }
        self.write(&reports)?;
        Ok(reports)
    }

    /// Forgets the report `id`, if kept.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the file cannot be read or written.
    pub fn forget(&self, id: &str) -> Result<Vec<Report>> {
        let reports: Vec<Report> = self.list()?.into_iter().filter(|r| r.id != id).collect();
        self.write(&reports)?;
        Ok(reports)
    }

    /// Writes `reports` to the file.
    fn write(&self, reports: &[Report]) -> Result<()> {
        store::write(&self.dir.join(REPORTS_FILE), &ReportsFile { format: FORMAT, reports: reports.to_vec() })
    }
}
