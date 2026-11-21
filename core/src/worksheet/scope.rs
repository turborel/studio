//! What a statement reads, for the editor's completion (RULES.md D40): the
//! tables and views its FROM clauses name, with their correlation names;
//! its common table expressions and derived tables, with their columns;
//! and an INSERT's, UPDATE's or DELETE's table; read by Turborel's own
//! parser. A statement being written seldom parses whole, so it is read
//! again with a name in the place being typed; one that does not parse
//! either way is said so, and the editor reads it by its words.

use serde::Serialize;
use turborel::ast::{QueryExpression, SelectList, SelectSublist, SqlStatement, TableReference, ValueExpression};
use turborel::parser::Parser;

/// The longest statement read, in bytes.
pub const MAX_SCOPE_BYTES: usize = 1024 * 1024;
/// The name put where a name is being typed, so the statement parses.
const PLACEHOLDER: &str = "Q";

/// What a source of rows is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceKind {
    /// A table or view of the catalog.
    Table,
    /// A common table expression, by its query name.
    Cte,
    /// A derived table, a subquery of FROM.
    Derived,
}

/// A source of rows a statement names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    /// What it is.
    pub kind: SourceKind,
    /// The schema written before a table's name, if one is.
    pub schema: Option<String>,
    /// A table's or common table expression's name.
    pub name: Option<String>,
    /// Its correlation name, if written.
    pub alias: Option<String>,
    /// Its columns, where the statement names them: a derived column list,
    /// a common table expression's column list, or its query's select list;
    /// none of a table, whose columns are the catalog's.
    pub columns: Option<Vec<String>>,
    /// Whether it is of the statement's outermost query, not of one nested.
    pub outer: bool,
}

/// What a statement reads.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scope {
    /// Whether the statement parsed, as written or with a name where one is typed.
    pub parsed: bool,
    /// Its sources, the outermost first.
    pub sources: Vec<Source>,
}

/// The names of a select list's columns, where each has one: a column's
/// name or the name AS gives it; none if any has none, or of `*`.
fn select_names(query: &QueryExpression) -> Option<Vec<String>> {
    match query {
        QueryExpression::Spec(spec) => match &spec.select_list {
            SelectList::Star => None,
            SelectList::Values(items) => items
                .iter()
                .map(|item| match item {
                    SelectSublist::Derived(d) => d.alias.clone().or_else(|| match &d.value {
                        ValueExpression::Column(c) => Some(c.column.clone()),
                        _ => None,
                    }),
                    _ => None,
                })
                .collect(),
        },
        QueryExpression::SetOp(op) => select_names(&op.left),
        QueryExpression::With(with) => select_names(&with.body),
        QueryExpression::Ordered(ordered) => select_names(&ordered.body),
        QueryExpression::Values(_) => None,
    }
}

/// Collects a statement's sources as its tree is walked.
#[derive(Default)]
struct Walker {
    sources: Vec<Source>,
    ctes: Vec<String>,
}

impl Walker {
    /// The sources of `query`, `outer` if it is the statement's own.
    fn query(&mut self, query: &QueryExpression, outer: bool) {
        match query {
            QueryExpression::Spec(spec) => {
                for reference in &spec.table_expression.from {
                    self.reference(reference, outer);
                }
            }
            QueryExpression::SetOp(op) => {
                self.query(&op.left, outer);
                self.query(&op.right, outer);
            }
            QueryExpression::With(with) => {
                for element in &with.elements {
                    self.ctes.push(element.name.clone());
                    let columns = element.columns.clone().or_else(|| select_names(&element.query));
                    let cte = Source { kind: SourceKind::Cte, schema: None, name: Some(element.name.clone()), alias: None, columns, outer };
                    self.sources.push(cte);
                    self.query(&element.query, false);
                }
                self.query(&with.body, outer);
            }
            QueryExpression::Ordered(ordered) => self.query(&ordered.body, outer),
            QueryExpression::Values(_) => {}
        }
    }

    /// The sources of `reference`.
    fn reference(&mut self, reference: &TableReference, outer: bool) {
        match reference {
            TableReference::Table(t) => {
                let cte = t.table.auth.is_none() && self.ctes.contains(&t.table.ident);
                self.sources.push(Source {
                    kind: if cte { SourceKind::Cte } else { SourceKind::Table },
                    schema: t.table.auth.clone(),
                    name: Some(t.table.ident.clone()),
                    alias: t.correlation.clone(),
                    columns: t.columns.clone(),
                    outer,
                });
            }
            TableReference::Derived(d) => {
                let columns = d.columns.clone().or_else(|| select_names(&d.query.query));
                self.sources.push(Source {
                    kind: SourceKind::Derived,
                    schema: None,
                    name: None,
                    alias: Some(d.correlation.clone()),
                    columns,
                    outer,
                });
                self.query(&d.query.query, false);
            }
            TableReference::Joined(j) => {
                self.reference(&j.left, outer);
                self.reference(&j.right, outer);
            }
            _ => {}
        }
    }

    /// The sources of `statement`, if it reads any.
    fn statement(&mut self, statement: &SqlStatement) {
        let table = |t: &turborel::ast::TableName| Source {
            kind: SourceKind::Table,
            schema: t.auth.clone(),
            name: Some(t.ident.clone()),
            alias: None,
            columns: None,
            outer: true,
        };
        match statement {
            SqlStatement::Insert(insert) => self.sources.push(table(&insert.table)),
            SqlStatement::UpdateSearched { table: t, .. } | SqlStatement::DeleteSearched { table: t, .. } => self.sources.push(table(t)),
            SqlStatement::Select { query, .. } => {
                for reference in &query.table_expression.from {
                    self.reference(reference, true);
                }
            }
            _ => {}
        }
    }
}

/// The sources of `text`, if it parses as a query or a statement.
fn parsed(text: &str) -> Option<Vec<Source>> {
    let mut walker = Walker::default();
    if let Ok(query) = Parser::with_extensions(text, true).and_then(|mut p| p.cursor_specification()) {
        walker.query(&query.query, true);
        return Some(walker.sources);
    }
    let statement = Parser::for_prepare(text, true).and_then(|mut p| p.sql_statement()).ok()?;
    walker.statement(&statement);
    Some(walker.sources)
}

/// What `text` reads, the cursor at byte `cursor`: read as written, else
/// with a name where the cursor is.
pub fn scope(text: &str, cursor: usize) -> Scope {
    if text.len() > MAX_SCOPE_BYTES {
        return Scope::default();
    }
    let at = cursor.min(text.len());
    let with_name = text.get(..at).zip(text.get(at..)).map(|(before, after)| format!("{before}{PLACEHOLDER}{after}"));
    for candidate in [Some(text.to_owned()), with_name].into_iter().flatten() {
        if let Some(sources) = parsed(&format!("{candidate}\n")) {
            return Scope { parsed: true, sources };
        }
    }
    Scope::default()
}

#[cfg(test)]
mod tests;
