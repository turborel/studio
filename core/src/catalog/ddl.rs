//! Definitions as SQL (RULES.md D33): each object of the catalog written
//! as the statement that makes it, of Turborel's own syntax
//! (`[DOC sql/statements/create-table.md SYNOPSIS]`), and the statements
//! a table is scripted as: SELECT, INSERT, UPDATE, DELETE, ALTER and DROP.
//! What the Information Schema does not show, as a view's query too long
//! for it, is said in a comment, never guessed.

use std::fmt::Write as _;

use serde::{Deserialize, Serialize};

use crate::catalog::model::{Column, Constraint, Domain, Index, RoutineDetail, Sequence, TableDetail, Trigger, UserType};
use crate::catalog::names::{ident, qualified};
pub use crate::catalog::types::create_type;

/// The method an index has unless it names another.
const DEFAULT_METHOD: &str = "btree";
/// A primary key's kind.
const PRIMARY_KEY: &str = "PRIMARY KEY";
/// A foreign key's kind.
const FOREIGN_KEY: &str = "FOREIGN KEY";
/// A check's kind.
const CHECK: &str = "CHECK";
/// A view's kind.
const VIEW: &str = "VIEW";
/// A match of no option.
const MATCH_NONE: &str = "NONE";
/// An identity of ALWAYS.
const ALWAYS: &str = "ALWAYS";
/// The indentation of a definition's parts.
const INDENT: &str = "    ";
/// What ends a statement of a script.
const END: &str = ";\n";

/// What a table is scripted as.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScriptAs {
    /// Its definition, and its indexes' and triggers'.
    Create,
    /// An ALTER TABLE to begin from.
    Alter,
    /// Its DROP.
    Drop,
    /// A SELECT of its columns.
    Select,
    /// An INSERT of its columns, a `?` each.
    Insert,
    /// An UPDATE of its columns by its primary key.
    Update,
    /// A DELETE by its primary key.
    Delete,
}

/// `table` scripted as `kind`.
pub fn script(table: &TableDetail, kind: ScriptAs) -> String {
    let name = qualified(&table.schema, &table.name);
    match kind {
        ScriptAs::Create => create(table),
        ScriptAs::Alter => format!("ALTER TABLE {name} ADD COLUMN NEW_COLUMN INTEGER{END}"),
        ScriptAs::Drop => format!("DROP {} {name} RESTRICT{END}", if table.kind == VIEW { "VIEW" } else { "TABLE" }),
        ScriptAs::Select => format!("SELECT {}\nFROM {name}{END}", list(table.columns.iter().map(|c| ident(&c.name)))),
        ScriptAs::Insert => insert(table, &name),
        ScriptAs::Update => update(table, &name),
        ScriptAs::Delete => format!("DELETE FROM {name}\nWHERE {}{END}", by_key(table)),
    }
}

/// `items` separated by commas.
fn list(items: impl Iterator<Item = String>) -> String {
    items.collect::<Vec<_>>().join(", ")
}

/// The columns an INSERT gives a value: none of an identity GENERATED
/// ALWAYS, nor a generated column.
fn insertable(table: &TableDetail) -> impl Iterator<Item = &Column> {
    table.columns.iter().filter(|c| c.identity.as_deref() != Some(ALWAYS) && c.generated.is_none())
}

/// An INSERT of `table`'s columns.
fn insert(table: &TableDetail, name: &str) -> String {
    let columns: Vec<&Column> = insertable(table).collect();
    let marks = list(columns.iter().map(|_| "?".to_owned()));
    format!("INSERT INTO {name} ({})\nVALUES ({marks}){END}", list(columns.iter().map(|c| ident(&c.name))))
}

/// The columns of `table`'s primary key, or all its columns if it has
/// none.
fn key_columns(table: &TableDetail) -> Vec<String> {
    let key = table.constraints.iter().find(|c| c.kind == PRIMARY_KEY);
    key.map_or_else(|| table.columns.iter().map(|c| c.name.clone()).collect(), |k| k.columns.clone())
}

/// A search condition of `table`'s key, a `?` each.
fn by_key(table: &TableDetail) -> String {
    key_columns(table).iter().map(|c| format!("{} = ?", ident(c))).collect::<Vec<_>>().join(" AND ")
}

/// An UPDATE of `table`'s columns not of its key, by its key.
fn update(table: &TableDetail, name: &str) -> String {
    let key = key_columns(table);
    let set = list(insertable(table).filter(|c| !key.contains(&c.name)).map(|c| format!("{} = ?", ident(&c.name))));
    format!("UPDATE {name}\nSET {set}\nWHERE {}{END}", by_key(table))
}

