//! The two wire formats a model is asked in (RULES.md D55): Anthropic's
//! Messages API, of Claude and of a model the user ties to Studio, and the
//! chat-completions format most local model servers speak. Each builds a
//! request of the same parts, and reads a stream of server-sent events into
//! the same reply: its text, its tool calls, why it stopped, and its usage.
//! A conversation keeps each message in its format's own shape, so a
//! Claude reply's blocks, its thinking among them, are sent back as they
//! came.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

/// The wire format of an endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Wire {
    /// Anthropic's Messages API.
    Anthropic,
    /// The chat-completions format.
    ChatCompletions,
}

/// How much a request is thought over, of Claude's effort.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Effort {
    /// For chat.
    Medium,
    /// For a plan's analysis and for tasks.
    High,
}

/// A tool the model may call: its name, what it does, and its input's schema.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ToolDef {
    /// Its name.
    pub name: &'static str,
    /// What it does, for the model.
    pub description: &'static str,
    /// Its input's JSON schema, strict: every property required, no others.
    pub schema: Value,
}

/// What a request is made of.
#[derive(Debug, Clone, PartialEq)]
pub struct Request<'a> {
    /// The model.
    pub model: &'a str,
    /// The instructions, which never change.
    pub instructions: &'a str,
    /// The schema's context, sorted, cached where the format caches.
    pub context: &'a str,
    /// The conversation, each message in the format's shape.
    pub messages: &'a [Value],
    /// The tools, in a fixed order; none for a model that calls none.
    pub tools: &'a [ToolDef],
    /// The most tokens of its answer.
    pub max_tokens: u32,
    /// Its effort, of Claude alone.
    pub effort: Option<Effort>,
    /// Whether it is Claude, built in: its effort, caching, eager tool
    /// streaming, strict tools and server-side fallbacks are sent.
    pub claude: bool,
}

/// The beta that lets a request Claude's model declines run again on
/// another of Claude's models, server side, chosen by the refusal's category.
pub const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
/// The version of the Messages API.
pub const ANTHROPIC_VERSION: &str = "2023-06-01";

/// The body of `request` in `wire`'s format, streamed.
pub fn body(wire: Wire, request: &Request<'_>) -> Value {
    match wire {
        Wire::Anthropic => anthropic_body(request),
        Wire::ChatCompletions => chat_body(request),
    }
}

/// Whether Claude's `model` takes server-side fallbacks: Haiku's models
/// have none, and a request of one that names them stays declined.
fn takes_fallbacks(model: &str) -> bool {
    !model.starts_with("claude-haiku")
}

/// Puts `value` at `key` of the object `object`; of another value, nothing.
fn put(object: &mut Value, key: &str, value: Value) {
    if let Some(map) = object.as_object_mut() {
        map.insert(key.to_owned(), value);
    }
}

/// The body of a Messages API request.
fn anthropic_body(r: &Request<'_>) -> Value {
    let mut body = Map::new();
    body.insert("model".into(), json!(r.model));
    body.insert("max_tokens".into(), json!(r.max_tokens));
    body.insert("stream".into(), json!(true));
    let context = if r.claude {
        json!({"type": "text", "text": r.context, "cache_control": {"type": "ephemeral"}})
    } else {
        json!({"type": "text", "text": r.context})
    };
    body.insert("system".into(), json!([{"type": "text", "text": r.instructions}, context]));
    body.insert("messages".into(), Value::Array(r.messages.to_vec()));
    if !r.tools.is_empty() {
        let tools: Vec<Value> = r
            .tools
            .iter()
            .map(|t| {
                let mut tool = json!({"name": t.name, "description": t.description, "input_schema": t.schema});
                if r.claude {
                    put(&mut tool, "strict", json!(true));
                    put(&mut tool, "eager_input_streaming", json!(true));
                }
                tool
            })
            .collect();
        body.insert("tools".into(), Value::Array(tools));
        body.insert("tool_choice".into(), json!({"type": "auto"}));
    }
    if r.claude {
        if let Some(effort) = r.effort {
            let effort = match effort {
                Effort::Medium => "medium",
                Effort::High => "high",
            };
            body.insert("output_config".into(), json!({"effort": effort}));
        }
        if takes_fallbacks(r.model) {
            body.insert("fallbacks".into(), json!("default"));
        }
    }
    Value::Object(body)
}

