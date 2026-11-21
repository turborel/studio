//! Reading each object of the catalog from its views' rows
//! (`[DOC sql/07-information-schema.md The views]`).

use std::collections::BTreeMap;

use crate::catalog::model::{
    Column, Constraint, Dependencies, Domain, Found, Index, ObjectRef, Parameter, Privilege, Reference, RoleGrant, RoutineDetail,
    RoutineRef, Schema, SchemaObjects, Security, Sequence, TableDetail, TableRef, Trigger, User, View,
};
use crate::catalog::names::qualified;
use crate::catalog::{Catalog, MAX_ROWS, need, queries, text, yes};
use crate::connections::cells::Cell;
use crate::error::{Result, StudioError};

/// What separates the columns of INDEXES' COLUMN_NAMES.
const COLUMN_LIST: &str = ", ";
/// The text of a check a NOT NULL column's constraint holds, after its name.
const IS_NOT_NULL: &str = " IS NOT NULL";
/// The kind of a check.
const CHECK: &str = "CHECK";
/// A view's kind, as TABLES' TABLE_TYPE.
const VIEW: &str = "VIEW";
/// A base table's TABLE_TYPE: of a table an engine keeps, its storage written.
const BASE_TABLE: &str = "BASE TABLE";

/// A type as SQL writes it, of the Information Schema's DATA_TYPE and its
/// length, precision and scale.
pub fn type_text(data_type: &str, length: Option<&str>, precision: Option<&str>, scale: Option<&str>) -> String {
    match (data_type, length, precision, scale) {
        ("CHARACTER" | "CHARACTER VARYING" | "BINARY" | "BINARY VARYING", Some(length), _, _) => format!("{data_type}({length})"),
        ("DECIMAL" | "NUMERIC", _, Some(precision), Some(scale)) => format!("{data_type}({precision},{scale})"),
        _ => data_type.to_owned(),
    }
}

/// A type of row `row`'s cells from `at`: DATA_TYPE, length, precision,
/// scale.
pub(crate) fn type_at(row: &[Cell], at: usize) -> String {
    let cell = |i: usize| text(row, at.saturating_add(i));
    type_text(&need(row, at), cell(1).as_deref(), cell(2).as_deref(), cell(3).as_deref())
}

