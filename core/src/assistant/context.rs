//! What the assistant is told of the database (RULES.md D55): by default
//! the schema's context alone, of the names, types, keys and indexes of
//! its tables, those hidden left out, written the same way each time,
//! sorted and of no time, so a model's cache of it holds; and SQL with its
//! literals replaced by placeholders where the policy redacts them. No
//! row's value is told but what the user includes or approves.

use std::fmt::Write as _;

use turborel::lexer::{Tok, lex};

use crate::catalog::model::TableDetail;

/// The most tables a context describes; those past it are named alone.
pub const MAX_CONTEXT_TABLES: usize = 200;

/// The context of schema `schema`'s tables `tables`, each but those
/// `hidden` says: a line of each table, its columns, keys and indexes.
pub fn schema_context(schema: &str, tables: &[TableDetail], hidden: impl Fn(&str, &str) -> bool) -> String {
    let mut shown: Vec<&TableDetail> = tables.iter().filter(|t| !hidden(&t.schema, &t.name)).collect();
    shown.sort_by(|a, b| (&a.schema, &a.name).cmp(&(&b.schema, &b.name)));
    let mut out = format!("Schema {schema}: {} tables and views.\n", shown.len());
    for (i, t) in shown.iter().enumerate() {
        if i >= MAX_CONTEXT_TABLES {
            let _ = writeln!(out, "{}.{} ({})", t.schema, t.name, t.kind);
            continue;
        }
        let columns: Vec<String> =
            t.columns.iter().map(|c| format!("{} {}{}", c.name, c.type_written, if c.nullable { "" } else { " NOT NULL" })).collect();
        let _ = writeln!(out, "{}.{} ({}): {}", t.schema, t.name, t.kind, columns.join(", "));
        let mut constraints: Vec<String> = t
            .constraints
            .iter()
            .filter(|c| c.kind != "CHECK")
            .map(|c| match &c.references {
                Some(r) => format!(
                    "{} FOREIGN KEY ({}) REFERENCES {}.{} ({})",
                    c.name,
                    c.columns.join(", "),
                    r.schema,
                    r.table,
                    r.columns.join(", ")
                ),
                None => format!("{} {} ({})", c.name, c.kind, c.columns.join(", ")),
            })
            .collect();
        constraints.sort();
        for c in constraints {
            let _ = writeln!(out, "  {c}");
        }
        let mut indexes: Vec<String> = t
            .indexes
            .iter()
            .filter(|ix| !ix.implied)
            .map(|ix| format!("INDEX {} USING {} ({})", ix.name, ix.method, ix.columns.join(", ")))
            .collect();
        indexes.sort();
        for ix in indexes {
            let _ = writeln!(out, "  {ix}");
        }
    }
    out
}

/// `sql` with each literal, of a string, a number or a binary string,
/// replaced by `?`; as written where it does not lex.
pub fn redacted(sql: &str) -> String {
    let Ok(tokens) = lex(sql) else { return sql.to_owned() };
    let chars: Vec<char> = sql.chars().collect();
    let mut out = String::new();
    let mut at = 0;
    for t in &tokens {
        let literal = matches!(t.tok, Tok::CharacterString(_) | Tok::ExactNumeric(_) | Tok::ApproximateNumeric(_) | Tok::BinaryString(_));
        if literal && t.start >= at && t.end <= chars.len() {
            out.extend(chars.get(at..t.start).unwrap_or_default());
            out.push('?');
            at = t.end;
        }
    }
    out.extend(chars.get(at..).unwrap_or_default());
    out
}