/// The body of a chat-completions request.
fn chat_body(r: &Request<'_>) -> Value {
    let mut messages = vec![json!({"role": "system", "content": format!("{}\n\n{}", r.instructions, r.context)})];
    messages.extend(r.messages.iter().cloned());
    let mut body = json!({"model": r.model, "max_tokens": r.max_tokens, "stream": true, "messages": messages,
        "stream_options": {"include_usage": true}});
    if !r.tools.is_empty() {
        let tools: Vec<Value> = r
            .tools
            .iter()
            .map(|t| json!({"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.schema}}))
            .collect();
        put(&mut body, "tools", Value::Array(tools));
        put(&mut body, "tool_choice", json!("auto"));
    }
    body
}

/// A message of the user's text, of the same shape in either format.
pub fn user_text(text: &str) -> Value {
    json!({"role": "user", "content": text})
}

/// The results of tool calls, `(id, content, is_error)`, in `wire`'s shape:
/// one message of every result for Anthropic's, one message each for
/// chat completions.
pub fn tool_results(wire: Wire, results: &[(String, String, bool)]) -> Vec<Value> {
    match wire {
        Wire::Anthropic => vec![json!({"role": "user", "content": results.iter().map(|(id, content, error)| {
            json!({"type": "tool_result", "tool_use_id": id, "content": content, "is_error": error})
        }).collect::<Vec<_>>()})],
        Wire::ChatCompletions => {
            results.iter().map(|(id, content, _)| json!({"role": "tool", "tool_call_id": id, "content": content})).collect()
        }
    }
}

/// A tool call of a reply: its identifier, its tool, and its input as the
/// model wrote it, parsed only once whole.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    /// Its identifier, which its result answers.
    pub id: String,
    /// Its tool's name.
    pub name: String,
    /// Its input, as written.
    pub input: String,
}

/// Why a reply stopped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Stop {
    /// It ended its turn.
    EndTurn,
    /// It asks for tools.
    ToolUse,
    /// It reached its most tokens.
    MaxTokens,
    /// It declined: its category and explanation, as the model gave them.
    Refusal {
        /// The category, if given.
        category: Option<String>,
        /// The explanation, if given.
        explanation: Option<String>,
    },
    /// It stopped for another reason, as the format named it.
    Other {
        /// The reason.
        reason: String,
    },
}

/// The tokens a request took.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    /// Its input's.
    pub input: u64,
    /// Its output's.
    pub output: u64,
    /// Its input's read of the cache.
    pub cache_read: u64,
    /// Its input's written to the cache.
    pub cache_written: u64,
}

/// What a reply's stream tells as it comes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Delta {
    /// More of its text.
    Text(String),
    /// A tool call begun, by its tool's name.
    ToolBegun(String),
}

/// A reply, read whole.
#[derive(Debug, Clone, PartialEq)]
pub struct Reply {
    /// Its text.
    pub text: String,
    /// Its tool calls, in order.
    pub calls: Vec<ToolCall>,
    /// Why it stopped.
    pub stop: Stop,
    /// Its usage.
    pub usage: Usage,
    /// The model that answered.
    pub model: String,
    /// The message to keep in the conversation, in the format's shape.
    pub message: Value,
}

/// A stream's reading, as its events come.
pub trait Reading {
    /// Reads `event`, its name and data, telling `delta` of each part.
    ///
    /// # Errors
    ///
    /// The model's error, as an `error` event tells it.
    fn read(&mut self, event: &str, data: &str, delta: &mut dyn FnMut(Delta)) -> Result<(), String>;
    /// The reply, once the stream ends.
    fn finish(self: Box<Self>) -> Reply;
}

/// A reading of `wire`'s stream.
pub fn reading(wire: Wire) -> Box<dyn Reading> {
    match wire {
        Wire::Anthropic => Box::new(AnthropicReading::default()),
        Wire::ChatCompletions => Box::new(ChatReading::default()),
    }
}

/// A Messages API stream being read: each content block as it grows.
#[derive(Debug, Default)]
struct AnthropicReading {
    blocks: Vec<Value>,
    inputs: Vec<String>,
    stop: Option<Stop>,
    usage: Usage,
    model: String,
}