impl Catalog<'_> {
    /// The schemas.
    ///
    /// # Errors
    ///
    /// The server's.
    pub fn schemas(&self) -> Result<Vec<Schema>> {
        Ok(self.rows(queries::SCHEMAS, &[])?.iter().map(|r| Schema { name: need(r, 0), owner: text(r, 1) }).collect())
    }

    /// What `schema` holds.
    ///
    /// # Errors
    ///
    /// The server's.
    pub fn objects(&self, schema: &str) -> Result<SchemaObjects> {
        let tables = self.rows(queries::TABLES, &[schema])?;
        let routines = self.rows(queries::ROUTINES, &[schema])?;
        let sequences = self.rows(queries::SEQUENCES, &[schema])?;
        let types = self.rows(queries::TYPES, &[schema])?;
        let domains = self.domains(schema)?;
        let lengths = [tables.len(), routines.len(), sequences.len(), types.len(), domains.len()];
        let truncated = lengths.iter().any(|n| u32::try_from(*n).unwrap_or(u32::MAX) >= MAX_ROWS);
        Ok(SchemaObjects {
            tables: tables.iter().map(|r| TableRef { name: need(r, 0), kind: need(r, 1) }).collect(),
            routines: routines.iter().map(|r| RoutineRef { specific: need(r, 0), name: need(r, 1), kind: need(r, 2) }).collect(),
            sequences: sequences.iter().map(|r| sequence(r)).collect(),
            domains,
            types: types.iter().map(|r| (need(r, 0), need(r, 1))).collect(),
            truncated,
        })
    }

    /// The domains of `schema`, each with its checks.
    fn domains(&self, schema: &str) -> Result<Vec<Domain>> {
        let mut checks: BTreeMap<String, Vec<(String, String)>> = BTreeMap::new();
        for row in self.rows(queries::DOMAIN_CHECKS, &[schema])? {
            checks.entry(need(&row, 0)).or_default().push((need(&row, 1), need(&row, 2)));
        }
        Ok(self
            .rows(queries::DOMAINS, &[schema])?
            .iter()
            .map(|r| Domain {
                name: need(r, 0),
                type_written: type_at(r, 1),
                default: text(r, 5),
                checks: checks.remove(&need(r, 0)).unwrap_or_default(),
            })
            .collect())
    }

    /// The table or view `schema`.`name`, whole.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the user may see no such table; the server's.
    pub fn table(&self, schema: &str, name: &str) -> Result<TableDetail> {
        let kind = self.rows(queries::TABLE_KIND, &[schema, name])?.first().map(|r| need(r, 0));
        let kind = kind.ok_or_else(|| StudioError::misuse(format!("[DESIGN] no table {schema}.{name} is to be seen")))?;
        let view = if kind == VIEW { self.view(schema, name)? } else { None };
        let columns = self.columns(schema, name)?;
        let partitioning = self.partitioning(schema, name)?;
        let partition_of = self.partition_of(schema, name)?;
        let mut indexes = self.indexes(schema, name)?;
        if partition_of.is_some() {
            let made = self.made_by_templates(schema, name)?;
            indexes.iter_mut().filter(|i| made.contains(&i.name)).for_each(|i| i.implied = true);
        }
        if partitioning.is_some() {
            indexes.extend(self.templates(schema, name)?);
        }
        let storage = if kind == BASE_TABLE { self.storage(schema, name)? } else { None };
        Ok(TableDetail {
            storage,
            schema: schema.to_owned(),
            name: name.to_owned(),
            constraints: self.constraints(schema, name, &columns)?,
            indexes,
            partitioning,
            partition_of,
            triggers: self.rows(queries::TRIGGERS, &[schema, name])?.iter().map(|r| trigger(r)).collect(),
            privileges: self.table_privileges(schema, name)?,
            columns,
            kind,
            view,
        })
    }

    /// A view's definition.
    fn view(&self, schema: &str, name: &str) -> Result<Option<View>> {
        Ok(self.rows(queries::VIEW, &[schema, name])?.first().map(|r| View { definition: text(r, 0), check_option: need(r, 1) }))
    }

    /// A table's columns, each of the type the server declares for it.
    fn columns(&self, schema: &str, name: &str) -> Result<Vec<Column>> {
        let declared = self.manager.describe(self.connection, &format!("SELECT * FROM {}", qualified(schema, name))).unwrap_or_default();
        let rows = self.rows(queries::COLUMNS, &[schema, name])?;
        Ok(rows
            .iter()
            .map(|r| {
                let name = need(r, 0);
                let written = declared.iter().find(|c| c.name.as_deref() == Some(name.as_str())).map(|c| c.type_written.clone());
                Column {
                    position: need(r, 1).parse().unwrap_or(0),
                    type_written: written.unwrap_or_else(|| type_at(r, 2)),
                    default: text(r, 6),
                    nullable: yes(r, 7),
                    identity: yes(r, 8).then(|| need(r, 9)),
                    generated: (need(r, 10) == "ALWAYS").then(|| need(r, 11)),
                    domain: text(r, 12),
                    name,
                }
            })
            .collect())
    }

    /// A table's constraints, their columns and references; the checks of
    /// its NOT NULL columns left to the columns.
    fn constraints(&self, schema: &str, name: &str, columns: &[Column]) -> Result<Vec<Constraint>> {
        let mut keys: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for row in self.rows(queries::KEY_COLUMNS, &[schema, name])? {
            keys.entry(need(&row, 0)).or_default().push(need(&row, 1));
        }
        let mut referenced: BTreeMap<String, (String, String, Vec<String>)> = BTreeMap::new();
        for row in self.rows(queries::REFERENCED, &[schema, name])? {
            let entry = referenced.entry(need(&row, 0)).or_insert_with(|| (need(&row, 1), need(&row, 2), Vec::new()));
            entry.2.push(need(&row, 3));
        }
        let not_null: Vec<String> =
            columns.iter().filter(|c| !c.nullable).map(|c| format!("{}{IS_NOT_NULL}", names_bare(&c.name))).collect();
        Ok(self
            .rows(queries::CONSTRAINTS, &[schema, name])?
            .iter()
            .filter(|r| !(need(r, 1) == CHECK && not_null.contains(&need(r, 3))))
            .map(|r| constraint(r, &mut keys, &mut referenced))
            .collect())
    }

    /// A table's indexes; those the server made for its keys marked.
    pub(crate) fn indexes(&self, schema: &str, name: &str) -> Result<Vec<Index>> {
        let mut options = self.index_options(schema, name)?;
        Ok(self
            .rows(queries::INDEXES, &[schema, name])?
            .iter()
            .map(|r| Index {
                options: options.remove(&need(r, 0)).unwrap_or_default(),
                name: need(r, 0),
                method: need(r, 1),
                unique: yes(r, 2),
                columns: need(r, 3).split(COLUMN_LIST).filter(|c| !c.is_empty()).map(str::to_owned).collect(),
                // A constraint's index is named by its table's name: no
                // name CREATE INDEX writes holds a period.
                implied: need(r, 0).contains('.'),
            })
            .collect())
    }

    /// The routine `schema`.`specific`, whole.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the user may see no such routine; the server's.
    pub fn routine(&self, schema: &str, specific: &str) -> Result<RoutineDetail> {
        let rows = self.rows(queries::ROUTINE, &[schema, specific])?;
        let row = rows.first().ok_or_else(|| StudioError::misuse(format!("[DESIGN] no routine {schema}.{specific} is to be seen")))?;
        let parameters = self
            .rows(queries::PARAMETERS, &[schema, specific])?
            .iter()
            .map(|r| Parameter { mode: need(r, 0), name: text(r, 1), type_written: type_at(r, 2) })
            .collect();
        Ok(RoutineDetail {
            schema: schema.to_owned(),
            specific: specific.to_owned(),
            name: need(row, 0),
            kind: need(row, 1),
            returns: text(row, 2).map(|_| type_at(row, 2)),
            parameters,
            body: text(row, 6),
            deterministic: yes(row, 7),
            data_access: need(row, 8),
            privileges: self.rows(queries::ROUTINE_PRIVILEGES, &[schema, specific])?.iter().map(|r| privilege(r)).collect(),
        })
    }

    /// The privileges on a table, then those on its columns.
    fn table_privileges(&self, schema: &str, name: &str) -> Result<Vec<Privilege>> {
        let mut privileges: Vec<Privilege> = self.rows(queries::PRIVILEGES, &[schema, name])?.iter().map(|r| privilege(r)).collect();
        privileges.extend(self.rows(queries::COLUMN_PRIVILEGES, &[schema, name])?.iter().map(|r| privilege(r)));
        Ok(privileges)
    }

    /// USAGE on the domain or sequence generator `schema`.`name`, its kind
    /// `DOMAIN` or `SEQUENCE`.
    ///
    /// # Errors
    ///
    /// The server's.
    pub fn usage(&self, schema: &str, name: &str, kind: &str) -> Result<Vec<Privilege>> {
        Ok(self.rows(queries::USAGE_PRIVILEGES, &[schema, name, kind])?.iter().map(|r| privilege(r)).collect())
    }

    /// The users, the roles granted, and the roles enabled.
    ///
    /// # Errors
    ///
    /// The server's.
    pub fn security(&self) -> Result<Security> {
        Ok(Security {
            users: self
                .rows(queries::USERS, &[])?
                .iter()
                .map(|r| User { name: need(r, 0), owner: yes(r, 1), create_role: yes(r, 2) })
                .collect(),
            roles: self
                .rows(queries::ROLES, &[])?
                .iter()
                .map(|r| RoleGrant { grantee: need(r, 0), role: need(r, 1), grantable: yes(r, 2) })
                .collect(),
            enabled: self.rows(queries::ENABLED_ROLES, &[])?.iter().map(|r| need(r, 0)).collect(),
            administrable: self.rows(queries::ADMINISTRABLE_ROLES, &[])?.iter().map(|r| need(r, 0)).collect(),
        })
    }

    /// The database's settings.
    ///
    /// # Errors
    ///
    /// The server's.
    pub fn settings(&self) -> Result<Vec<crate::analyzer::Setting>> {
        Ok(self
            .rows(queries::SETTINGS, &[])?
            .iter()
            .map(|r| crate::analyzer::Setting {
                name: need(r, 0),
                value: text(r, 1).unwrap_or_default(),
                source: need(r, 2),
                default: text(r, 3).unwrap_or_default(),
                takes_effect: need(r, 4),
                description: text(r, 5).unwrap_or_default(),
            })
            .collect())
    }

    /// What the analyzer finds of `schema`'s base tables, read whole, and
    /// the database's settings.
    ///
    /// # Errors
    ///
    /// The server's.
    pub fn analysis(&self, schema: &str) -> Result<crate::analyzer::Analysis> {
        let objects = self.objects(schema)?;
        let mut tables = Vec::with_capacity(objects.tables.len());
        for table in objects.tables.iter().filter(|t| crate::analyzer::is_base(&t.kind)) {
            tables.push(self.table(schema, &table.name)?);
        }
        Ok(crate::analyzer::analyze(&tables, &self.settings()?))
    }

    /// The parts of `schema`'s script: its domains, sequences, tables in
    /// the order their foreign keys need, and routines.
    ///
    /// # Errors
    ///
    /// The server's.
    pub fn schema_parts(&self, schema: &str) -> Result<crate::catalog::ddl::SchemaParts> {
        let objects = self.objects(schema)?;
        let mut tables = Vec::with_capacity(objects.tables.len());
        for table in &objects.tables {
            tables.push(self.table(schema, &table.name)?);
        }
        let mut routines = Vec::with_capacity(objects.routines.len());
        for routine in &objects.routines {
            routines.push(self.routine(schema, &routine.specific)?);
        }
        let mut types = Vec::with_capacity(objects.types.len());
        for (name, _) in &objects.types {
            types.push(self.user_type(schema, name)?);
        }
        Ok(crate::catalog::ddl::SchemaParts {
            types,
            domains: objects.domains,
            sequences: objects.sequences,
            tables: crate::catalog::ddl::ordered(tables),
            routines,
        })
    }

    /// What `schema`.`name` uses, and what uses it.
    ///
    /// # Errors
    ///
    /// The server's.
    pub fn dependencies(&self, schema: &str, name: &str) -> Result<Dependencies> {
        let uses = self.rows(queries::USES, &[schema, name, schema, name, schema, name])?;
        let used_by = self.rows(queries::USED_BY, &[schema, name, schema, name, schema, name, schema, name, schema, name])?;
        Ok(Dependencies { uses: uses.iter().map(|r| object(r)).collect(), used_by: used_by.iter().map(|r| object(r)).collect() })
    }

    /// The objects whose names, or definitions, hold `text`, in any case.
    ///
    /// # Errors
    ///
    /// The server's.
    pub fn search(&self, text: &str) -> Result<Vec<Found>> {
        let upper = text.to_uppercase();
        let named = self.rows(queries::SEARCH_NAMES, &[&upper, &upper, &upper])?;
        let defined = self.rows(queries::SEARCH_DEFINITIONS, &[&upper, &upper, &upper, &upper])?;
        let mut found: Vec<Found> = named.iter().map(|r| Found { object: object(r), in_definition: false }).collect();
        found.extend(defined.iter().map(|r| Found { object: object(r), in_definition: true }));
        Ok(found)
    }
}

