//! The catalog as the explorer shows it (RULES.md D33): each object the
//! Information Schema describes, as the session's user may see it.

use serde::Serialize;

/// A schema.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Schema {
    /// Its name.
    pub name: String,
    /// Its owner.
    pub owner: Option<String>,
}

/// A table or view, by name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRef {
    /// Its name.
    pub name: String,
    /// BASE TABLE, VIEW, GLOBAL TEMPORARY, LOCAL TEMPORARY or SYSTEM
    /// VERSIONED, as TABLES' TABLE_TYPE.
    pub kind: String,
}

/// A routine, by name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineRef {
    /// Its specific name, which tells overloads apart.
    pub specific: String,
    /// Its name.
    pub name: String,
    /// FUNCTION or PROCEDURE.
    pub kind: String,
}

/// What a schema holds.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaObjects {
    /// Its tables and views.
    pub tables: Vec<TableRef>,
    /// Its functions and procedures.
    pub routines: Vec<RoutineRef>,
    /// Its sequence generators.
    pub sequences: Vec<Sequence>,
    /// Its domains.
    pub domains: Vec<Domain>,
    /// Its user-defined types, by name and category.
    pub types: Vec<(String, String)>,
    /// Whether a list stopped at the most Studio reads of one.
    pub truncated: bool,
}

/// A column.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    /// Its name.
    pub name: String,
    /// Its place, from 1.
    pub position: u32,
    /// Its type as SQL writes it, as the server declared it.
    pub type_written: String,
    /// Its default, as written.
    pub default: Option<String>,
    /// Whether it may be null.
    pub nullable: bool,
    /// ALWAYS or BY DEFAULT, of an identity column.
    pub identity: Option<String>,
    /// Its generation expression, of a generated column.
    pub generated: Option<String>,
    /// Its domain, if it is of one.
    pub domain: Option<String>,
}

/// A table's constraint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Constraint {
    /// Its name.
    pub name: String,
    /// PRIMARY KEY, UNIQUE, FOREIGN KEY or CHECK.
    pub kind: String,
    /// Its columns, in order, of a key.
    pub columns: Vec<String>,
    /// Its condition, of a CHECK.
    pub check: Option<String>,
    /// What a foreign key references.
    pub references: Option<Reference>,
    /// Whether it is deferrable.
    pub deferrable: bool,
}

/// What a foreign key references, and its rules.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    /// The referenced table's schema.
    pub schema: String,
    /// The referenced table.
    pub table: String,
    /// The referenced columns, in order.
    pub columns: Vec<String>,
    /// MATCH: NONE, PARTIAL or FULL.
    pub matching: String,
    /// ON UPDATE.
    pub on_update: String,
    /// ON DELETE.
    pub on_delete: String,
}

/// An index.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    /// Its name.
    pub name: String,
    /// Its method, as btree.
    pub method: String,
    /// Whether it is unique.
    pub unique: bool,
    /// Its columns, in order.
    pub columns: Vec<String>,
    /// Whether the server made it, for a constraint, its name then of the
    /// table's, or on a partition for its table's index: not written by
    /// CREATE INDEX of this table.
    pub implied: bool,
    /// The options set by WITH, each its name and its value as SQL
    /// writes it; an option left to its default is not among them.
    pub options: Vec<(String, String)>,
}

/// A partition of a partitioned table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Partition {
    /// Its schema.
    pub schema: String,
    /// Its name.
    pub name: String,
    /// Its bound, as written: `DEFAULT`, or `FOR VALUES ...`.
    pub bound: String,
    /// Whether it is partitioned again.
    pub partitioned: bool,
}

/// A base table's storage: the engine that keeps its rows, and the options
/// of the engine given it a value of their own, each as SQL writes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Storage {
    /// Its engine, as `rowstore` or `columnstore`.
    pub engine: String,
    /// Its options of a value of their own, each its name and its value.
    pub options: Vec<(String, String)>,
}

/// How a partitioned table is partitioned.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Partitioning {
    /// Its strategy, as RANGE.
    pub strategy: String,
    /// Its key's parts, as written.
    pub key: String,
    /// Its partitions one level down.
    pub partitions: Vec<Partition>,
}

/// The table a partition is a partition of.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartitionOf {
    /// The table's schema.
    pub schema: String,
    /// The table's name.
    pub name: String,
    /// The partition's bound, as written.
    pub bound: String,
}

/// A trigger.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trigger {
    /// Its schema.
    pub schema: String,
    /// Its name.
    pub name: String,
    /// INSERT, DELETE or UPDATE.
    pub event: String,
    /// BEFORE, AFTER or INSTEAD OF.
    pub timing: String,
    /// ROW or STATEMENT.
    pub orientation: String,
    /// Its WHEN condition, to its schema's owner.
    pub condition: Option<String>,
    /// Its action, to its schema's owner.
    pub action: Option<String>,
}

/// A privilege on a table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Privilege {
    /// Who granted it.
    pub grantor: String,
    /// Who holds it.
    pub grantee: String,
    /// SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER and the like.
    pub privilege: String,
    /// Whether it may be granted on.
    pub grantable: bool,
    /// The column it is on, of a privilege on a column.
    pub column: Option<String>,
}

/// A view's definition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    /// Its query, as written; none where it is too long for the view.
    pub definition: Option<String>,
    /// NONE, LOCAL or CASCADED.
    pub check_option: String,
}

