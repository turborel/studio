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