/// A name as it stands in a check's condition: bare, as the server writes
/// a column of a regular name.
fn names_bare(name: &str) -> String {
    crate::catalog::names::ident(name)
}

/// A sequence of a row of SEQUENCES.
fn sequence(r: &[Cell]) -> Sequence {
    Sequence {
        name: need(r, 0),
        type_written: type_text(&need(r, 1), None, text(r, 2).as_deref(), text(r, 3).as_deref()),
        start: text(r, 4),
        minimum: text(r, 5),
        maximum: text(r, 6),
        increment: text(r, 7),
        cycle: yes(r, 8),
    }
}

/// A trigger of a row of TRIGGERS.
fn trigger(r: &[Cell]) -> Trigger {
    Trigger {
        schema: need(r, 0),
        name: need(r, 1),
        event: need(r, 2),
        timing: need(r, 3),
        orientation: need(r, 4),
        condition: text(r, 5),
        action: text(r, 6),
    }
}

/// A privilege of a row of TABLE_PRIVILEGES.
/// A privilege of a row of grantor, grantee, privilege, whether grantable
/// and, of a column's, its column.
pub(crate) fn privilege(r: &[Cell]) -> Privilege {
    Privilege { grantor: need(r, 0), grantee: need(r, 1), privilege: need(r, 2), grantable: yes(r, 3), column: text(r, 4) }
}

/// An object of a row of kind, schema and name; the kind, a literal of a
/// UNION, comes padded to the longest's length, and is trimmed.
fn object(r: &[Cell]) -> ObjectRef {
    ObjectRef { kind: need(r, 0).trim_end().to_owned(), schema: need(r, 1), name: need(r, 2) }
}

/// A constraint of a row of CONSTRAINTS, its columns and reference taken
/// from `keys` and `referenced`.
fn constraint(
    r: &[Cell],
    keys: &mut BTreeMap<String, Vec<String>>,
    referenced: &mut BTreeMap<String, (String, String, Vec<String>)>,
) -> Constraint {
    let name = need(r, 0);
    let target = referenced.remove(&name).map(|(schema, table, columns)| Reference {
        schema,
        table,
        columns,
        matching: need(r, 4),
        on_update: need(r, 5),
        on_delete: need(r, 6),
    });
    Constraint {
        columns: keys.remove(&name).unwrap_or_default(),
        kind: need(r, 1),
        check: text(r, 3),
        deferrable: yes(r, 2),
        references: target,
        name,
    }
}
