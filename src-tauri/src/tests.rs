//! The application's commands, called as the webview calls them, on
//! Tauri's mock runtime: the one harness of the application's tests
//! (RULES.md R-TEST-7).

use tauri::http::HeaderMap;
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use std::sync::Arc;

use turborel_studio_core::secrets::MemorySecrets;

use crate::studio;

/// The application on the mock runtime, with its own configuration and
/// capabilities, and its main window.
pub(crate) fn window() -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let app = studio(mock_builder()).build(crate::context()).unwrap();
    // The mock runtime runs no event loop, so the setup it would run as
    // the loop starts is run here, its results kept under the build's
    // target directory rather than the user's cache.
    let scratch = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("target")
        .join("test-scratch")
        .join("app")
        .join(std::thread::current().name().unwrap_or("unnamed").replace("::", "-"));
    let _ = std::fs::remove_dir_all(&scratch);
    let folders = crate::Folders { results: scratch.join("results"), config: scratch.join("config") };
    let keychain = crate::state::KeychainStatus { available: false, reason: Some("the tests keep secrets in memory".into()) };
    crate::manage(&app, &folders, (Arc::new(MemorySecrets::default()), keychain)).unwrap();
    let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default()).build().unwrap();
    (app, window)
}

/// The request of `command` with `args`, from `window`'s page.
pub(crate) fn request(window: &WebviewWindow<MockRuntime>, command: &str, args: serde_json::Value) -> InvokeRequest {
    InvokeRequest {
        cmd: command.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: window.url().unwrap(),
        body: InvokeBody::Json(args),
        headers: HeaderMap::default(),
        invoke_key: INVOKE_KEY.to_string(),
    }
}

/// The JSON a command answered with.
pub(crate) fn json(body: InvokeResponseBody) -> serde_json::Value {
    match body {
        InvokeResponseBody::Json(json) => serde_json::from_str(&json).unwrap(),
        InvokeResponseBody::Raw(raw) => serde_json::from_slice(&raw).unwrap(),
    }
}

/// [DESIGN] D5: `app_info` gives the version and the pinned commit, as
/// the front end's `AppInfo` reads them.
#[test]
fn app_info_gives_the_version_and_the_pinned_commit() {
    let (_app, window) = window();
    let info = json(get_ipc_response(&window, request(&window, "app_info", serde_json::json!({}))).unwrap());
    assert_eq!(info["version"], turborel_studio_core::version::VERSION);
    assert_eq!(info["turborelCommit"], turborel_studio_core::version::TURBOREL_COMMIT);
}

/// [RULE] R-SEC-5: the webview reaches no plug-in: a file system, shell or
/// HTTP command is refused, as the capability grants none.
#[test]
fn no_plugin_command_is_granted() {
    let (_app, window) = window();
    for command in ["plugin:fs|read_file", "plugin:shell|execute", "plugin:http|fetch", "plugin:notification|notify"] {
        assert!(get_ipc_response(&window, request(&window, command, serde_json::json!({}))).is_err(), "{command}");
    }
}

/// What a command refused with, as the webview is given it.
fn refusal(window: &WebviewWindow<MockRuntime>, command: &str, args: serde_json::Value) -> serde_json::Value {
    get_ipc_response(window, request(window, command, args)).unwrap_err()
}

/// [RULE] R-SEC-6: a request of a connection that is not open is refused
/// with Studio's error, SQLSTATE TB910.
#[test]
fn a_connection_not_open_is_refused() {
    let (_app, window) = window();
    let error = refusal(&window, "run_statement", serde_json::json!({"connection": 7, "sql": "VALUES (1)", "confirmed": false}));
    assert_eq!(error["sqlstate"], "TB910");
    assert_eq!(error["sqlcode"], -910);
    let error = refusal(&window, "fetch_rows", serde_json::json!({"connection": 7, "result": 1, "from": 0, "count": 10}));
    assert_eq!(error["sqlstate"], "TB910");
}

/// [RULE] R-SEC-6: settings are refused before any connection: a field
/// the dialog has not, and settings that name no user.
#[test]
fn bad_settings_are_refused() {
    let (_app, window) = window();
    let guards = serde_json::json!({"environment": "development", "readOnly": false});
    let unknown = serde_json::json!({"spec": {"user": "ann", "secret": "x"}, "guards": guards, "password": null});
    assert!(get_ipc_response(&window, request(&window, "open_connection", unknown)).is_err());
    let no_user = serde_json::json!({"spec": {"host": "db.example"}, "guards": guards, "password": null});
    assert_eq!(refusal(&window, "open_connection", no_user)["sqlstate"], "08001");
}