/// Rows as the model is told them: a line of the columns' names, then a
/// line of each row, its cells between `|`, a null `NULL`.
pub fn rows_text(columns: &[String], rows: &[Vec<Option<String>>]) -> String {
    let mut out = columns.join(" | ");
    for row in rows {
        out.push('\n');
        out.push_str(&row.iter().map(|c| c.as_deref().unwrap_or("NULL")).collect::<Vec<_>>().join(" | "));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{redacted, rows_text, schema_context};
    use crate::catalog::model::{Column, Constraint, Index, Reference, TableDetail};

    /// The column ID, an INTEGER NOT NULL.
    fn id_column() -> Column {
        Column {
            name: "ID".into(),
            position: 1,
            type_written: "INTEGER".into(),
            default: None,
            nullable: false,
            identity: None,
            generated: None,
            domain: None,
        }
    }

    /// The constraints of table `name`: its key, a CHECK, and a foreign key of DEPT.
    fn constraints(name: &str) -> Vec<Constraint> {
        let key = Constraint {
            name: format!("{name}_PK"),
            kind: "PRIMARY KEY".into(),
            columns: vec!["ID".into()],
            check: None,
            references: None,
            deferrable: false,
        };
        let check = Constraint { kind: "CHECK".into(), check: Some("ID > 0".into()), ..key.clone() };
        let foreign = Constraint {
            name: format!("{name}_FK"),
            kind: "FOREIGN KEY".into(),
            references: Some(Reference {
                schema: "ANN".into(),
                table: "DEPT".into(),
                columns: vec!["ID".into()],
                matching: "NONE".into(),
                on_update: "NO ACTION".into(),
                on_delete: "NO ACTION".into(),
            }),
            ..key.clone()
        };
        vec![key, check, foreign]
    }

    /// A table `name` of one column, a key and a foreign key, an index.
    fn table(name: &str) -> TableDetail {
        let column = id_column();
        TableDetail {
            schema: "ANN".into(),
            name: name.into(),
            kind: "BASE TABLE".into(),
            columns: vec![Column { nullable: true, name: "NOTE".into(), ..column.clone() }, column],
            constraints: constraints(name),
            indexes: vec![
                Index {
                    name: format!("{name}_NOTE"),
                    method: "btree".into(),
                    unique: false,
                    columns: vec!["NOTE".into()],
                    implied: false,
                    options: vec![],
                },
                Index {
                    name: "IMPLIED".into(),
                    method: "btree".into(),
                    unique: true,
                    columns: vec!["ID".into()],
                    implied: true,
                    options: vec![],
                },
            ],
            triggers: vec![],
            privileges: vec![],
            view: None,
            partitioning: None,
            partition_of: None,
        }
    }

    /// [DESIGN] D55: the context names each table's columns, keys and
    /// indexes, sorted, the hidden left out, written the same each time.
    #[test]
    fn the_context_is_sorted_and_hides() {
        let tables = [table("STAFF"), table("DEPT"), table("SECRETS")];
        let text = schema_context("ANN", &tables, |_, t| t == "SECRETS");
        assert_eq!(
            text,
            "Schema ANN: 2 tables and views.\n\
             ANN.DEPT (BASE TABLE): NOTE INTEGER, ID INTEGER NOT NULL\n  DEPT_FK FOREIGN KEY (ID) REFERENCES ANN.DEPT (ID)\n  DEPT_PK PRIMARY KEY (ID)\n  INDEX DEPT_NOTE USING btree (NOTE)\n\
             ANN.STAFF (BASE TABLE): NOTE INTEGER, ID INTEGER NOT NULL\n  STAFF_FK FOREIGN KEY (ID) REFERENCES ANN.DEPT (ID)\n  STAFF_PK PRIMARY KEY (ID)\n  INDEX STAFF_NOTE USING btree (NOTE)\n"
        );
        let many: Vec<TableDetail> = (0..=super::MAX_CONTEXT_TABLES).map(|i| table(&format!("T{i:04}"))).collect();
        assert!(schema_context("ANN", &many, |_, _| false).ends_with("ANN.T0200 (BASE TABLE)\n"));
    }

    /// [DESIGN] D55: literals are replaced by placeholders, and SQL that
    /// does not lex is kept as written.
    #[test]
    fn literals_are_redacted() {
        assert_eq!(
            redacted("SELECT * FROM T WHERE NAME = 'Ann' AND PAY > 12.5 OR B = X'FF'"),
            "SELECT * FROM T WHERE NAME = ? AND PAY > ? OR B = ?"
        );
        assert_eq!(redacted("SELECT 'é' FROM T"), "SELECT ? FROM T");
        assert_eq!(redacted("SELECT 'open"), "SELECT 'open");
        assert_eq!(rows_text(&["A".into(), "B".into()], &[vec![Some("1".into()), None]]), "A | B\n1 | NULL");
    }
}
