//! What a presenter shares (RULES.md D56): the workspace the window sends,
//! of the tabs the presenter picked, checked and filtered before it leaves
//! the backend. A tab's connection is never sent: its environment is read
//! of the connection manager, and a tab of no connection open is judged
//! as production's. An environment that shares nothing leaves its tabs
//! out; one that shares no values sends its SQL, its results' columns and
//! its plans, never a row nor a message. Rows are cut to the session's
//! limit, and the columns masked are sent of no value.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{Result, StudioError};
use crate::live::settings::{LiveSettings, SessionChoices, Sharing};
use crate::saved::Environment;

/// The most tabs shared.
const MAX_TABS: usize = 32;
/// The longest text of a tab, in bytes.
const MAX_TEXT_BYTES: usize = 1024 * 1024;
/// The most lines of a plan, or messages.
const MAX_LINES: usize = 10_000;
/// The most columns of a result.
const MAX_COLUMNS: usize = 1000;
/// The longest short text, as a title or a name, in characters.
const MAX_SHORT_CHARS: usize = 400;
/// The most bytes of the whole state, as JSON.
const MAX_STATE_BYTES: usize = 8 * 1024 * 1024;

/// A tab's kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TabKind {
    /// A worksheet: its SQL, results, messages and plan.
    Worksheet,
    /// A schema's diagram.
    Model,
    /// The analyzer's findings.
    Findings,
}

/// A part of a text chosen: from and to, in characters.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Selection {
    /// Where it begins.
    pub from: u32,
    /// Where it ends.
    pub to: u32,
}

/// A result's column.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Column {
    /// Its name, if it has one.
    pub name: Option<String>,
    /// Its type, as written.
    pub type_name: String,
    /// Whether its values are masked: set by the backend.
    #[serde(default)]
    pub masked: bool,
}

/// A result shown.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Results {
    /// Its columns.
    pub columns: Vec<Column>,
    /// Its rows read, each cell as text, a null none.
    pub rows: Vec<Vec<Option<String>>>,
    /// Whether rows past those sent were cut: set by the backend.
    #[serde(default)]
    pub cut: bool,
}

/// A tab, as the window sends it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TabIn {
    /// Its identifier.
    pub id: String,
    /// Its kind.
    pub kind: TabKind,
    /// Its title.
    pub title: String,
    /// The connection it runs on, if one: never sent.
    pub connection: Option<u64>,
    /// Its text.
    #[serde(default)]
    pub text: String,
    /// The presenter's selection in it.
    pub selection: Option<Selection>,
    /// Its result shown.
    pub results: Option<Results>,
    /// Its messages.
    #[serde(default)]
    pub messages: Vec<String>,
    /// Its latest plan, EXPLAIN's lines.
    #[serde(default)]
    pub plan: Vec<String>,
    /// A diagram's document, or the analyzer's findings, as the window keeps them.
    pub document: Option<Value>,
}

/// Where the presenter points: a tab, and a place in it, each from 0 to 1.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Pointer {
    /// The tab, by its place among those shared.
    pub tab: u32,
    /// Across.
    pub x: f64,
    /// Down.
    pub y: f64,
}

/// The workspace, as the window sends it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceIn {
    /// The tabs picked.
    pub tabs: Vec<TabIn>,
    /// The tab the presenter shows, by its identifier.
    pub active: Option<String>,
    /// Where the presenter points.
    pub pointer: Option<Pointer>,
}

/// A tab, as it is shared.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TabOut {
    /// Its identifier.
    pub id: String,
    /// Its kind.
    pub kind: TabKind,
    /// Its title.
    pub title: String,
    /// Its connection's environment, for its colour.
    pub environment: Option<Environment>,
    /// Whether its values are shared.
    pub values: bool,
    /// Its text.
    pub text: String,
    /// The presenter's selection in it.
    pub selection: Option<Selection>,
    /// Its result shown.
    pub results: Option<Results>,
    /// Its messages.
    pub messages: Vec<String>,
    /// Its latest plan.
    pub plan: Vec<String>,
    /// Its document.
    pub document: Option<Value>,
}

/// The workspace, as it is shared.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceOut {
    /// The tabs.
    pub tabs: Vec<TabOut>,
    /// The tab shown.
    pub active: Option<String>,
    /// Where the presenter points.
    pub pointer: Option<Pointer>,
    /// Whether viewers may copy.
    pub copy: bool,
}