/// The number at `pointer` of `value`, or 0.
fn count(value: &Value, pointer: &str) -> u64 {
    value.pointer(pointer).and_then(Value::as_u64).unwrap_or(0)
}

/// The usage of `u`, the Messages API's, over `before`.
fn anthropic_usage(u: &Value, before: Usage) -> Usage {
    Usage {
        input: count(u, "/input_tokens").max(before.input),
        output: count(u, "/output_tokens").max(before.output),
        cache_read: count(u, "/cache_read_input_tokens").max(before.cache_read),
        cache_written: count(u, "/cache_creation_input_tokens").max(before.cache_written),
    }
}

impl Reading for AnthropicReading {
    fn read(&mut self, event: &str, data: &str, delta: &mut dyn FnMut(Delta)) -> Result<(), String> {
        let v: Value = serde_json::from_str(data).map_err(|e| format!("the stream's event could not be read: {e}"))?;
        match v.get("type").and_then(Value::as_str).unwrap_or(event) {
            "message_start" => {
                v.pointer("/message/model").and_then(Value::as_str).unwrap_or_default().clone_into(&mut self.model);
                self.usage = anthropic_usage(v.pointer("/message/usage").unwrap_or(&Value::Null), self.usage);
            }
            "content_block_start" => {
                let block = v.get("content_block").cloned().unwrap_or(Value::Null);
                if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                    delta(Delta::ToolBegun(block.get("name").and_then(Value::as_str).unwrap_or_default().to_owned()));
                }
                self.blocks.push(block);
                self.inputs.push(String::new());
            }
            "content_block_delta" => self.grow(&v, delta),
            "message_delta" => {
                self.usage = anthropic_usage(v.get("usage").unwrap_or(&Value::Null), self.usage);
                if let Some(reason) = v.pointer("/delta/stop_reason").and_then(Value::as_str) {
                    let details = v.pointer("/delta/stop_details").or_else(|| v.get("stop_details"));
                    self.stop = Some(stop_of(reason, details));
                }
            }
            "error" => {
                let message = v.pointer("/error/message").and_then(Value::as_str).unwrap_or("the model's stream failed");
                return Err(message.to_owned());
            }
            _ => {}
        }
        Ok(())
    }

    fn finish(mut self: Box<Self>) -> Reply {
        let mut calls = Vec::new();
        let mut text = String::new();
        for (block, input) in self.blocks.iter_mut().zip(&self.inputs) {
            match block.get("type").and_then(Value::as_str) {
                Some("tool_use") => {
                    let id = block.get("id").and_then(Value::as_str).unwrap_or_default().to_owned();
                    let name = block.get("name").and_then(Value::as_str).unwrap_or_default().to_owned();
                    // The input is kept as written; a block's input that is
                    // no JSON is sent back as an empty object.
                    block["input"] = serde_json::from_str(input).unwrap_or_else(|_| json!({}));
                    calls.push(ToolCall { id, name, input: input.clone() });
                }
                Some("text") => text.push_str(block.get("text").and_then(Value::as_str).unwrap_or_default()),
                _ => {}
            }
        }
        let stop = self.stop.unwrap_or(Stop::Other { reason: "the stream ended".to_owned() });
        let message = json!({"role": "assistant", "content": self.blocks});
        Reply { text, calls, stop, usage: self.usage, model: self.model, message }
    }
}

impl AnthropicReading {
    /// Grows the block a `content_block_delta` is of.
    fn grow(&mut self, v: &Value, delta: &mut dyn FnMut(Delta)) {
        let index = v.get("index").and_then(Value::as_u64).and_then(|i| usize::try_from(i).ok()).unwrap_or(0);
        let (Some(block), Some(input)) = (self.blocks.get_mut(index), self.inputs.get_mut(index)) else { return };
        let d = v.get("delta").unwrap_or(&Value::Null);
        let append = |block: &mut Value, field: &str, more: &str| {
            let now = block.get(field).and_then(Value::as_str).unwrap_or_default().to_owned();
            block[field] = json!(now + more);
        };
        match d.get("type").and_then(Value::as_str) {
            Some("text_delta") => {
                let more = d.get("text").and_then(Value::as_str).unwrap_or_default();
                append(block, "text", more);
                delta(Delta::Text(more.to_owned()));
            }
            Some("input_json_delta") => input.push_str(d.get("partial_json").and_then(Value::as_str).unwrap_or_default()),
            Some("thinking_delta") => append(block, "thinking", d.get("thinking").and_then(Value::as_str).unwrap_or_default()),
            Some("signature_delta") => append(block, "signature", d.get("signature").and_then(Value::as_str).unwrap_or_default()),
            _ => {}
        }
    }
}

