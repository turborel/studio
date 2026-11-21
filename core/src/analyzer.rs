//! The analyzer (RULES.md D50): a schema's indexes, each with the
//! constraint it serves, and the rules that find what to change of a
//! schema's tables and the database's settings, each a finding of its
//! rule's identifier, what it is of, why, and its fix as SQL, read and run
//! by the user in a worksheet, never by the analyzer. Every rule is judged
//! of the catalog as read, deterministically: the same catalog gives the
//! same findings, in the same order.

use serde::Serialize;

use crate::catalog::model::{Constraint, Index, TableDetail};
use crate::catalog::names::{ident, qualified};

#[cfg(test)]
mod tests;

/// A foreign key whose columns no index leads.
pub const FOREIGN_KEY_UNINDEXED: &str = "FK-NO-INDEX";
/// An index of another's method, columns and options.
pub const INDEX_DUPLICATE: &str = "INDEX-DUPLICATE";
/// An index whose columns lead another's of its method.
pub const INDEX_LEADS_ANOTHER: &str = "INDEX-PREFIX";
/// A base table of no primary key.
pub const TABLE_NO_PRIMARY_KEY: &str = "TABLE-NO-KEY";
/// A setting of a value its manual warns of.
pub const SETTING_ADVISED: &str = "SETTING-ADVISED";

/// The methods whose indexes are probed by their leading columns' values.
const ORDERED: &str = "btree";
/// The method whose indexes are probed by all their columns' values alone.
const HASHED: &str = "hash";

/// A setting as INFORMATION_SCHEMA.SETTINGS gives it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Setting {
    /// Its name, as LOG.COMMIT_SYNC.
    pub name: String,
    /// Its value for the session reading it.
    pub value: String,
    /// Where the value comes from: DEFAULT, DATABASE, SESSION or NODE.
    pub source: String,
    /// Its default.
    pub default: String,
    /// When a change takes effect: STATEMENT, TRANSACTION, CONNECTION, START or CREATION.
    pub takes_effect: String,
    /// What it is.
    pub description: String,
}

/// A finding of a rule.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    /// The rule's identifier, as FK-NO-INDEX.
    pub rule: &'static str,
    /// What it is of: a table, an index or a setting, as SQL writes it.
    pub object: String,
    /// What the rule found, and why it matters.
    pub says: String,
    /// The SQL that fixes it, to be read and run by the user.
    pub fix: String,
}

/// An index of a schema, with the constraint it serves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexRow {
    /// Its table's name.
    pub table: String,
    /// The index.
    pub index: Index,
    /// The PRIMARY KEY or UNIQUE constraint it was made for, if any.
    pub serves: Option<String>,
}

/// What the analyzer found of a schema.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    /// The schema's indexes, by table and name.
    pub indexes: Vec<IndexRow>,
    /// The findings, by rule then object.
    pub findings: Vec<Finding>,
    /// The settings that differ from their defaults, by name.
    pub settings: Vec<Setting>,
}

/// A value of a setting the manual warns of: the setting, the value, and
/// what the manual says it does (Turborel's `appendix/c-settings.md`).
const WARNED: [(&str, &str, &str); 4] = [
    (
        "LOG.COMMIT_SYNC",
        "OFF",
        "a commit returns before its record is synced to the log, and is lost if the system fails before the log is next synced",
    ),
    ("LOG.DURABILITY", "NONE", "the log is never synced, so a failure of the system may lose any commit"),
    (
        "SERVER.SCRAM_WITHOUT_TLS",
        "ON",
        "SCRAM-SHA-256 is taken over plain TCP, where an eavesdropper may guess the password from the exchange",
    ),
    ("SERVER.TRUST_LOCAL", "ON", "a client of this machine is trusted as who it says, without proving it"),
];

/// Whether a table of TABLE_TYPE `kind` is a base table: BASE TABLE, or
/// SYSTEM VERSIONED.
pub fn is_base(kind: &str) -> bool {
    kind == "BASE TABLE" || kind == "SYSTEM VERSIONED"
}

