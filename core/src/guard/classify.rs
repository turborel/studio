//! Statements classified by Turborel's own parser (RULES.md D29): each by
//! the kind of its syntax tree, a script split as the server splits it and
//! the strictest class of its statements taken. Whatever does not parse,
//! dynamic SQL, and what runs other statements (CALL, compound statements,
//! EXECUTE, EXECUTE GQL) are classified the strictest, so a guard fails
//! closed.

use serde::{Deserialize, Serialize};
use turborel::ast::{DropObject, IndexStatement, SchemaStatement, SqlStatement, UserStatement};
use turborel::lexer::{Tok, lex};
use turborel::parser::Parser;
use turborel_client::Splitter;

/// What a statement does, from the least to the most a guard weighs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Class {
    /// Reads, and changes nothing.
    Read,
    /// Ends or shapes a transaction: COMMIT, ROLLBACK, savepoints, SET
    /// TRANSACTION, SET CONSTRAINTS.
    Transaction,
    /// Changes the session alone: its schema, catalog, time zone, role or
    /// settings.
    Session,
    /// Changes rows.
    WriteRows,
    /// Changes definitions.
    ChangeSchema,
    /// Changes who may do what: users, roles, privileges, the session's
    /// user.
    Security,
    /// Changes the database or the server: its settings, owner, members,
    /// backups, connections served.
    Administration,
    /// Not known: what does not parse, dynamic SQL, and what runs other
    /// statements. The strictest.
    Unclassified,
}

impl Class {
    /// Whether a statement of the class may change the database, as a
    /// production connection asks first of, and a read-only one refuses.
    pub fn writes(self) -> bool {
        matches!(self, Class::WriteRows | Class::ChangeSchema | Class::Security | Class::Administration | Class::Unclassified)
    }
}

/// A statement, classified.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Classified {
    /// Its text.
    pub text: String,
    /// Its class.
    pub class: Class,
    /// What it destroys, if it is a DROP, a TRUNCATE, or a DELETE or
    /// UPDATE without WHERE, which every path asks of first (R-SEC-8).
    pub destroys: Option<String>,
    /// Why the assistant may never run it, if the hard floor holds it
    /// (D29): what it is.
    pub floor: Option<String>,
    /// The object a statement the floor holds names, where it names one:
    /// a table, schema or extension, which the user types to run a draft
    /// of the assistant's (D55).
    pub object: Option<String>,
    /// Whether it makes the next transaction READ WRITE, which a read-only
    /// connection refuses.
    pub read_write: bool,
    /// Whether it is CONNECT, SET CONNECTION or DISCONNECT, which Studio's
    /// connections refuse: each is bound to its own session (S-IMPL-3).
    pub connects: bool,
}

/// The statements of `script`, split as the server splits a request of
/// several, each classified.
pub fn classify_script(script: &str) -> Vec<Classified> {
    let mut splitter = Splitter::default();
    let mut texts = splitter.feed(script);
    texts.extend(splitter.finish());
    texts.iter().map(|text| classify(text)).collect()
}

/// The strictest class of `statements`; Read of none.
pub fn strictest(statements: &[Classified]) -> Class {
    statements.iter().map(|s| s.class).max().unwrap_or(Class::Read)
}

/// The statement `text`, classified by its syntax tree: a query if it is
/// one, or EXPLAIN of one, else an `<SQL statement>`; unclassified if it
/// is none of them.
pub fn classify(text: &str) -> Classified {
    let text = text.trim().to_owned();
    let unclassified = Classified {
        text: text.clone(),
        class: Class::Unclassified,
        destroys: None,
        floor: None,
        object: None,
        read_write: false,
        connects: false,
    };
    // A comment the text ends in is ended, as the client ends one its
    // input cuts short ([DOC sql/01-lexical.md Comments]).
    let ended = format!("{text}\n");
    let text = ended;
    if let Some(class) = explained(&text).or_else(|| query(&text)) {
        return Classified { class, ..unclassified };
    }
    let Some(statement) = PARSERS.iter().find_map(|parser| parser(&text).and_then(|mut p| p.sql_statement()).ok()) else {
        return unclassified;
    };
    let (class, destroys, floor) = of(&statement);
    let object = floor.as_ref().and_then(|_| named(&statement));
    let read_write = matches!(&statement, SqlStatement::SetTransaction(_)) && sets_read_write(&text);
    let connects = matches!(&statement, SqlStatement::Connection(_));
    Classified { class, destroys, floor, object, read_write, connects, ..unclassified }
}