/// The stop of `reason`, its details if a refusal.
fn stop_of(reason: &str, details: Option<&Value>) -> Stop {
    let text = |p: &str| details.and_then(|d| d.get(p)).and_then(Value::as_str).map(str::to_owned);
    match reason {
        "end_turn" | "stop" => Stop::EndTurn,
        "tool_use" | "tool_calls" => Stop::ToolUse,
        "max_tokens" | "length" => Stop::MaxTokens,
        "refusal" | "content_filter" => Stop::Refusal { category: text("category"), explanation: text("explanation") },
        other => Stop::Other { reason: other.to_owned() },
    }
}

/// A chat-completions stream being read: its text, and each tool call by
/// its index as it grows.
#[derive(Debug, Default)]
struct ChatReading {
    text: String,
    calls: Vec<(String, String, String)>,
    stop: Option<Stop>,
    usage: Usage,
    model: String,
}

impl Reading for ChatReading {
    fn read(&mut self, _event: &str, data: &str, delta: &mut dyn FnMut(Delta)) -> Result<(), String> {
        if data.trim() == "[DONE]" {
            return Ok(());
        }
        let v: Value = serde_json::from_str(data).map_err(|e| format!("the stream's event could not be read: {e}"))?;
        if let Some(message) = v.pointer("/error/message").and_then(Value::as_str) {
            return Err(message.to_owned());
        }
        if let Some(model) = v.get("model").and_then(Value::as_str) {
            model.clone_into(&mut self.model);
        }
        if let Some(u) = v.get("usage").filter(|u| !u.is_null()) {
            self.usage = Usage { input: count(u, "/prompt_tokens"), output: count(u, "/completion_tokens"), ..self.usage };
        }
        let Some(choice) = v.pointer("/choices/0") else { return Ok(()) };
        if let Some(more) = choice.pointer("/delta/content").and_then(Value::as_str) {
            self.text.push_str(more);
            delta(Delta::Text(more.to_owned()));
        }
        for call in choice.pointer("/delta/tool_calls").and_then(Value::as_array).into_iter().flatten() {
            self.grow(call, delta);
        }
        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            self.stop = Some(stop_of(reason, None));
        }
        Ok(())
    }

    fn finish(self: Box<Self>) -> Reply {
        let calls: Vec<ToolCall> =
            self.calls.iter().map(|(id, name, input)| ToolCall { id: id.clone(), name: name.clone(), input: input.clone() }).collect();
        let mut message = json!({"role": "assistant", "content": self.text});
        if !calls.is_empty() {
            put(
                &mut message,
                "tool_calls",
                Value::Array(
                    calls
                        .iter()
                        .map(|c| json!({"id": c.id, "type": "function", "function": {"name": c.name, "arguments": c.input}}))
                        .collect(),
                ),
            );
        }
        let stop = self.stop.unwrap_or(Stop::Other { reason: "the stream ended".to_owned() });
        Reply { text: self.text, calls, stop, usage: self.usage, model: self.model, message }
    }
}

impl ChatReading {
    /// Grows the tool call `call` is a part of, by its index.
    fn grow(&mut self, call: &Value, delta: &mut dyn FnMut(Delta)) {
        let index = call.get("index").and_then(Value::as_u64).and_then(|i| usize::try_from(i).ok()).unwrap_or(self.calls.len());
        while self.calls.len() <= index {
            self.calls.push((String::new(), String::new(), String::new()));
        }
        let Some(entry) = self.calls.get_mut(index) else { return };
        if let Some(id) = call.get("id").and_then(Value::as_str) {
            id.clone_into(&mut entry.0);
        }
        if let Some(name) = call.pointer("/function/name").and_then(Value::as_str) {
            name.clone_into(&mut entry.1);
            delta(Delta::ToolBegun(name.to_owned()));
        }
        if let Some(more) = call.pointer("/function/arguments").and_then(Value::as_str) {
            entry.2.push_str(more);
        }
    }
}

#[cfg(test)]
mod tests;