/// Analyzes `tables`, the base tables of a schema read whole, and
/// `settings`, the database's.
pub fn analyze(tables: &[TableDetail], settings: &[Setting]) -> Analysis {
    let tables: Vec<&TableDetail> = tables.iter().filter(|t| is_base(&t.kind) && t.partition_of.is_none()).collect();
    let mut findings = Vec::new();
    for t in &tables {
        findings.extend(unindexed_foreign_keys(t));
        findings.extend(duplicates(t));
        findings.extend(no_primary_key(t));
    }
    findings.extend(advised(settings));
    findings.sort_by(|a, b| (a.rule, &a.object).cmp(&(b.rule, &b.object)));
    let indexes = tables
        .iter()
        .flat_map(|t| t.indexes.iter().map(|i| IndexRow { table: t.name.clone(), index: i.clone(), serves: served(t, i) }))
        .collect();
    let settings = settings.iter().filter(|s| s.value != s.default).cloned().collect();
    Analysis { indexes, findings, settings }
}

/// The PRIMARY KEY or UNIQUE constraint of `t` that `index` was made for:
/// one of its columns, in its order.
fn served(t: &TableDetail, index: &Index) -> Option<String> {
    if !index.implied || !index.unique {
        return None;
    }
    t.constraints.iter().find(|c| is_key(c) && c.columns == index.columns).map(|c| c.name.clone())
}

/// Whether `c` is a PRIMARY KEY or UNIQUE constraint.
fn is_key(c: &Constraint) -> bool {
    c.kind == "PRIMARY KEY" || c.kind == "UNIQUE"
}

/// Whether `index` is probed by the values of `columns`, in any order:
/// a `btree` index whose leading columns they are, or a `hash` index of
/// them alone.
fn leads(index: &Index, columns: &[String]) -> bool {
    let method = index.method.to_ascii_lowercase();
    let Some(first) = index.columns.get(..columns.len()) else { return false };
    let same = |part: &[String]| part.len() == columns.len() && columns.iter().all(|c| part.contains(c));
    (method == ORDERED && same(first)) || (method == HASHED && same(&index.columns))
}

/// A name of an index for `table`'s columns `columns`, of no index of
/// `table`'s.
fn index_name(t: &TableDetail, base: &str) -> String {
    let taken = |n: &str| t.indexes.iter().any(|i| i.name == n);
    let first = format!("{base}_INDEX");
    if !taken(&first) {
        return first;
    }
    (2..usize::MAX).map(|n| format!("{base}_INDEX{n}")).find(|n| !taken(n)).unwrap_or(first)
}

/// The columns `columns`, as SQL lists them.
fn listed(columns: &[String]) -> String {
    columns.iter().map(|c| ident(c)).collect::<Vec<_>>().join(", ")
}

/// FK-NO-INDEX: each foreign key of `t` whose columns no index leads.
fn unindexed_foreign_keys(t: &TableDetail) -> Vec<Finding> {
    let table = qualified(&t.schema, &t.name);
    t.constraints
        .iter()
        .filter(|c| c.kind == "FOREIGN KEY" && !c.columns.is_empty())
        .filter(|c| !t.indexes.iter().any(|i| leads(i, &c.columns)))
        .map(|c| Finding {
            rule: FOREIGN_KEY_UNINDEXED,
            object: format!("{table} {}", ident(&c.name)),
            says: format!(
                "No index leads the columns of the foreign key {} ({}), so a join by them cannot look the rows of {table} up in an index, and reads it whole.",
                c.name,
                c.columns.join(", ")
            ),
            fix: format!("CREATE INDEX {} ON {table} ({});", ident(&index_name(t, &c.name)), listed(&c.columns)),
        })
        .collect()
}

/// The options of `index`, sorted, so two of the same are equal.
fn options(index: &Index) -> Vec<(String, String)> {
    let mut o = index.options.clone();
    o.sort();
    o
}

