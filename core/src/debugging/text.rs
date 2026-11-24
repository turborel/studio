//! The text of a routine or trigger the debugger shows, and its line
//! numbering (RULES.md D73). A breakpoint's line and a frame's place count
//! in the routine's `<SQL-invoked routine>` as written, or the trigger's
//! `<trigger definition>`, which no view shows: ROUTINE_DEFINITION and
//! ACTION_STATEMENT hold the body alone. So the text is its CREATE as
//! Studio writes it of the catalog (`catalog/ddl.rs`), the head on its
//! first line, and `exact` says it is not the text as written; each pause
//! is checked against it by `aligned`, and the lines it numbers are shown
//! only where they hold. This is the one place the text is made, so the
//! text as written takes its place once Turborel shows it.

use serde::Serialize;

use crate::catalog::Catalog;
use crate::catalog::ddl::{create_routine, create_trigger};
use crate::catalog::names::qualified;
use crate::debugging::RoutineKind;
use crate::error::{Result, StudioError};

/// What ends a statement Studio writes, which the text as written has not.
const END: &str = ";\n";

/// A routine's or trigger's text as the debugger shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineText {
    /// Its text, numbered from line 1; none if its body is shown only to
    /// its schema's owner.
    pub text: Option<String>,
    /// Whether it is the text as written, whose lines are those the
    /// debugger counts; else Studio's own CREATE of it, checked at each
    /// pause.
    pub exact: bool,
}

/// The text the debugger shows of the routine of `kind` named `name` of
/// `schema`, its specific name, or of the trigger `name` on `table`.
///
/// # Errors
///
/// The server's; SQLCODE -910 of a trigger of no table, or of none of
/// that name.
pub fn routine_text(catalog: &Catalog<'_>, (kind, schema, name): (RoutineKind, &str, &str), table: Option<&str>) -> Result<RoutineText> {
    let written = match kind {
        RoutineKind::Procedure | RoutineKind::Function => {
            let r = catalog.routine(schema, name)?;
            r.body.is_some().then(|| create_routine(&r))
        }
        RoutineKind::Trigger => {
            let table = table.ok_or_else(|| StudioError::misuse("[DESIGN] a trigger's text is read of its table"))?;
            let detail = catalog.table(schema, table)?;
            let t = detail
                .triggers
                .iter()
                .find(|t| t.name == name)
                .ok_or_else(|| StudioError::misuse(format!("[DESIGN] {} has no trigger {name}", qualified(schema, table))))?;
            t.action.is_some().then(|| create_trigger(t, &qualified(schema, table)))
        }
    };
    Ok(RoutineText { text: written.map(|w| w.strip_suffix(END).unwrap_or(&w).to_owned()), exact: false })
}

/// Whether a frame's place, character `at` of the routine's text, at
/// line `line` and column `column`, each from 1, falls where `shown` says,
/// so its line may be shown. Of the text as written, the place is that
/// character; of Studio's CREATE, whose head may not be the one written,
/// the place begins a statement there: a character not a space, after
/// only spaces on its line, or after a `;` or a space.
pub fn aligned(shown: &RoutineText, at: u64, (line, column): (u32, u32)) -> bool {
    let Some(text) = shown.text.as_deref() else { return false };
    if shown.exact {
        return offset(text, (line, column)).is_some_and(|k| k == at);
    }
    let Some(of_line) = usize::try_from(line).ok().and_then(|l| text.split('\n').nth(l.checked_sub(1)?)) else { return false };
    let chars: Vec<char> = of_line.chars().collect();
    let Some(k) = usize::try_from(column).ok().and_then(|c| c.checked_sub(1)) else { return false };
    let (Some(here), before) = (chars.get(k), chars.get(..k).unwrap_or_default()) else { return false };
    !here.is_whitespace() && (before.iter().all(|c| c.is_whitespace()) || before.last().is_some_and(|c| *c == ';' || c.is_whitespace()))
}

/// The character, from 0, at line `line` and column `column` of `text`,
/// each from 1; none past its end.
fn offset(text: &str, (line, column): (u32, u32)) -> Option<u64> {
    let (mut l, mut c) = (1_u32, 1_u32);
    for (k, ch) in text.chars().chain(std::iter::once('\0')).enumerate() {
        if (l, c) == (line, column) {
            return u64::try_from(k).ok();
        }
        (l, c) = if ch == '\n' { (l.saturating_add(1), 1) } else { (l, c.saturating_add(1)) };
    }
    None
}