/// A table or view, whole.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDetail {
    /// Its schema.
    pub schema: String,
    /// Its name.
    pub name: String,
    /// Its kind, as TABLES' TABLE_TYPE.
    pub kind: String,
    /// Its columns.
    pub columns: Vec<Column>,
    /// Its constraints, its NOT NULL constraints left to its columns.
    pub constraints: Vec<Constraint>,
    /// Its indexes.
    pub indexes: Vec<Index>,
    /// Its triggers.
    pub triggers: Vec<Trigger>,
    /// The privileges on it.
    pub privileges: Vec<Privilege>,
    /// Its definition, of a view.
    pub view: Option<View>,
    /// How it is partitioned, if it is.
    pub partitioning: Option<Partitioning>,
    /// The table it is a partition of, if it is one.
    pub partition_of: Option<PartitionOf>,
    /// Its storage, of a base table.
    pub storage: Option<Storage>,
}

/// A routine's parameter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Parameter {
    /// IN, OUT or INOUT.
    pub mode: String,
    /// Its name, if it has one.
    pub name: Option<String>,
    /// Its type as SQL writes it.
    pub type_written: String,
}

/// A routine, whole.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineDetail {
    /// Its schema.
    pub schema: String,
    /// Its specific name.
    pub specific: String,
    /// Its name.
    pub name: String,
    /// FUNCTION or PROCEDURE.
    pub kind: String,
    /// A function's result type.
    pub returns: Option<String>,
    /// Its parameters, in order.
    pub parameters: Vec<Parameter>,
    /// Its body, to its schema's owner.
    pub body: Option<String>,
    /// Whether it is deterministic.
    pub deterministic: bool,
    /// CONTAINS SQL, READS SQL DATA, MODIFIES SQL DATA or NO SQL.
    pub data_access: String,
    /// The privileges on it.
    pub privileges: Vec<Privilege>,
}

/// A sequence generator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sequence {
    /// Its name.
    pub name: String,
    /// Its type.
    pub type_written: String,
    /// START WITH.
    pub start: Option<String>,
    /// MINVALUE.
    pub minimum: Option<String>,
    /// MAXVALUE.
    pub maximum: Option<String>,
    /// INCREMENT BY.
    pub increment: Option<String>,
    /// Whether it cycles.
    pub cycle: bool,
}

/// A domain.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Domain {
    /// Its name.
    pub name: String,
    /// Its type.
    pub type_written: String,
    /// Its default.
    pub default: Option<String>,
    /// Its constraints, by name and condition.
    pub checks: Vec<(String, String)>,
}

/// An attribute of a structured type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attribute {
    /// Its name.
    pub name: String,
    /// Its type, as SQL writes it.
    pub type_written: String,
    /// Its default.
    pub default: Option<String>,
}

/// A user-defined type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserType {
    /// Its schema.
    pub schema: String,
    /// Its name.
    pub name: String,
    /// DISTINCT or STRUCTURED.
    pub category: String,
    /// Whether it is INSTANTIABLE.
    pub instantiable: bool,
    /// Whether it is FINAL.
    pub is_final: bool,
    /// A distinct type's source type, as SQL writes it.
    pub source: Option<String>,
    /// A structured type's attributes, in order, those it inherits first.
    pub attributes: Vec<Attribute>,
    /// A structured type's direct supertype, qualified, if it has one.
    pub supertype: Option<String>,
    /// How many of `attributes`, first, it inherits of its supertype.
    pub inherited: usize,
    /// How a structured type's references are represented: SYSTEM
    /// GENERATED, USER GENERATED or DERIVED.
    pub reference: Option<String>,
    /// Of USER GENERATED, the type its references are represented by.
    pub reference_using: Option<String>,
    /// Its method specifications, as CREATE TYPE writes them; not the
    /// observers and mutators of its attributes, which the type makes.
    pub methods: Vec<String>,
}

/// A user, as the Information Schema shows them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    /// Its name.
    pub name: String,
    /// Whether it is the database's owner.
    pub owner: bool,
    /// Whether it may create a role.
    pub create_role: bool,
}

/// A role granted, as APPLICABLE_ROLES shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleGrant {
    /// Who holds it.
    pub grantee: String,
    /// The role.
    pub role: String,
    /// Whether it is held WITH ADMIN OPTION.
    pub grantable: bool,
}

/// The users, the roles and the roles enabled.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Security {
    /// The users the session may see: all, to the owner; else itself.
    pub users: Vec<User>,
    /// The roles granted the user, and to the roles it holds.
    pub roles: Vec<RoleGrant>,
    /// The roles enabled in the session.
    pub enabled: Vec<String>,
    /// The roles the user may grant, revoke and drop.
    pub administrable: Vec<String>,
}

/// An object, by kind, schema and name, as a dependency or a search finds
/// it, or a favourite names it.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObjectRef {
    /// TABLE, VIEW, COLUMN, ROUTINE, TRIGGER or CONSTRAINT, as found;
    /// TABLE, ROUTINE, SEQUENCE, DOMAIN or TYPE, as a favourite.
    pub kind: String,
    /// Its schema.
    pub schema: String,
    /// Its name.
    pub name: String,
}

/// What an object uses, and what uses it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependencies {
    /// The tables a view, routine or trigger reads.
    pub uses: Vec<ObjectRef>,
    /// The views, routines, triggers and foreign keys that read or
    /// reference a table.
    pub used_by: Vec<ObjectRef>,
}

/// An object a search found, and where.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    /// The object.
    pub object: ObjectRef,
    /// Whether the text was found in its definition, not its name.
    pub in_definition: bool,
}
