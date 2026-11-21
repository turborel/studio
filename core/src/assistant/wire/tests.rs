//! The wire formats: requests built, and streams read.

use serde_json::{Value, json};

use super::{Delta, Effort, Request, Stop, ToolDef, Usage, Wire, body, reading, tool_results, user_text};
use crate::assistant::http::read_events;
use crate::assistant::mock::{anthropic_stream, chat_stream};

/// A tool of one string, strict.
fn tool() -> ToolDef {
    ToolDef {
        name: "describe_table",
        description: "Describes a table",
        schema: json!({"type": "object", "properties": {"table": {"type": "string"}}, "required": ["table"], "additionalProperties": false}),
    }
}

/// A request of `messages`, Claude's if `claude`.
fn request<'a>(messages: &'a [Value], tools: &'a [ToolDef], claude: bool) -> Request<'a> {
    Request {
        model: "claude-opus-5-5",
        instructions: "Rules",
        context: "Schema ANN: STAFF(ID INTEGER)",
        messages,
        tools,
        max_tokens: 64_000,
        effort: Some(Effort::High),
        claude,
    }
}

/// [DESIGN] D55: Claude's request streams, caches the schema's context,
/// sets its effort and server-side fallbacks, but of Haiku's models, and
/// its tools strict and eagerly streamed.
#[test]
fn a_messages_request_is_built() {
    let messages = [user_text("Why is it slow?")];
    let tools = [tool()];
    let b = body(Wire::Anthropic, &request(&messages, &tools, true));
    assert_eq!(b["stream"], true);
    assert_eq!(b["max_tokens"], 64_000);
    assert_eq!(b["system"][1]["cache_control"], json!({"type": "ephemeral"}));
    assert_eq!(b["output_config"], json!({"effort": "high"}));
    assert_eq!(b["fallbacks"], "default");
    assert_eq!(b["tool_choice"], json!({"type": "auto"}));
    assert_eq!(b["tools"][0]["strict"], true);
    assert_eq!(b["tools"][0]["eager_input_streaming"], true);
    assert!(b.get("thinking").is_none());
    let haiku = body(Wire::Anthropic, &Request { model: "claude-haiku-5-5", ..request(&messages, &tools, true) });
    assert!(haiku.get("fallbacks").is_none());
}

/// [DESIGN] D55: another model's request in the Messages format has none
/// of Claude's own fields; one of no tools, none; its effort as asked.
#[test]
fn another_models_messages_request_is_plain() {
    let messages = [user_text("Why is it slow?")];
    let tools = [tool()];
    let own = body(Wire::Anthropic, &Request { effort: Some(Effort::Medium), ..request(&messages, &tools, false) });
    for field in ["output_config", "fallbacks"] {
        assert!(own.get(field).is_none(), "{field}");
    }
    assert!(own["tools"][0].get("strict").is_none());
    assert!(own["system"][1].get("cache_control").is_none());
    let bare = body(Wire::Anthropic, &request(&messages, &[], true));
    assert!(bare.get("tools").is_none());
    let medium = body(Wire::Anthropic, &Request { effort: Some(Effort::Medium), ..request(&messages, &[], true) });
    assert_eq!(medium["output_config"]["effort"], "medium");
}

/// [DESIGN] D55: a chat-completions request carries the instructions and
/// context as its system message, its tools as functions, and asks for
/// the usage; tool results are one message each.
#[test]
fn a_chat_request_is_built() {
    let messages = [user_text("Hello")];
    let b = body(Wire::ChatCompletions, &request(&messages, &[tool()], false));
    assert_eq!(b["messages"][0]["role"], "system");
    assert!(b["messages"][0]["content"].as_str().is_some_and(|c| c.contains("Schema ANN")));
    assert_eq!(b["tools"][0]["function"]["name"], "describe_table");
    assert_eq!(b["stream_options"]["include_usage"], true);
    assert!(body(Wire::ChatCompletions, &request(&messages, &[], false)).get("tools").is_none());
    let results = [("c1".to_owned(), "ok".to_owned(), false), ("c2".to_owned(), "no".to_owned(), true)];
    assert_eq!(tool_results(Wire::ChatCompletions, &results).len(), 2);
    let anthropic = tool_results(Wire::Anthropic, &results);
    assert_eq!(anthropic.len(), 1);
    assert_eq!(anthropic[0]["content"][1]["is_error"], true);
}

/// Reads `events` of `wire` into a reply, the parts told collected.
fn read(wire: Wire, events: &str) -> (super::Reply, Vec<Delta>) {
    let mut told = Vec::new();
    let mut reader = reading(wire);
    read_events(events.as_bytes(), reader.as_mut(), &mut |d| told.push(d)).unwrap();
    (reader.finish(), told)
}