/// [RULE] R-SAFE-5: with no connection open, the manager holds no thread.
#[test]
fn no_thread_is_held_with_no_connection() {
    let (_app, window) = window();
    let threads = json(get_ipc_response(&window, request(&window, "list_threads", serde_json::json!({}))).unwrap());
    assert_eq!(threads, serde_json::json!([]));
}

/// [RULE] R-SEC-6: every command of a connection refuses one not open,
/// with Studio's error, before it reaches a server.
#[test]
fn every_connection_command_refuses_a_connection_not_open() {
    let (_app, window) = window();
    let id = serde_json::json!({"connection": 7});
    let result = serde_json::json!({"connection": 7, "result": 1});
    let on = serde_json::json!({"connection": 7, "on": true});
    for (command, args) in [
        ("close_connection", &id),
        ("reconnect", &id),
        ("cancel_statement", &id),
        ("session_state", &id),
        ("ping_connection", &id),
        ("close_result", &result),
        ("set_autocommit", &on),
        ("result_value", &serde_json::json!({"connection": 7, "result": 1, "row": 0, "column": 0})),
    ] {
        assert_eq!(refusal(&window, command, args.clone())["sqlstate"], "TB910", "{command}");
    }
}

/// [CLIENT Importing] [DESIGN] D43: a file chosen is previewed, and its
/// import is refused of a connection not open.
#[test]
fn a_file_chosen_is_previewed() {
    use tauri::Manager;
    let (app, window) = window();
    let dir = std::env::temp_dir().join(format!("studio-chosen-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("staff.csv");
    std::fs::write(&path, "ID,NAME\n1,Ada\n").unwrap();
    app.state::<crate::state::Studio>().files.choose(&path).unwrap();
    let reading = serde_json::json!({"format": "csv", "header": true, "delimiter": null, "null": null});
    let shown = answer(&window, "preview_import", serde_json::json!({"path": path.display().to_string(), "reading": reading}));
    assert_eq!(shown, serde_json::json!({"headings": ["ID", "NAME"], "records": [["1", "Ada"]]}));
    let spec = serde_json::json!({"path": path.display().to_string(), "reading": reading, "table": "T", "fields": ["ID", null], "batch": 1, "skip": false});
    assert_eq!(
        refusal(&window, "import_rows", serde_json::json!({"connection": 7, "spec": spec, "confirmed": false}))["sqlstate"],
        "TB910"
    );
}

/// [DESIGN] D49: a failure the window tells is kept in the failures' log,
/// the notices of files set aside are told, and the layout is forgotten.
#[test]
fn failures_are_kept_and_the_layout_forgotten() {
    use tauri::Manager;
    let (app, window) = window();
    assert_eq!(answer(&window, "log_failure", serde_json::json!({"text": "TypeError: x"})), serde_json::Value::Null);
    let log = app.state::<crate::state::Studio>().failures.path().to_owned();
    assert!(std::fs::read_to_string(log).unwrap().ends_with(" TypeError: x\n"));
    assert!(answer(&window, "set_aside_notices", serde_json::json!({})).is_array());
    assert_eq!(answer(&window, "save_layout", serde_json::json!({"dock": {"grid": {}}})), serde_json::Value::Null);
    assert_eq!(answer(&window, "forget_layout", serde_json::json!({})), serde_json::Value::Null);
    assert_eq!(answer(&window, "load_layout", serde_json::json!({})), serde_json::Value::Null);
}

/// [DESIGN] D52: the reports are listed, the built-in then the user's,
/// and one of the user's kept and forgotten.
#[test]
fn reports_are_listed_kept_and_forgotten() {
    let (_app, window) = window();
    let listed = answer(&window, "list_reports", serde_json::json!({}));
    assert!(listed["builtIn"].as_array().is_some_and(|b| !b.is_empty()));
    let report = serde_json::json!({"id": "r1", "name": "Mine", "sql": "SELECT 1", "chart": null});
    assert_eq!(answer(&window, "keep_report", serde_json::json!({"report": report})), serde_json::json!([report]));
    assert_eq!(answer(&window, "forget_report", serde_json::json!({"id": "r1"})), serde_json::json!([]));
}

/// [DESIGN] D30: the menus' items are Studio's commands, each named once,
/// and the platform's own items are not told to the webview.
#[test]
fn menu_items_are_commands() {
    let ids: Vec<&str> = crate::menu::MENUS.iter().flat_map(|(_, items)| items.iter().flatten().map(|(id, _)| *id)).collect();
    let mut unique = ids.clone();
    unique.sort_unstable();
    unique.dedup();
    assert_eq!(unique.len(), ids.len());
    assert!(ids.iter().all(|id| crate::menu::is_command(id)));
    assert!(!crate::menu::is_command("copy"));
}

/// [RULE] R-SEC-1 [DESIGN] D28: a connection saved through the commands is
/// listed with whether its password is saved, never the password.
#[test]
fn a_saved_connection_is_listed_without_its_password() {
    let (_app, window) = window();
    let connection = serde_json::json!({
        "id": "", "name": "Orders", "spec": {"host": "db.example", "user": "ann"},
        "environment": "production", "readOnly": true
    });
    let password = serde_json::json!({"kind": "save", "password": "ann's secret"});
    let saved = json(
        get_ipc_response(&window, request(&window, "save_connection", serde_json::json!({"connection": connection, "password": password})))
            .unwrap(),
    );
    let list = json(get_ipc_response(&window, request(&window, "list_saved_connections", serde_json::json!({}))).unwrap());
    assert_eq!(list["connections"][0]["connection"]["id"], saved["id"]);
    assert_eq!(list["connections"][0]["passwordSaved"], true);
    assert!(!list.to_string().contains("ann's secret"));
    let deleted = request(&window, "delete_saved_connection", serde_json::json!({"id": saved["id"]}));
    get_ipc_response(&window, deleted).unwrap();
}

/// [RULE] R-FMT-1: settings and the layout are saved and read back
/// through the commands, and settings out of bounds refused.
#[test]
fn settings_and_layout_are_kept() {
    let (_app, window) = window();
    let mut settings = json(get_ipc_response(&window, request(&window, "load_settings", serde_json::json!({}))).unwrap());
    settings["theme"] = serde_json::json!("dark");
    get_ipc_response(&window, request(&window, "save_settings", serde_json::json!({"settings": settings.clone()}))).unwrap();
    assert_eq!(json(get_ipc_response(&window, request(&window, "load_settings", serde_json::json!({}))).unwrap()), settings);
    settings["zoomPercent"] = serde_json::json!(1000);
    assert_eq!(refusal(&window, "save_settings", serde_json::json!({"settings": settings}))["sqlstate"], "TB910");
    let dock = serde_json::json!({"grid": {}, "panels": {}});
    get_ipc_response(&window, request(&window, "save_layout", serde_json::json!({"dock": dock.clone()}))).unwrap();
    assert_eq!(json(get_ipc_response(&window, request(&window, "load_layout", serde_json::json!({}))).unwrap()), dock);
}

/// [RULE] R-SEC-1: the webview is told whether the keychain is open, and
/// a saved connection not there is refused before any connection.
#[test]
fn the_keychain_status_is_told_and_an_unknown_connection_refused() {
    let (_app, window) = window();
    let status = json(get_ipc_response(&window, request(&window, "keychain_status", serde_json::json!({}))).unwrap());
    assert_eq!(status["available"], false);
    let error = refusal(&window, "open_saved_connection", serde_json::json!({"id": "nope", "password": null}));
    assert_eq!(error["sqlstate"], "TB910");
}

/// [DESIGN] D24: the backend's events reach the webview as `studio:event`.
#[test]
fn events_reach_the_webview() {
    use tauri::Listener;
    use turborel_studio_core::events::{Event, EventSink};
    let (app, _window) = window();
    let (told, heard) = std::sync::mpsc::channel();
    app.listen_any(crate::state::EVENT, move |event| {
        let _ = told.send(event.payload().to_owned());
    });
    let error = turborel_studio_core::error::StudioError::lost("lost");
    crate::state::WebviewEvents(app.handle().clone()).emit(Event::Lost { connection: 3, error });
    let payload: serde_json::Value = serde_json::from_str(&heard.recv().unwrap()).unwrap();
    assert_eq!(payload["kind"], "lost");
    assert_eq!(payload["connection"], 3);
}

/// [RULE] R-SEC-1 [DESIGN] D28: a saved connection that cannot connect says
/// why, as a connection failure, and never with its password.
#[test]
fn a_saved_connection_that_cannot_connect_keeps_its_secret() {
    let (_app, window) = window();
    let connection = serde_json::json!({
        "id": "", "name": "Plain", "spec": {"host": "127.0.0.1", "port": "1", "user": "ann", "tlsMode": "disable"}
    });
    let password = serde_json::json!({"kind": "save", "password": "ann's secret"});
    let saved = json(
        get_ipc_response(&window, request(&window, "save_connection", serde_json::json!({"connection": connection, "password": password})))
            .unwrap(),
    );
    let error = refusal(&window, "open_saved_connection", serde_json::json!({"id": saved["id"], "password": null}));
    assert!(error["sqlstate"].as_str().unwrap().starts_with("08"), "{error}");
    assert!(!error.to_string().contains("ann's secret"));
}

/// [RULE] R-SEC-6: the catalog's commands refuse names out of bounds before
/// they reach a server, and a connection not open.
#[test]
fn the_catalogs_commands_check_their_arguments() {
    let (_app, window) = window();
    let long = "x".repeat(300);
    for (command, args) in [
        ("catalog_objects", serde_json::json!({"connection": 7, "schema": ""})),
        ("catalog_table", serde_json::json!({"connection": 7, "schema": "ANN", "name": "a\nb"})),
        ("catalog_routine", serde_json::json!({"connection": 7, "schema": long, "specific": "F"})),
        ("catalog_dependencies", serde_json::json!({"connection": 7, "schema": "ANN", "name": ""})),
        ("catalog_search", serde_json::json!({"connection": 7, "text": ""})),
        ("catalog_type", serde_json::json!({"connection": 7, "schema": "ANN", "name": ""})),
        ("catalog_type", serde_json::json!({"connection": 7, "schema": "ANN", "name": "MONEY"})),
        ("catalog_usage", serde_json::json!({"connection": 7, "schema": "ANN", "name": "", "of": "domain"})),
        ("catalog_usage", serde_json::json!({"connection": 7, "schema": "ANN", "name": "S", "of": "sequence"})),
        ("catalog_usage", serde_json::json!({"connection": 7, "schema": "ANN", "name": "D", "of": "domain"})),
        ("catalog_schemas", serde_json::json!({"connection": 7})),
        ("catalog_security", serde_json::json!({"connection": 7})),
        ("catalog_definition", serde_json::json!({"connection": 7, "of": {"kind": "schema", "schema": "ANN"}})),
    ] {
        assert_eq!(refusal(&window, command, args)["sqlstate"], "TB910", "{command}");
    }
    let table = serde_json::json!({"connection": 7, "schema": "ANN", "name": "T", "of": "table"});
    assert!(refusal(&window, "catalog_usage", table).is_string());
}

/// [RULE] R-SEC-5: the dialog plug-in's own commands are not the webview's:
/// only the backend opens a dialog, and a name that is a path is refused.
#[test]
fn the_dialog_is_the_backends_alone() {
    let (_app, window) = window();
    assert!(get_ipc_response(&window, request(&window, "plugin:dialog|save", serde_json::json!({}))).is_err());
    let error = refusal(&window, "save_text_file", serde_json::json!({"name": "../x.sql", "text": "SELECT 1"}));
    assert_eq!(error["sqlstate"], "TB910");
}

/// The JSON `command` answered `args` with.
fn answer(window: &WebviewWindow<MockRuntime>, command: &str, args: serde_json::Value) -> serde_json::Value {
    json(get_ipc_response(window, request(window, command, args)).unwrap())
}

/// [DESIGN] D36: a script is split into its statements, each with its
/// place and class, and the reserved words are the lexer's.
#[test]
fn a_script_is_split_and_the_words_given() {
    let (_app, window) = window();
    let pieces = answer(&window, "split_script", serde_json::json!({"text": "VALUES (1); DROP TABLE T CASCADE"}));
    assert_eq!(pieces[0]["from"], 0);
    assert_eq!(pieces[0]["statement"]["class"], "read");
    assert_eq!(pieces[1]["statement"]["destroys"], "DROP TABLE");
    let scope = answer(&window, "statement_scope", serde_json::json!({"text": "SELECT é. FROM STAFF é", "cursor": 9}));
    assert_eq!(scope["parsed"], true);
    assert_eq!(scope["sources"][0]["alias"], "É");
    assert_eq!(answer(&window, "statement_scope", serde_json::json!({"text": "SELECT", "cursor": 0}))["parsed"], false);
    let words = answer(&window, "sql_words", serde_json::json!({}));
    assert!(words.as_array().unwrap().iter().any(|w| w == "SELECT"));
}

/// [RULE] R-SEC-1 [DESIGN] D36: the history keeps what ran, but never a
/// statement that changes who may do what, and is cleared; the worksheets
/// and queries come back as kept.
#[test]
fn the_history_and_worksheets_are_kept() {
    let (_app, window) = window();
    let entry = |sql: &str| serde_json::json!({"entry": {"sql": sql, "at": 1, "connection": "Orders", "saved": null, "millis": 2, "rows": 1, "sqlstate": "00000"}});
    assert_eq!(answer(&window, "record_history", entry("SELECT 1")), true);
    assert_eq!(answer(&window, "record_history", entry("CREATE USER BOB PASSWORD 'x'")), false);
    let found = answer(&window, "search_history", serde_json::json!({"text": "", "limit": 10}));
    assert_eq!(found.as_array().unwrap().len(), 1);
    assert_eq!(refusal(&window, "search_history", serde_json::json!({"text": "", "limit": 5000}))["sqlstate"], "TB910");
    answer(&window, "clear_history", serde_json::json!({}));
    assert_eq!(answer(&window, "search_history", serde_json::json!({"text": "", "limit": 10})), serde_json::json!([]));
    let sheet = serde_json::json!({"id": "w1", "title": "Untitled", "text": "SELECT 1", "connection": null, "pinned": true, "path": null, "modified": true});
    answer(&window, "keep_worksheets", serde_json::json!({"worksheets": [sheet.clone()]}));
    assert_eq!(answer(&window, "load_worksheets", serde_json::json!({})), serde_json::json!([sheet]));
    let query = serde_json::json!({"id": "q1", "name": "One", "sql": "SELECT 1"});
    assert_eq!(answer(&window, "keep_query", serde_json::json!({"query": query.clone()})), serde_json::json!([query]));
    assert_eq!(answer(&window, "list_queries", serde_json::json!({})), serde_json::json!([query]));
    assert_eq!(answer(&window, "forget_query", serde_json::json!({"id": "q1"})), serde_json::json!([]));
}

/// [RULE] R-SEC-5 [DESIGN] D36 D43: no file the user did not choose, nor a
/// folder not a project, is read, written, listed, previewed or imported;
/// a connection not open is neither judged nor described; a notification
/// too long, or an export's file of no plain name, is refused.
#[test]
fn files_not_chosen_are_refused() {
    let (_app, window) = window();
    let elsewhere = std::env::temp_dir().join("studio-not-chosen.sql").display().to_string();
    assert_eq!(refusal(&window, "read_sql_file", serde_json::json!({"path": elsewhere}))["sqlstate"], "TB910");
    assert_eq!(refusal(&window, "write_sql_file", serde_json::json!({"path": elsewhere, "text": "x"}))["sqlstate"], "TB910");
    assert_eq!(refusal(&window, "project_files", serde_json::json!({"folder": "/"}))["sqlstate"], "TB910");
    assert_eq!(answer(&window, "project_folders", serde_json::json!({})), serde_json::json!([]));
    assert_eq!(answer(&window, "remove_project_folder", serde_json::json!({"folder": "/"})), serde_json::json!([]));
    assert_eq!(refusal(&window, "judge_script", serde_json::json!({"connection": 7, "sql": "SELECT 1"}))["sqlstate"], "TB910");
    assert_eq!(refusal(&window, "statement_parameters", serde_json::json!({"connection": 7, "sql": "SELECT ?"}))["sqlstate"], "TB910");
    let long = "x".repeat(501);
    assert_eq!(refusal(&window, "notify_finished", serde_json::json!({"title": long, "body": ""}))["sqlstate"], "TB910");
    let values = serde_json::json!({"connection": 7, "sql": "SELECT 1", "confirmed": false, "values": ["1"]});
    assert_eq!(refusal(&window, "run_statement", values)["sqlstate"], "TB910");
    let reading = serde_json::json!({"format": "csv", "header": true, "delimiter": null, "null": null});
    let csv = std::env::temp_dir().join("studio-not-chosen.csv").display().to_string();
    assert_eq!(refusal(&window, "preview_import", serde_json::json!({"path": csv, "reading": reading}))["sqlstate"], "TB910");
    let spec = serde_json::json!({"path": csv, "reading": reading, "table": "T", "fields": ["A"], "batch": 1, "skip": false});
    assert_eq!(
        refusal(&window, "import_rows", serde_json::json!({"connection": 7, "spec": spec, "confirmed": false}))["sqlstate"],
        "TB910"
    );
    let request = serde_json::json!({"connection": 7, "sql": "SELECT 1", "kind": "csv", "name": "a/b"});
    assert_eq!(refusal(&window, "export_query", serde_json::json!({"request": request}))["sqlstate"], "TB910");
}
