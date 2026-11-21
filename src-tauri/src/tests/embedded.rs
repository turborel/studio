//! Embedded databases' commands, called as the webview calls them (RULES.md
//! D59): a folder used only as the user chose it, a database opened, made,
//! saved and opened again, what it was given, and Studio's quitting.

use tauri::Manager;
use tauri::test::get_ipc_response;

use super::{answer, refusal, request, window};
use crate::commands::embedded::{Ending, end_all};
use crate::state::Studio;

/// A new folder's path under the system's temporary folder, made empty.
fn folder(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("studio-embedded-app-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir); // Left by an earlier run, if any.
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// What opens or makes the database in `dir`.
fn spec(dir: &std::path::Path, create: bool) -> serde_json::Value {
    serde_json::json!({
        "place": {"kind": "directory", "path": dir.display().to_string()},
        "create": create, "keys": null, "checksumKey": null, "pluginDirectories": null, "user": "ANN"
    })
}

/// The guards of a development connection.
fn guards() -> serde_json::Value {
    serde_json::json!({"environment": "development", "readOnly": false})
}

/// [DESIGN] D59 [RULE] R-SEC-5: a folder the user did not choose is
/// refused; one chosen is looked at, a database made in it, saved, and
/// opened again as saved; its plug-ins are told; a saved folder not chosen
/// is refused.
#[test]
fn a_database_is_made_in_a_folder_chosen_saved_and_opened_again() {
    let (app, window) = window();
    let dir = folder("made");
    let path = serde_json::json!({"path": dir.display().to_string()});
    assert_eq!(refusal(&window, "check_database_directory", path.clone())["sqlstate"], "TB910");
    assert_eq!(refusal(&window, "open_embedded", serde_json::json!({"spec": spec(&dir, true), "guards": guards()}))["sqlstate"], "TB910");
    app.state::<Studio>().files.choose(&dir).unwrap();
    assert_eq!(answer(&window, "check_database_directory", path)["holds"], "empty");
    let opened = answer(&window, "open_embedded", serde_json::json!({"spec": spec(&dir, true), "guards": guards()}));
    assert_eq!(opened["session"]["transport"], "embedded");
    let id = opened["connection"].clone();
    let info = answer(&window, "embedded_info", serde_json::json!({"connection": id}));
    assert_eq!(info["user"], "ANN");
    assert!(info["plugIns"].as_array().unwrap().iter().any(|p| p["name"] == "LZ4"));
    answer(&window, "close_connection", serde_json::json!({"connection": id}));
    let saved = serde_json::json!({
        "id": "", "name": "Made", "folder": [], "spec": {}, "environment": "development", "colour": null,
        "readOnly": false, "pinned": false, "favourites": [],
        "embedded": {"directory": dir.display().to_string(), "keys": null, "checksumKey": null, "pluginDirectories": null, "user": null}
    });
    let made = answer(&window, "save_connection", serde_json::json!({"connection": saved, "password": {"kind": "keep"}}));
    let reopened = answer(&window, "open_saved_connection", serde_json::json!({"id": made["id"], "password": null}));
    assert_eq!(reopened["session"]["authorization"], "ANN");
    answer(&window, "close_connection", serde_json::json!({"connection": reopened["connection"]}));
    let elsewhere = serde_json::json!({
        "id": made["id"], "name": "Made", "folder": [], "spec": {}, "environment": "development", "colour": null,
        "readOnly": false, "pinned": false, "favourites": [],
        "embedded": {"directory": "/not/chosen", "keys": null, "checksumKey": null, "pluginDirectories": null, "user": null}
    });
    assert_eq!(
        refusal(&window, "save_connection", serde_json::json!({"connection": elsewhere, "password": {"kind": "keep"}}))["sqlstate"],
        "TB910"
    );
    assert!(answer(&window, "default_owner", serde_json::json!({})).is_string());
    std::fs::remove_dir_all(&dir).unwrap();
}

/// [DESIGN] D59: quitting ends each open transaction as answered, commits
/// kept, and closes every connection, its worker with it; it asks the
/// window once, and a second request within the time quits.
#[test]
fn quitting_ends_open_transactions_and_closes_every_database() {
    let (app, window) = window();
    let memory = serde_json::json!({"place": {"kind": "memory"}, "create": true, "keys": null, "checksumKey": null, "pluginDirectories": null, "user": null});
    let id = answer(&window, "open_embedded", serde_json::json!({"spec": memory, "guards": guards()}))["connection"].as_u64().unwrap();
    let studio = app.state::<Studio>();
    let manager = &studio.connections;
    manager.run(id, "CREATE TABLE KEPT (N INTEGER)", true).unwrap();
    manager.run(id, "INSERT INTO KEPT VALUES (1)", true).unwrap();
    assert!(manager.session(id).unwrap().transaction.active);
    end_all(manager, Ending::Commit).unwrap();
    assert_eq!(manager.threads(), []);
    assert!(crate::ask_before_quitting(app.handle()));
    assert!(!crate::ask_before_quitting(app.handle()));
    let again = answer(&window, "open_embedded", serde_json::json!({"spec": memory, "guards": guards()}));
    assert!(get_ipc_response(&window, request(&window, "list_threads", serde_json::json!({}))).is_ok());
    crate::quitting(app.handle(), tauri::RunEvent::Exit);
    assert_eq!(manager.threads(), [], "{again}");
}
