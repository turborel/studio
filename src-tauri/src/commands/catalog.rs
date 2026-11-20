//! The commands of the catalog (RULES.md D33): its schemas, a schema's
//! objects, an object whole, its definition as SQL, what it uses and what
//! uses it, and a search; each read over the connection, on Tauri's pool
//! of blocking threads.

// `tauri::command`'s expansion of an async command holds an `unreachable!`
// of its own, which no code here writes.
#![allow(clippy::unreachable, reason = "tauri::command's expansion of an async command")]

use serde::Deserialize;
use tauri::State;
use turborel_studio_core::catalog::Catalog;
use turborel_studio_core::catalog::ddl::{self, ScriptAs};
use turborel_studio_core::catalog::model::{
    Dependencies, Found, Privilege, RoutineDetail, Schema, SchemaObjects, Security, TableDetail, UserType,
};
use turborel_studio_core::error::{Result, StudioError};
use turborel_studio_core::events::ConnectionId;

use crate::commands::connections::blocking;
use crate::state::Studio;

/// The longest name the catalog is asked of, in characters: the
/// Information Schema's names are at most 128.
const MAX_NAME_CHARS: usize = 128;
/// The longest text searched for, in characters.
const MAX_SEARCH_CHARS: usize = 256;

/// `value`, refused if empty, longer than `max` characters, or holding a
/// control character (R-SEC-6).
fn bounded(what: &str, value: &str, max: usize) -> Result<()> {
    if value.is_empty() || value.chars().count() > max || value.chars().any(char::is_control) {
        return Err(StudioError::misuse(format!("[DESIGN] {what} is 1 to {max} characters, none a control")));
    }
    Ok(())
}

/// What a definition is asked of.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", deny_unknown_fields)]
pub(crate) enum Definition {
    /// A table or view, scripted as `script`.
    Table { schema: String, name: String, script: ScriptAs },
    /// A routine, by its specific name.
    Routine { schema: String, specific: String },
    /// A sequence generator.
    Sequence { schema: String, name: String },
    /// A domain.
    Domain { schema: String, name: String },
    /// A user-defined type.
    Type { schema: String, name: String },
    /// A whole schema.
    Schema { schema: String },
}

/// The schemas the user may see.
#[tauri::command]
pub(crate) async fn catalog_schemas(studio: State<'_, Studio>, connection: ConnectionId) -> Result<Vec<Schema>> {
    blocking(&studio, move |m| Catalog::of(m, connection).schemas()).await
}

/// What a schema holds.
#[tauri::command]
pub(crate) async fn catalog_objects(studio: State<'_, Studio>, connection: ConnectionId, schema: String) -> Result<SchemaObjects> {
    bounded("a schema", &schema, MAX_NAME_CHARS)?;
    blocking(&studio, move |m| Catalog::of(m, connection).objects(&schema)).await
}

/// A table or view, whole.
#[tauri::command]
pub(crate) async fn catalog_table(
    studio: State<'_, Studio>,
    connection: ConnectionId,
    schema: String,
    name: String,
) -> Result<TableDetail> {
    bounded("a schema", &schema, MAX_NAME_CHARS)?;
    bounded("a table", &name, MAX_NAME_CHARS)?;
    blocking(&studio, move |m| Catalog::of(m, connection).table(&schema, &name)).await
}

/// A routine, whole.
#[tauri::command]
pub(crate) async fn catalog_routine(
    studio: State<'_, Studio>,
    connection: ConnectionId,
    schema: String,
    specific: String,
) -> Result<RoutineDetail> {
    bounded("a schema", &schema, MAX_NAME_CHARS)?;
    bounded("a routine", &specific, MAX_NAME_CHARS)?;
    blocking(&studio, move |m| Catalog::of(m, connection).routine(&schema, &specific)).await
}

/// A user-defined type, whole.
#[tauri::command]
pub(crate) async fn catalog_type(studio: State<'_, Studio>, connection: ConnectionId, schema: String, name: String) -> Result<UserType> {
    bounded("a schema", &schema, MAX_NAME_CHARS)?;
    bounded("a type", &name, MAX_NAME_CHARS)?;
    blocking(&studio, move |m| Catalog::of(m, connection).user_type(&schema, &name)).await
}

/// What USAGE is read of.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum UsageOf {
    /// A domain.
    Domain,
    /// A sequence generator.
    Sequence,
}

/// USAGE granted on a domain or a sequence generator.
#[tauri::command]
pub(crate) async fn catalog_usage(
    studio: State<'_, Studio>,
    connection: ConnectionId,
    schema: String,
    name: String,
    of: UsageOf,
) -> Result<Vec<Privilege>> {
    bounded("a schema", &schema, MAX_NAME_CHARS)?;
    bounded("an object", &name, MAX_NAME_CHARS)?;
    let kind = match of {
        UsageOf::Domain => "DOMAIN",
        UsageOf::Sequence => "SEQUENCE",
    };
    blocking(&studio, move |m| Catalog::of(m, connection).usage(&schema, &name, kind)).await
}

/// The users, the roles granted and those enabled.
#[tauri::command]
pub(crate) async fn catalog_security(studio: State<'_, Studio>, connection: ConnectionId) -> Result<Security> {
    blocking(&studio, move |m| Catalog::of(m, connection).security()).await
}

/// What an object uses, and what uses it.
#[tauri::command]
pub(crate) async fn catalog_dependencies(
    studio: State<'_, Studio>,
    connection: ConnectionId,
    schema: String,
    name: String,
) -> Result<Dependencies> {
    bounded("a schema", &schema, MAX_NAME_CHARS)?;
    bounded("an object", &name, MAX_NAME_CHARS)?;
    blocking(&studio, move |m| Catalog::of(m, connection).dependencies(&schema, &name)).await
}

/// The objects whose names or definitions hold a text.
#[tauri::command]
pub(crate) async fn catalog_search(studio: State<'_, Studio>, connection: ConnectionId, text: String) -> Result<Vec<Found>> {
    bounded("a search", &text, MAX_SEARCH_CHARS)?;
    blocking(&studio, move |m| Catalog::of(m, connection).search(&text)).await
}

/// An object's definition as SQL, or a table scripted as a statement.
#[tauri::command]
pub(crate) async fn catalog_definition(studio: State<'_, Studio>, connection: ConnectionId, of: Definition) -> Result<String> {
    blocking(&studio, move |m| {
        let catalog = Catalog::of(m, connection);
        match of {
            Definition::Table { schema, name, script } => Ok(ddl::script(&catalog.table(&schema, &name)?, script)),
            Definition::Routine { schema, specific } => Ok(ddl::create_routine(&catalog.routine(&schema, &specific)?)),
            Definition::Sequence { schema, name } => {
                one(catalog.objects(&schema)?.sequences, &name, |s| &s.name).map(|s| ddl::create_sequence(&schema, &s))
            }
            Definition::Domain { schema, name } => {
                one(catalog.objects(&schema)?.domains, &name, |d| &d.name).map(|d| ddl::create_domain(&schema, &d))
            }
            Definition::Type { schema, name } => Ok(ddl::create_type(&catalog.user_type(&schema, &name)?)),
            Definition::Schema { schema } => Ok(ddl::schema_script(&schema, &catalog.schema_parts(&schema)?)),
        }
    })
    .await
}

/// The item of `items` named `name`.
fn one<T>(items: Vec<T>, name: &str, named: impl Fn(&T) -> &String) -> Result<T> {
    items.into_iter().find(|i| named(i) == name).ok_or_else(|| StudioError::misuse(format!("[DESIGN] no object {name} is to be seen")))
}
