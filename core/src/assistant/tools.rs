//! The assistant's tools (RULES.md D55), in a fixed order: the catalog's,
//! EXPLAIN and the analyzer's findings, which the model may call freely;
//! `run_query`, which runs only once the user approves the call; and
//! `propose_sql`, which drafts SQL into a worksheet and never runs it. Each
//! input is checked against its tool's schema before it is used, as a
//! model's input streamed eagerly is not checked by the API.

use serde_json::{Map, Value, json};

use crate::assistant::wire::ToolDef;

/// The longest string an input gives, in characters.
const MAX_INPUT_CHARS: usize = 100_000;

/// An object's schema of `properties`, each a string, every one required,
/// no other allowed.
fn strings(properties: &[(&str, &str)]) -> Value {
    let mut props = Map::new();
    for (name, description) in properties {
        props.insert((*name).to_owned(), json!({"type": "string", "description": description}));
    }
    json!({"type": "object", "properties": props, "required": properties.iter().map(|(n, _)| *n).collect::<Vec<_>>(), "additionalProperties": false})
}

/// Every tool, in the fixed order requests list them.
pub fn tools() -> Vec<ToolDef> {
    vec![
        ToolDef { name: "list_schemas", description: "Lists the database's schemas the assistant may see.", schema: strings(&[]) },
        ToolDef {
            name: "list_tables",
            description: "Lists a schema's tables and views, each with its kind.",
            schema: strings(&[("schema", "The schema's name, as the catalog gives it.")]),
        },
        ToolDef {
            name: "describe_table",
            description: "Describes a table or view: its columns and their types, its keys and constraints, and its indexes.",
            schema: strings(&[("schema", "The table's schema."), ("table", "The table's name.")]),
        },
        ToolDef {
            name: "explain",
            description: "Runs EXPLAIN of one query and returns its plan's text. It never runs the query.",
            schema: strings(&[("sql", "One query: a SELECT, VALUES, TABLE or WITH.")]),
        },
        ToolDef {
            name: "analyzer_findings",
            description: "Returns the analyzer's findings of a schema: missing indexes, duplicate indexes, tables of no key, and settings to review, each with its fix as SQL.",
            schema: strings(&[("schema", "The schema's name.")]),
        },
        ToolDef {
            name: "run_query",
            description: "Asks the user to approve running one read-only query; if approved, runs it in a READ ONLY transaction and returns its first rows.",
            schema: strings(&[("sql", "One query: a SELECT, VALUES, TABLE or WITH."), ("purpose", "Why it is run, shown to the user.")]),
        },
        ToolDef {
            name: "propose_sql",
            description: "Puts SQL into a worksheet for the user to read and run. It never runs it.",
            schema: strings(&[
                ("sql", "The statements proposed."),
                ("title", "A short title of the worksheet."),
                ("why", "What the statements do, and why."),
            ]),
        },
    ]
}

/// The input `text` of tool `name`, checked against its schema: an object
/// of its properties alone, each required one a string of at most
/// `MAX_INPUT_CHARS` characters.
///
/// # Errors
///
/// What is wrong with it, for the model to read.
pub fn checked_input(name: &str, text: &str) -> Result<Map<String, Value>, String> {
    let tools = tools();
    let tool = tools.iter().find(|t| t.name == name).ok_or_else(|| format!("no tool is named {name}"))?;
    let value: Value = serde_json::from_str(if text.trim().is_empty() { "{}" } else { text })
        .map_err(|_| format!("{{\"INVALID_JSON\": {}}}", Value::String(text.to_owned())))?;
    let Value::Object(input) = value else { return Err("the input is not an object".to_owned()) };
    let properties = tool.schema.get("properties").and_then(Value::as_object).cloned().unwrap_or_default();
    if let Some(extra) = input.keys().find(|k| !properties.contains_key(*k)) {
        return Err(format!("the input has no property {extra}"));
    }
    for name in properties.keys() {
        match input.get(name) {
            Some(Value::String(s)) if s.chars().count() <= MAX_INPUT_CHARS => {}
            Some(Value::String(_)) => return Err(format!("{name} is longer than {MAX_INPUT_CHARS} characters")),
            Some(_) => return Err(format!("{name} is not a string")),
            None => return Err(format!("{name} is required")),
        }
    }
    Ok(input)
}

/// The string `name` of a checked `input`.
pub fn text<'a>(input: &'a Map<String, Value>, name: &str) -> &'a str {
    input.get(name).and_then(Value::as_str).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{checked_input, text, tools};

    /// [DESIGN] D55: the tools are listed in a fixed order, each strict.
    #[test]
    fn the_tools_are_fixed_and_strict() {
        let names: Vec<&str> = tools().iter().map(|t| t.name).collect();
        assert_eq!(names, ["list_schemas", "list_tables", "describe_table", "explain", "analyzer_findings", "run_query", "propose_sql"]);
        assert!(tools().iter().all(|t| t.schema["additionalProperties"] == false));
    }

    /// [DESIGN] D55: an input is checked against its schema before it is
    /// used: no JSON, no object, a property of none, one missing, one not
    /// a string, one too long, are each refused, saying why.
    #[test]
    fn an_input_is_checked() {
        let ok = checked_input("describe_table", r#"{"schema":"ANN","table":"STAFF"}"#).unwrap();
        assert_eq!(text(&ok, "table"), "STAFF");
        assert!(checked_input("list_schemas", "").unwrap().is_empty());
        assert!(checked_input("explain", "{\"sql\":").unwrap_err().contains("INVALID_JSON"));
        assert_eq!(checked_input("explain", "[1]").unwrap_err(), "the input is not an object");
        assert_eq!(checked_input("explain", r#"{"sql":"x","drop":1}"#).unwrap_err(), "the input has no property drop");
        assert_eq!(checked_input("explain", "{}").unwrap_err(), "sql is required");
        assert_eq!(checked_input("explain", r#"{"sql":1}"#).unwrap_err(), "sql is not a string");
        let long = format!(r#"{{"sql":"{}"}}"#, "x".repeat(100_001));
        assert!(checked_input("explain", &long).unwrap_err().contains("longer than"));
        assert_eq!(checked_input("rm", "{}").unwrap_err(), "no tool is named rm");
    }
}
