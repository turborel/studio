//! The application's commands, called as the webview calls them, on
//! Tauri's mock runtime: the one harness of the application's tests
//! (RULES.md R-TEST-7).

use tauri::http::HeaderMap;
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::studio;

/// The application on the mock runtime, with its own configuration and
/// capabilities, and its main window.
pub(crate) fn window() -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let app = studio(mock_builder()).build(crate::context()).unwrap();
    // The mock runtime runs no event loop, so the setup it would run as
    // the loop starts is run here, its results kept under the build's
    // target directory rather than the user's cache.
    let results = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("target").join("test-scratch").join("app-results");
    crate::manage(&app, results).unwrap();
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
    for command in ["plugin:fs|read_file", "plugin:shell|execute", "plugin:http|fetch"] {
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
    let error = refusal(&window, "run_statement", serde_json::json!({"connection": 7, "sql": "VALUES (1)"}));
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
    let unknown = serde_json::json!({"spec": {"user": "ann", "secret": "x"}, "password": null});
    assert!(get_ipc_response(&window, request(&window, "open_connection", unknown)).is_err());
    let no_user = serde_json::json!({"spec": {"host": "db.example"}, "password": null});
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
    ] {
        assert_eq!(refusal(&window, command, args.clone())["sqlstate"], "TB910", "{command}");
    }
}