/// The class of `text` if it is a query: Read, or WriteRows if it holds a
/// data change delta table, as FINAL TABLE (INSERT ...), which changes
/// rows, and so is judged by its words.
fn query(text: &str) -> Option<Class> {
    PARSERS.iter().find_map(|parser| parser(text).and_then(|mut p| p.cursor_specification()).ok())?;
    Some(if changes_rows(text) { Class::WriteRows } else { Class::Read })
}

/// The parsers a statement is read by, in turn: as direct SQL, then as a
/// statement prepared, whose dynamic parameters, `?`, a worksheet gives
/// values ([DOC sql/statements/prepare.md DESCRIPTION]).
const PARSERS: [fn(&str) -> turborel::error::Result<Parser>; 2] =
    [|text| Parser::with_extensions(text, true), |text| Parser::for_prepare(text, true)];

/// The class of `text` if it is `EXPLAIN [ ANALYZE ] <cursor
/// specification>` ([DOC sql/statements/explain.md EXPLAIN ANALYZE]): its
/// query's, as EXPLAIN takes only a query. EXPLAIN and ANALYZE are no key
/// words, so read as the server reads them: EXPLAIN first, then ANALYZE
/// only where a query follows it.
fn explained(text: &str) -> Option<Class> {
    const EXPLAIN: &str = "EXPLAIN";
    const ANALYZE: &str = "ANALYZE";
    let tokens = lex(text).ok()?;
    let [first, second, rest @ ..] = tokens.as_slice() else {
        return None;
    };
    if first.tok != Tok::Identifier(EXPLAIN.to_owned()) {
        return None;
    }
    let after = |token: &turborel::lexer::Token| text.get(token.start..);
    let analyzed = match rest.first() {
        Some(third) if second.tok == Tok::Identifier(ANALYZE.to_owned()) => after(third).and_then(query),
        _ => None,
    };
    analyzed.or_else(|| after(second).and_then(query))
}

/// Whether the words of `text` include a statement that changes rows, as a
/// data change delta table holds.
fn changes_rows(text: &str) -> bool {
    const CHANGES: [&str; 4] = ["INSERT", "UPDATE", "DELETE", "MERGE"];
    lex(text).map_or(true, |tokens| tokens.iter().any(|t| matches!(&t.tok, Tok::KeyWord(k) if CHANGES.contains(k))))
}