/// `table`'s definition: a CREATE TABLE, or a view's CREATE VIEW; then
/// each index not a constraint's own, and each trigger.
pub fn create(table: &TableDetail) -> String {
    let name = qualified(&table.schema, &table.name);
    let mut out = if table.kind == VIEW { create_view(table, &name) } else { create_table(table, &name) };
    for index in table.indexes.iter().filter(|i| !i.implied) {
        out.push_str(&create_index(index, &name));
    }
    for trigger in &table.triggers {
        out.push_str(&create_trigger(trigger, &name));
    }
    out
}

/// A view's CREATE VIEW, of its query as the Information Schema shows it.
fn create_view(table: &TableDetail, name: &str) -> String {
    let view = table.view.as_ref();
    match view.and_then(|v| v.definition.as_deref()) {
        Some(query) => {
            let check = match view.map(|v| v.check_option.as_str()) {
                Some("CASCADED") => "\nWITH CHECK OPTION",
                Some("LOCAL") => "\nWITH LOCAL CHECK OPTION",
                _ => "",
            };
            format!("CREATE VIEW {name} AS\n{query}{check}{END}")
        }
        None => format!("-- The view {name}'s query is longer than the Information Schema shows, or is not yours to see.\n"),
    }
}

/// A table's CREATE TABLE: its columns, then its constraints.
fn create_table(table: &TableDetail, name: &str) -> String {
    let partitioned = table.partitioning.as_ref().map(|p| format!(" PARTITION BY {} ({})", p.strategy, p.key)).unwrap_or_default();
    // A partition takes its columns and checks from its table, and names
    // none of its own ([DOC sql/23-partitioning.md Syntax]).
    if let Some(of) = &table.partition_of {
        return format!("CREATE TABLE {name} PARTITION OF {} {}{partitioned}{END}", qualified(&of.schema, &of.name), of.bound);
    }
    let mut parts: Vec<String> = table.columns.iter().map(column).collect();
    parts.extend(table.constraints.iter().map(constraint));
    let body = parts.iter().map(|p| format!("{INDENT}{p}")).collect::<Vec<_>>().join(",\n");
    format!("CREATE TABLE {name} (\n{body}\n){partitioned}{END}")
}

/// A column's definition.
fn column(c: &Column) -> String {
    let mut out = format!("{} {}", ident(&c.name), c.type_written);
    if let Some(default) = &c.default {
        let _ = write!(out, " DEFAULT {default}"); // Writing to a String cannot fail.
    }
    if let Some(identity) = &c.identity {
        let _ = write!(out, " GENERATED {identity} AS IDENTITY");
    }
    if let Some(expression) = &c.generated {
        let _ = write!(out, " GENERATED ALWAYS AS ({expression})");
    }
    if !c.nullable {
        out.push_str(" NOT NULL");
    }
    out
}

/// A table constraint's definition.
fn constraint(c: &Constraint) -> String {
    let columns = list(c.columns.iter().map(|n| ident(n)));
    let body = match (c.kind.as_str(), &c.references) {
        (FOREIGN_KEY, Some(r)) => {
            let target = format!("{} ({})", qualified(&r.schema, &r.table), list(r.columns.iter().map(|n| ident(n))));
            let matching = if r.matching == MATCH_NONE || r.matching.is_empty() { String::new() } else { format!(" MATCH {}", r.matching) };
            format!("FOREIGN KEY ({columns}) REFERENCES {target}{matching} ON UPDATE {} ON DELETE {}", r.on_update, r.on_delete)
        }
        (CHECK, _) => format!("CHECK ({})", c.check.as_deref().unwrap_or_default()),
        (kind, _) => format!("{kind} ({columns})"),
    };
    let deferrable = if c.deferrable { " DEFERRABLE" } else { "" };
    format!("CONSTRAINT {} {body}{deferrable}", ident(&c.name))
}

/// An index's CREATE INDEX.
fn create_index(index: &Index, table: &str) -> String {
    let method = if index.method == DEFAULT_METHOD || index.method.is_empty() { String::new() } else { format!(" USING {}", index.method) };
    let options = if index.options.is_empty() {
        String::new()
    } else {
        format!(" WITH ({})", list(index.options.iter().map(|(option, value)| format!("{option} = {value}"))))
    };
    format!("CREATE INDEX {} ON {table} ({}){method}{options}{END}", ident(&index.name), list(index.columns.iter().map(|n| ident(n))))
}

/// A trigger's CREATE TRIGGER, of its action as the Information Schema
/// shows it to its schema's owner.
fn create_trigger(t: &Trigger, table: &str) -> String {
    let name = qualified(&t.schema, &t.name);
    let Some(action) = &t.action else {
        return format!("-- The trigger {name}'s action is shown to its schema's owner alone.\n");
    };
    let when = t.condition.as_ref().map(|c| format!("\nWHEN ({c})")).unwrap_or_default();
    format!("CREATE TRIGGER {name} {} {} ON {table}\nFOR EACH {}{when}\n{action}{END}", t.timing, t.event, t.orientation)
}