/// [DESIGN] D55: a Messages stream is read into its text, its tool calls
/// whole, its stop and usage, and the message sent back as it came, its
/// thinking with its signature.
#[test]
fn a_messages_stream_is_read() {
    let (reply, told) =
        read(Wire::Anthropic, &anthropic_stream("Let me look.", &[("t1", "describe_table", r#"{"table":"STAFF"}"#)], "tool_use"));
    assert_eq!(reply.text, "Let me look.");
    assert_eq!(reply.calls[0].input, r#"{"table":"STAFF"}"#);
    assert_eq!(reply.stop, Stop::ToolUse);
    assert_eq!(reply.usage, Usage { input: 10, output: 5, cache_read: 8, cache_written: 0 });
    assert_eq!(reply.model, "claude-opus-5-5");
    assert_eq!(reply.message["content"][1]["input"], json!({"table": "STAFF"}));
    assert_eq!(told, [Delta::Text("Let me look.".into()), Delta::ToolBegun("describe_table".into())]);
    let thinking = "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\"}}\n\n\
event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"hm\"}}\n\n\
event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"signature_delta\",\"signature\":\"sig\"}}\n\n\
event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"refusal\",\"stop_details\":{\"type\":\"refusal\",\"category\":\"cyber\",\"explanation\":\"no\"}}}\n\n";
    let (refused, _) = read(Wire::Anthropic, thinking);
    assert_eq!(refused.message["content"][0], json!({"type": "thinking", "thinking": "hm", "signature": "sig"}));
    assert_eq!(refused.stop, Stop::Refusal { category: Some("cyber".into()), explanation: Some("no".into()) });
    let (bad, _) = read(Wire::Anthropic, &anthropic_stream("", &[("t2", "x", "{not json")], "max_tokens"));
    assert_eq!((bad.stop, bad.message["content"][1]["input"].clone()), (Stop::MaxTokens, json!({})));
    let mut reader = reading(Wire::Anthropic);
    let failed = read_events(
        "event: error\ndata: {\"type\":\"error\",\"error\":{\"message\":\"overloaded\"}}\n\n".as_bytes(),
        reader.as_mut(),
        &mut |_| (),
    );
    assert!(failed.unwrap_err().message.contains("overloaded"));
    let mut garbled = reading(Wire::Anthropic);
    assert!(read_events("data: {nope\n".as_bytes(), garbled.as_mut(), &mut |_| ()).is_err());
    let (ended, _) = read(Wire::Anthropic, "event: ping\ndata: {\"type\":\"ping\"}\n\n");
    assert_eq!(ended.stop, Stop::Other { reason: "the stream ended".into() });
}

/// [DESIGN] D55: a chat-completions stream is read into its text, its tool
/// calls grown by their index, its finish and usage, and the message sent
/// back with its tool calls.
#[test]
fn a_chat_stream_is_read() {
    let (reply, told) = read(Wire::ChatCompletions, &chat_stream("Sure.", &[("c1", "list_schemas", "{}")], "tool_calls"));
    assert_eq!(reply.text, "Sure.");
    assert_eq!(reply.calls[0].name, "list_schemas");
    assert_eq!(reply.stop, Stop::ToolUse);
    assert_eq!(reply.usage, Usage { input: 12, output: 3, ..Usage::default() });
    assert_eq!(reply.message["tool_calls"][0]["function"]["arguments"], "{}");
    assert_eq!(told.len(), 2);
    let (plain, _) = read(Wire::ChatCompletions, &chat_stream("Hi", &[], "stop"));
    assert!(plain.message.get("tool_calls").is_none());
    assert_eq!(plain.stop, Stop::EndTurn);
    let (filtered, _) = read(Wire::ChatCompletions, &chat_stream("", &[], "content_filter"));
    assert_eq!(filtered.stop, Stop::Refusal { category: None, explanation: None });
    let (other, _) = read(Wire::ChatCompletions, &chat_stream("", &[], "function_call"));
    assert_eq!(other.stop, Stop::Other { reason: "function_call".into() });
    let mut reader = reading(Wire::ChatCompletions);
    assert!(read_events("data: {\"error\":{\"message\":\"bad\"}}\n\n".as_bytes(), reader.as_mut(), &mut |_| ()).is_err());
    let (bare, _) = read(
        Wire::ChatCompletions,
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"function\":{\"arguments\":\"{\"}}]}}]}\n\ndata: [DONE]\n\n",
    );
    assert_eq!(bare.calls.len(), 1);
}