/// Whether `text` is of at most `MAX_SHORT_CHARS` characters, none control.
fn short(text: &str) -> bool {
    text.chars().count() <= MAX_SHORT_CHARS && !text.chars().any(char::is_control)
}

/// Checks the bounds of `workspace`.
fn checked(workspace: &WorkspaceIn) -> Result<()> {
    let too_much = workspace.tabs.len() > MAX_TABS
        || workspace.tabs.iter().any(|t| {
            !short(&t.id)
                || !short(&t.title)
                || t.text.len() > MAX_TEXT_BYTES
                || t.plan.len() > MAX_LINES
                || t.messages.len() > MAX_LINES
                || t.results.as_ref().is_some_and(|r| r.columns.len() > MAX_COLUMNS)
        });
    let pointer = workspace.pointer.is_none_or(|p| (0.0..=1.0).contains(&p.x) && (0.0..=1.0).contains(&p.y));
    if too_much || !pointer {
        return Err(StudioError::misuse("[DESIGN] a shared workspace is at most 32 tabs, each of bounded text, lines and columns"));
    }
    Ok(())
}

/// `results` as shared: of no rows if `values` is not, cut to `limit`
/// rows, and of no value in each column named in `masked`.
fn filtered(mut results: Results, values: bool, limit: u32, masked: &[String]) -> Results {
    let limit = usize::try_from(limit).unwrap_or(usize::MAX);
    if !values {
        results.cut = !results.rows.is_empty();
        results.rows.clear();
    } else if results.rows.len() > limit {
        results.rows.truncate(limit);
        results.cut = true;
    }
    for (i, column) in results.columns.iter_mut().enumerate() {
        column.masked = column.name.as_ref().is_some_and(|n| masked.iter().any(|m| m.eq_ignore_ascii_case(n)));
        if column.masked {
            for row in &mut results.rows {
                if let Some(cell) = row.get_mut(i) {
                    *cell = None;
                }
            }
        }
    }
    results
}

/// `workspace` as shared under `settings` and the session's `choices`, each
/// tab's environment read by `environment_of` of its connection.
///
/// # Errors
///
/// SQLCODE -910 of a workspace out of its bounds, or past 8 MiB shared.
pub fn shared(
    workspace: WorkspaceIn,
    (settings, choices): (&LiveSettings, &SessionChoices),
    environment_of: impl Fn(u64) -> Option<Environment>,
) -> Result<Value> {
    checked(&workspace)?;
    let mut tabs = Vec::new();
    for tab in workspace.tabs {
        let environment = tab.connection.map(|c| environment_of(c).unwrap_or(Environment::Production));
        let mut sharing: Sharing = environment.map_or(Sharing { share: true, values: true }, |e| settings.environments.of(e));
        if environment == Some(Environment::Production) {
            sharing.values = sharing.share && choices.production_values;
        }
        if !sharing.share {
            continue;
        }
        tabs.push(TabOut {
            id: tab.id,
            kind: tab.kind,
            title: tab.title,
            environment,
            values: sharing.values,
            text: tab.text,
            selection: tab.selection,
            results: tab.results.map(|r| filtered(r, sharing.values, choices.row_limit, &settings.masked_columns)),
            messages: if sharing.values { tab.messages } else { Vec::new() },
            plan: tab.plan,
            document: tab.document,
        });
    }
    let active = workspace.active.filter(|a| tabs.iter().any(|t| &t.id == a));
    let out = WorkspaceOut { tabs, active, pointer: workspace.pointer, copy: choices.copy };
    let value = serde_json::to_value(&out).map_err(|e| StudioError::misuse(format!("[DESIGN] the shared workspace: {e}")))?;
    if value.to_string().len() > MAX_STATE_BYTES {
        return Err(StudioError::misuse("[DESIGN] a shared workspace is at most 8 MiB: share fewer tabs, or fewer rows"));
    }
    Ok(value)
}

/// The workspace a guest was shown, read back: none if it is not of the
/// shape shared, as of a presenter of another build.
pub fn read_shared(state: &Value) -> Option<WorkspaceOut> {
    serde_json::from_value(state.clone()).ok()
}

#[cfg(test)]
mod tests;