/// INDEX-DUPLICATE and INDEX-PREFIX: each index of `t` made by CREATE
/// INDEX of another's method, columns and options, or whose columns lead
/// another `btree` index's.
fn duplicates(t: &TableDetail) -> Vec<Finding> {
    let mut found = Vec::new();
    for (n, index) in t.indexes.iter().enumerate().filter(|(_, i)| !i.implied) {
        let method = index.method.to_ascii_lowercase();
        let same = t.indexes.iter().enumerate().find(|(m, other)| {
            *m != n
                && other.method.to_ascii_lowercase() == method
                && other.columns == index.columns
                && options(other) == options(index)
                && (other.implied || *m < n)
        });
        if let Some((_, other)) = same {
            found.push(Finding {
                rule: INDEX_DUPLICATE,
                object: ident(&index.name),
                says: format!(
                    "The index {} is of the method, columns and options of {}, which serves each lookup it would; each write keeps both.",
                    index.name, other.name
                ),
                fix: format!("DROP INDEX {};", ident(&index.name)),
            });
            continue;
        }
        if method != ORDERED {
            continue;
        }
        let longer = t.indexes.iter().find(|other| {
            other.method.to_ascii_lowercase() == ORDERED
                && other.columns.len() > index.columns.len()
                && other.columns.starts_with(&index.columns)
        });
        if let Some(other) = longer {
            found.push(Finding {
                rule: INDEX_LEADS_ANOTHER,
                object: ident(&index.name),
                says: format!(
                    "The columns of the index {} ({}) lead those of {} ({}), of the same method; each write keeps both. If the plans of your queries read {} as well, it may go.",
                    index.name,
                    index.columns.join(", "),
                    other.name,
                    other.columns.join(", "),
                    other.name
                ),
                fix: format!("DROP INDEX {};", ident(&index.name)),
            });
        }
    }
    found
}

/// TABLE-NO-KEY: `t`, if it has no primary key: its fix makes its first
/// UNIQUE constraint whose columns are each NOT NULL its primary key,
/// dropped and added again of its name, as a table takes no two keys of
/// the same columns; or tells to choose its columns.
fn no_primary_key(t: &TableDetail) -> Option<Finding> {
    if t.constraints.iter().any(|c| c.kind == "PRIMARY KEY") {
        return None;
    }
    let table = qualified(&t.schema, &t.name);
    let not_null = |name: &String| t.columns.iter().any(|c| &c.name == name && !c.nullable);
    let candidate = t.constraints.iter().find(|c| c.kind == "UNIQUE" && !c.columns.is_empty() && c.columns.iter().all(not_null));
    let fix = match candidate {
        Some(c) => format!(
            "ALTER TABLE {table} DROP CONSTRAINT {name} RESTRICT;\nALTER TABLE {table} ADD CONSTRAINT {name} PRIMARY KEY ({});",
            listed(&c.columns),
            name = ident(&c.name)
        ),
        None => format!(
            "-- Name the columns that tell each row of {table} from every other, each NOT NULL:\n-- ALTER TABLE {table} ADD PRIMARY KEY (column);"
        ),
    };
    Some(Finding {
        rule: TABLE_NO_PRIMARY_KEY,
        object: table.clone(),
        says: format!(
            "{table} has no primary key, so nothing tells its rows apart: a row cannot be edited by its key, nor referenced by a foreign key of its own columns."
        ),
        fix,
    })
}

/// SETTING-ADVISED: each setting of a value the manual warns of.
fn advised(settings: &[Setting]) -> Vec<Finding> {
    settings
        .iter()
        .filter_map(|s| {
            let (_, _, why) = WARNED.iter().find(|(name, value, _)| *name == s.name && s.value.eq_ignore_ascii_case(value))?;
            let fix = match s.source.as_str() {
                "SESSION" => format!("SET {} TO DEFAULT;", s.name),
                "NODE" => format!("-- {} is set by the node's operator, not by SQL: its default is {}.", s.name, s.default),
                _ => format!("SET DATABASE {} = DEFAULT;", s.name),
            };
            let when = match s.takes_effect.as_str() {
                "START" => " A change takes effect at the next start.",
                "CONNECTION" => " A change takes effect from the next connection.",
                "TRANSACTION" => " A change takes effect from the next transaction.",
                _ => "",
            };
            Some(Finding {
                rule: SETTING_ADVISED,
                object: s.name.clone(),
                says: format!("{} is {}, not its default {}: {why}.{when}", s.name, s.value, s.default),
                fix,
            })
        })
        .collect()
}
