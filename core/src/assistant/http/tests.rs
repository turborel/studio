//! The model's requests over HTTP, of the tests' own model server.

use std::time::Duration;

use serde_json::json;

use super::{Endpoint, ask, checked, wait};
use crate::assistant::mock::{Answer, MockModel, anthropic_stream, chat_stream};
use crate::assistant::wire::{Stop, Wire};
use crate::secret::Secret;

/// [DESIGN] D55: an endpoint is of HTTPS, or of HTTP on this machine alone.
#[test]
fn an_endpoint_is_checked() {
    for good in
        ["https://api.anthropic.com", "https://models.example:8443/", "http://localhost:11434", "http://127.0.0.1:8080/x", "http://[::1]:9"]
    {
        assert!(checked(good).is_ok(), "{good}");
    }
    for bad in ["http://models.example", "ftp://x", "models.example", "https://", "http://localhost.example"] {
        assert!(checked(bad).is_err(), "{bad}");
    }
    assert_eq!(checked("https://a.example/").unwrap(), "https://a.example");
}

/// [DESIGN] D55: the wait before a request is made again doubles, or is
/// what the server names, at most a minute.
#[test]
fn the_wait_grows() {
    assert_eq!(wait(0, None), Duration::from_secs(1));
    assert_eq!(wait(2, None), Duration::from_secs(4));
    assert_eq!(wait(0, Some("3")), Duration::from_secs(3));
    assert_eq!(wait(0, Some("600")), Duration::from_secs(60));
    assert_eq!(wait(1, Some("soon")), Duration::from_secs(2));
}

/// [DESIGN] D55: Claude is asked with its key and version, its fallbacks'
/// beta; a refusal for the rate is tried again after the wait the server
/// names, and the stream is read.
#[test]
fn claude_is_asked_and_a_rate_refusal_tried_again() {
    let mock = MockModel::start(vec![
        Answer::Status(429, r#"{"error":{"message":"slow down"}}"#.into(), Some(0)),
        Answer::Stream(anthropic_stream("Hello", &[], "end_turn")),
    ]);
    let endpoint = Endpoint { base: mock.url.clone(), wire: Wire::Anthropic, claude: true, key: Some(Secret::new("sk-test")) };
    let mut text = String::new();
    let reply = ask(&endpoint, &json!({"model": "claude-opus-5-5"}), &mut |d| {
        if let crate::assistant::wire::Delta::Text(t) = d {
            text.push_str(&t);
        }
    })
    .unwrap();
    assert_eq!((reply.text.as_str(), reply.stop), ("Hello", Stop::EndTurn));
    assert_eq!(text, "Hello");
    let taken = mock.taken();
    assert_eq!(taken.len(), 2);
    let header = |name: &str| taken[1].headers.iter().find(|(n, _)| n == name).map(|(_, v)| v.clone());
    assert_eq!(header("x-api-key").as_deref(), Some("sk-test"));
    assert_eq!(header("anthropic-version").as_deref(), Some("2023-06-01"));
    assert_eq!(header("anthropic-beta").as_deref(), Some("server-side-fallback-2026-07-01"));
    assert_eq!(taken[1].path, "/v1/messages");
}

/// [DESIGN] D55: a chat-completions model is asked with its key as a
/// bearer token, or with none; a refusal by HTTP status is told by it.
#[test]
fn a_model_of_chat_completions_is_asked_and_refusals_told() {
    let mock = MockModel::start(vec![
        Answer::Stream(chat_stream("Hi", &[], "stop")),
        Answer::Status(401, r#"{"error":{"message":"invalid key"}}"#.into(), None),
        Answer::Status(400, "plain".into(), None),
    ]);
    let keyed = Endpoint { base: mock.url.clone(), wire: Wire::ChatCompletions, claude: false, key: Some(Secret::new("k")) };
    assert_eq!(ask(&keyed, &json!({}), &mut |_| ()).unwrap().text, "Hi");
    let taken = mock.taken();
    assert_eq!(taken[0].path, "/v1/chat/completions");
    assert!(taken[0].headers.iter().any(|(n, v)| n == "authorization" && v == "Bearer k"));
    let bare = Endpoint { key: None, ..keyed };
    let refused = ask(&bare, &json!({}), &mut |_| ()).unwrap_err();
    assert!(refused.message.contains("HTTP 401: the key was refused: invalid key"), "{}", refused.message);
    let plain = ask(&bare, &json!({}), &mut |_| ()).unwrap_err();
    assert!(plain.message.contains("HTTP 400") && plain.message.contains("plain"), "{}", plain.message);
    let gone = Endpoint { base: "http://127.0.0.1:9".into(), ..bare };
    assert!(ask(&gone, &json!({}), &mut |_| ()).unwrap_err().message.contains("could not be reached"));
}
