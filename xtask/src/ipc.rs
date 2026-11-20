//! The IPC's three lists (RULES.md R-SEC-5): the commands `build.rs` names
//! as permissions, those the handler registers, and those the window's
//! capability grants, held equal, so no command is reachable that is not
//! granted, and none granted that does not exist.

use std::collections::BTreeSet;

use crate::command::root;
use crate::error::{Result, fail};

/// The build script that names the commands.
const BUILD: &str = "src-tauri/build.rs";
/// The file that registers them.
const HANDLER: &str = "src-tauri/src/commands.rs";
/// The main window's capability.
const CAPABILITY: &str = "src-tauri/capabilities/main.json";
/// The prefix of a permission that allows an application command.
const ALLOW: &str = "allow-";

/// Checks the three lists are one.
pub fn check_commands() -> Result<()> {
    let named = named(&std::fs::read_to_string(root().join(BUILD))?);
    let registered = registered(&std::fs::read_to_string(root().join(HANDLER))?);
    let granted = granted(&std::fs::read_to_string(root().join(CAPABILITY))?)?;
    if named == registered && named == granted {
        return Ok(());
    }
    fail(format!("the IPC's lists differ (R-SEC-5):\n  {BUILD}: {named:?}\n  {HANDLER}: {registered:?}\n  {CAPABILITY}: {granted:?}"))
}

/// The commands of `build.rs`'s `COMMANDS`, as strings in its brackets.
pub fn named(text: &str) -> BTreeSet<String> {
    let list = text.split_once("const COMMANDS").and_then(|(_, rest)| rest.split_once("= [")).map(|(_, r)| r).unwrap_or_default();
    let list = list.split_once("];").map_or(list, |(l, _)| l);
    list.split('"').skip(1).step_by(2).map(str::to_owned).collect()
}

/// The commands `generate_handler!` registers, each by its last name.
pub fn registered(text: &str) -> BTreeSet<String> {
    let list = text.split_once("generate_handler![").map(|(_, r)| r).unwrap_or_default();
    let list = list.split_once(']').map_or(list, |(l, _)| l);
    list.split(',').map(|n| n.trim().rsplit("::").next().unwrap_or_default().to_owned()).filter(|n| !n.is_empty()).collect()
}

/// The commands the capability `text` grants, by their permissions.
pub fn granted(text: &str) -> Result<BTreeSet<String>> {
    let json: serde_json::Value = serde_json::from_str(text).map_err(|e| crate::error::Error(format!("{CAPABILITY}: {e}")))?;
    let permissions = json.get("permissions").and_then(serde_json::Value::as_array).cloned().unwrap_or_default();
    Ok(permissions
        .iter()
        .filter_map(serde_json::Value::as_str)
        .filter_map(|p| p.strip_prefix(ALLOW))
        .map(|p| p.replace('-', "_"))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{granted, named, registered};

    /// [RULE] R-SEC-5: the three lists are read as each file writes them.
    #[test]
    fn each_list_is_read_from_its_file() {
        let build = "const COMMANDS: [&str; 2] = [\"app_info\", \"run_query\"];\nfn main() {}";
        let handler = "tauri::generate_handler![app_info, session::run_query]";
        let capability = r#"{"permissions": ["core:event:allow-listen", "allow-app-info", "allow-run-query"]}"#;
        let expected: Vec<String> = vec!["app_info".into(), "run_query".into()];
        assert_eq!(named(build).into_iter().collect::<Vec<_>>(), expected);
        assert_eq!(registered(handler).into_iter().collect::<Vec<_>>(), expected);
        assert_eq!(granted(capability).unwrap().into_iter().collect::<Vec<_>>(), expected);
    }
}