/// Whether the SET TRANSACTION `text` says READ WRITE.
fn sets_read_write(text: &str) -> bool {
    let words: Vec<String> = lex(text)
        .map(|tokens| {
            tokens
                .into_iter()
                .filter_map(|t| match t.tok {
                    Tok::KeyWord(k) => Some(k.to_owned()),
                    Tok::Identifier(i) => Some(i),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default();
    words.windows(2).any(|w| matches!(w, [read, write] if read == "READ" && write == "WRITE"))
}

/// What a statement is: its class, what it destroys, and the floor's
/// reason.
type Judged = (Class, Option<String>, Option<String>);

/// `class`, destroying nothing, under no floor.
fn plain(class: Class) -> Judged {
    (class, None, None)
}

/// `class`, under the floor as `what`.
fn floored(class: Class, what: &str) -> Judged {
    (class, None, Some(what.to_owned()))
}

/// The judgement of `statement`, by its kind.
fn of(statement: &SqlStatement) -> Judged {
    match statement {
        SqlStatement::Close(_)
        | SqlStatement::Fetch { .. }
        | SqlStatement::GetDiagnostics(_)
        | SqlStatement::Open(_)
        | SqlStatement::Select { .. } => plain(Class::Read),
        SqlStatement::Commit
        | SqlStatement::Rollback
        | SqlStatement::Savepoint(_)
        | SqlStatement::SetTransaction(_)
        | SqlStatement::SetConstraints { .. } => plain(Class::Transaction),
        SqlStatement::SetCollation(_)
        | SqlStatement::SetTransformGroup(_)
        | SqlStatement::SetCatalog(_)
        | SqlStatement::SetSchema(_)
        | SqlStatement::SetTimeZone(_)
        | SqlStatement::SetRole(_)
        | SqlStatement::SetSetting { .. }
        | SqlStatement::Locator { .. } => plain(Class::Session),
        SqlStatement::Insert(_)
        | SqlStatement::Merge(_)
        | SqlStatement::DeletePositioned { .. }
        | SqlStatement::UpdatePositioned { .. } => plain(Class::WriteRows),
        SqlStatement::DeleteSearched { table, where_clause, .. } => searched("DELETE", &table.ident, where_clause.is_some()),
        SqlStatement::UpdateSearched { table, where_clause, .. } => searched("UPDATE", &table.ident, where_clause.is_some()),
        SqlStatement::Truncate { table, .. } => {
            let what = format!("TRUNCATE TABLE {}", table.ident);
            (Class::WriteRows, Some(what.clone()), Some(what))
        }
        SqlStatement::AlterTable { .. } | SqlStatement::DeclareTable(_) => plain(Class::ChangeSchema),
        SqlStatement::Drop { object, .. } => dropped(object),
        SqlStatement::Schema { statement, .. } => schema(statement),
        SqlStatement::Index(index) => indexed(index),
        SqlStatement::User(user) => users(user),
        SqlStatement::SetSessionAuthorization(_) => floored(Class::Security, "SET SESSION AUTHORIZATION"),
        SqlStatement::SetDatabase { .. } => floored(Class::Administration, "SET DATABASE"),
        SqlStatement::Served(_) => floored(Class::Administration, "END or CANCEL CONNECTION"),
        SqlStatement::Connection(_) => plain(Class::Administration),
        SqlStatement::Control(_)
        | SqlStatement::Signal(_)
        | SqlStatement::Call(_)
        | SqlStatement::Return(_)
        | SqlStatement::Dynamic(_)
        | SqlStatement::Execute(_)
        | SqlStatement::ExecuteGql(_) => plain(Class::Unclassified),
    }
}

/// The object `statement` names, of a DROP of a table, schema or extension,
/// a TRUNCATE, or a DELETE or UPDATE.
fn named(statement: &SqlStatement) -> Option<String> {
    match statement {
        SqlStatement::Drop { object: DropObject::Table(name), .. } => Some(name.ident.clone()),
        SqlStatement::Drop { object: DropObject::Schema { name, .. }, .. }
        | SqlStatement::Drop { object: DropObject::Extension(name, _), .. } => Some(name.clone()),
        SqlStatement::Truncate { table, .. } | SqlStatement::DeleteSearched { table, .. } | SqlStatement::UpdateSearched { table, .. } => {
            Some(table.ident.clone())
        }
        _ => None,
    }
}

/// A searched DELETE or UPDATE of `table`: one without WHERE destroys,
/// and is under the floor.
fn searched(verb: &str, table: &str, filtered: bool) -> Judged {
    if filtered {
        return plain(Class::WriteRows);
    }
    let what = format!("{verb} of every row of {table}, with no WHERE");
    (Class::WriteRows, Some(what.clone()), Some(what))
}

/// A DROP of `object`: each destroys; a schema, a table and an extension are
/// under the floor.
fn dropped(object: &DropObject) -> Judged {
    let (kind, floor) = match object {
        DropObject::Schema { .. } => ("DROP SCHEMA", true),
        DropObject::Table(_) => ("DROP TABLE", true),
        DropObject::Extension(..) => ("DROP EXTENSION", true),
        DropObject::View(_) => ("DROP VIEW", false),
        DropObject::Domain(_) => ("DROP DOMAIN", false),
        DropObject::Assertion(_) => ("DROP ASSERTION", false),
        DropObject::Collation(_) => ("DROP COLLATION", false),
        DropObject::Sequence(_) => ("DROP SEQUENCE", false),
        DropObject::Type(_) => ("DROP TYPE", false),
        DropObject::Trigger(_) => ("DROP TRIGGER", false),
        DropObject::Routine(_) => ("DROP ROUTINE", false),
        DropObject::Module(_) => ("DROP MODULE", false),
        DropObject::Cast(..) => ("DROP CAST", false),
        DropObject::Ordering(_) => ("DROP ORDERING", false),
        DropObject::Transform(..) => ("DROP TRANSFORM", false),
        DropObject::Graph(..) | DropObject::GqlGraph(..) => ("DROP GRAPH", false),
        DropObject::GraphType(..) => ("DROP GRAPH TYPE", false),
        DropObject::Vector(..) => ("DROP of a vector object", false),
        DropObject::XmlSchema(..) => ("DROP XML SCHEMA", false),
        DropObject::XQueryModule(..) => ("DROP XQUERY MODULE", false),
    };
    (Class::ChangeSchema, Some(kind.to_owned()), floor.then(|| kind.to_owned()))
}

/// A definition outside a schema's: grants, revokes and roles change who
/// may do what; an extension is under the floor; the rest change
/// definitions.
fn schema(statement: &SchemaStatement) -> Judged {
    match statement {
        SchemaStatement::Grant(..) => floored(Class::Security, "GRANT"),
        SchemaStatement::Revoke(..) => floored(Class::Security, "REVOKE"),
        SchemaStatement::Role(..) => floored(Class::Security, "a role's definition"),
        SchemaStatement::Extension(..) => floored(Class::Administration, "CREATE EXTENSION"),
        SchemaStatement::Table(..)
        | SchemaStatement::View(..)
        | SchemaStatement::Domain(..)
        | SchemaStatement::AlterDomain(..)
        | SchemaStatement::Assertion(..)
        | SchemaStatement::Collation(..)
        | SchemaStatement::Sequence(..)
        | SchemaStatement::AlterSequence(..)
        | SchemaStatement::Type(..)
        | SchemaStatement::Trigger(..)
        | SchemaStatement::Routine(..)
        | SchemaStatement::Module(..)
        | SchemaStatement::AlterType(..)
        | SchemaStatement::Method(..)
        | SchemaStatement::Cast(..)
        | SchemaStatement::Ordering(..)
        | SchemaStatement::Transform(..)
        | SchemaStatement::AlterTransform(..)
        | SchemaStatement::Graph(..)
        | SchemaStatement::AlterGraph(..)
        | SchemaStatement::Vector(..)
        | SchemaStatement::GraphType(..)
        | SchemaStatement::GqlGraph(..)
        | SchemaStatement::XmlSchema(..)
        | SchemaStatement::XQueryModule(..)
        | SchemaStatement::AlterXQueryModule(..) => plain(Class::ChangeSchema),
    }
}

/// An index's statement: a DROP INDEX destroys.
fn indexed(index: &IndexStatement) -> Judged {
    match index {
        IndexStatement::Drop { .. } => (Class::ChangeSchema, Some("DROP INDEX".to_owned()), None),
        IndexStatement::Create { .. }
        | IndexStatement::Adjacency(_)
        | IndexStatement::Labels(_)
        | IndexStatement::Reachability(_)
        | IndexStatement::Alter { .. }
        | IndexStatement::Maintain { .. } => plain(Class::ChangeSchema),
    }
}

/// A statement of users, of the database's owner and members, or of
/// backups: each under the floor.
fn users(user: &UserStatement) -> Judged {
    match user {
        UserStatement::Create { .. } | UserStatement::Alter { .. } | UserStatement::RoleCreator { .. } => {
            floored(Class::Security, "a user's definition")
        }
        UserStatement::Drop { .. } => {
            let what = "DROP USER".to_owned();
            (Class::Security, Some(what.clone()), Some(what))
        }
        UserStatement::Owner { .. } | UserStatement::Members { .. } => floored(Class::Administration, "ALTER DATABASE"),
        UserStatement::Backup { .. } => floored(Class::Administration, "BACKUP DATABASE"),
        UserStatement::RestorePoint { .. } => floored(Class::Administration, "CREATE RESTORE POINT"),
        UserStatement::Rescan { .. } => floored(Class::Administration, "RESCAN BACKUP TARGET"),
    }
}

#[cfg(test)]
mod tests;