/// A routine's CREATE FUNCTION or CREATE PROCEDURE, of its body as the
/// Information Schema shows it to its schema's owner.
pub fn create_routine(r: &RoutineDetail) -> String {
    let name = qualified(&r.schema, &r.name);
    let Some(body) = &r.body else {
        return format!("-- The routine {name}'s body is shown to its schema's owner alone.\n");
    };
    let parameters = list(r.parameters.iter().map(|p| {
        let named = p.name.as_ref().map(|n| format!("{} ", ident(n))).unwrap_or_default();
        format!("{} {named}{}", p.mode, p.type_written)
    }));
    let returns = r.returns.as_ref().map(|t| format!(" RETURNS {t}")).unwrap_or_default();
    let deterministic = if r.deterministic { " DETERMINISTIC" } else { " NOT DETERMINISTIC" };
    format!("CREATE {} {name} ({parameters}){returns}{deterministic} {}\n{body}{END}", r.kind, r.data_access)
}

/// A sequence generator's CREATE SEQUENCE.
pub fn create_sequence(schema: &str, s: &Sequence) -> String {
    let mut out = format!("CREATE SEQUENCE {} AS {}", qualified(schema, &s.name), s.type_written);
    for (word, value) in [("START WITH", &s.start), ("INCREMENT BY", &s.increment), ("MINVALUE", &s.minimum), ("MAXVALUE", &s.maximum)] {
        if let Some(value) = value {
            let _ = write!(out, " {word} {value}"); // Writing to a String cannot fail.
        }
    }
    out.push_str(if s.cycle { " CYCLE" } else { " NO CYCLE" });
    out.push_str(END);
    out
}

/// A domain's CREATE DOMAIN.
pub fn create_domain(schema: &str, d: &Domain) -> String {
    let mut out = format!("CREATE DOMAIN {} AS {}", qualified(schema, &d.name), d.type_written);
    if let Some(default) = &d.default {
        let _ = write!(out, " DEFAULT {default}"); // Writing to a String cannot fail.
    }
    for (name, check) in &d.checks {
        let _ = write!(out, " CONSTRAINT {} CHECK ({check})", ident(name));
    }
    out.push_str(END);
    out
}

#[cfg(test)]
mod tests;

/// The tables of `tables` ordered so each comes after those its foreign
/// keys reference, and a partition after its table, where it can; a
/// cycle's tables keep their order.
pub fn ordered(tables: Vec<TableDetail>) -> Vec<TableDetail> {
    let mut left = tables;
    let mut done: Vec<TableDetail> = Vec::with_capacity(left.len());
    while !left.is_empty() {
        let waits_for = |t: &TableDetail, schema: &str, table: &str| {
            !(schema == t.schema && table == t.name) && left.iter().any(|o| o.schema == schema && o.name == table)
        };
        let ready = left.iter().position(|t| {
            let references = t.constraints.iter().filter_map(|c| c.references.as_ref()).any(|r| waits_for(t, &r.schema, &r.table));
            let parent = t.partition_of.as_ref().is_some_and(|p| waits_for(t, &p.schema, &p.name));
            !references && !parent
        });
        done.push(left.remove(ready.unwrap_or(0)));
    }
    done
}

/// A schema's script: its types, domains and sequences, then its tables
/// in the order their foreign keys need, then its views, then its
/// routines.
pub fn schema_script(schema: &str, parts: &SchemaParts) -> String {
    let mut out = String::new();
    out.extend(parts.types.iter().map(create_type));
    out.extend(parts.domains.iter().map(|d| create_domain(schema, d)));
    out.extend(parts.sequences.iter().map(|s| create_sequence(schema, s)));
    let (views, tables): (Vec<&TableDetail>, Vec<&TableDetail>) = parts.tables.iter().partition(|t| t.kind == VIEW);
    out.extend(tables.into_iter().map(create));
    out.extend(views.into_iter().map(create));
    out.extend(parts.routines.iter().map(create_routine));
    out
}

/// What a schema's script is made of.
#[derive(Debug, Clone, Default)]
pub struct SchemaParts {
    /// Its user-defined types.
    pub types: Vec<UserType>,
    /// Its domains.
    pub domains: Vec<Domain>,
    /// Its sequences.
    pub sequences: Vec<Sequence>,
    /// Its tables and views, in the order they are made.
    pub tables: Vec<TableDetail>,
    /// Its routines.
    pub routines: Vec<RoutineDetail>,
}
