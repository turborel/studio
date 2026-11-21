//! A model server of the tests' own (RULES.md D55, R-TEST-8): local, on a
//! port of the system's choosing, it answers each request with the next
//! answer it was given, a stream of server-sent events of either format or
//! a refusal by its HTTP status, and keeps each request it took, so no
//! test asks a real model or needs a key.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};

/// An answer of the server's.
#[derive(Debug, Clone)]
pub enum Answer {
    /// A stream of server-sent events, as written.
    Stream(String),
    /// A refusal: its status, its body, and the seconds it asks to wait.
    Status(u16, String, Option<u32>),
}

/// A request the server took: its headers, lower case, and its body.
#[derive(Debug, Clone)]
pub struct Taken {
    /// Its headers, each `name: value`, the name in lower case.
    pub headers: Vec<(String, String)>,
    /// Its path.
    pub path: String,
    /// Its body.
    pub body: String,
}

/// A model server running.
#[derive(Debug)]
pub struct MockModel {
    /// The URL it is at.
    pub url: String,
    taken: Arc<Mutex<Vec<Taken>>>,
}

impl MockModel {
    /// Starts a server of `answers`, given in turn, one a request.
    ///
    /// # Panics
    ///
    /// If no port can be had, as a test's setup fails.
    #[allow(clippy::expect_used, reason = "the tests' own server, whose setup failing fails the test")]
    pub fn start(answers: Vec<Answer>) -> MockModel {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a port for the mock model");
        let url = format!("http://{}", listener.local_addr().expect("its address"));
        let taken = Arc::new(Mutex::new(Vec::new()));
        let kept = Arc::clone(&taken);
        let serve = move || {
            for (answer, stream) in answers.into_iter().zip(listener.incoming()) {
                if let Ok(stream) = stream {
                    // A request that breaks off is let go: the test that
                    // made it fails on its own.
                    let _ = answered(stream, &answer, &kept);
                }
            }
        };
        std::thread::Builder::new().name("studio-mock-model".to_owned()).spawn(serve).expect("the mock model's thread");
        MockModel { url, taken }
    }

    /// The requests taken so far.
    pub fn taken(&self) -> Vec<Taken> {
        self.taken.lock().map(|t| t.clone()).unwrap_or_default()
    }
}

/// Reads a request of `stream`, keeps it, and answers it with `answer`.
fn answered(stream: TcpStream, answer: &Answer, taken: &Mutex<Vec<Taken>>) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut first = String::new();
    reader.read_line(&mut first)?;
    let path = first.split_whitespace().nth(1).unwrap_or_default().to_owned();
    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line)?;
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.push((name.trim().to_ascii_lowercase(), value.trim().to_owned()));
        }
    }
    let length = headers.iter().find(|(n, _)| n == "content-length").and_then(|(_, v)| v.parse::<usize>().ok()).unwrap_or(0);
    let mut body = vec![0; length];
    reader.read_exact(&mut body)?;
    if let Ok(mut t) = taken.lock() {
        t.push(Taken { headers, path, body: String::from_utf8_lossy(&body).into_owned() });
    }
    let mut out = stream;
    let response = match answer {
        Answer::Stream(events) => {
            format!("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nconnection: close\r\n\r\n{events}")
        }
        Answer::Status(status, body, wait) => {
            let retry = wait.map(|w| format!("retry-after: {w}\r\n")).unwrap_or_default();
            format!(
                "HTTP/1.1 {status} Refused\r\ncontent-type: application/json\r\ncontent-length: {}\r\n{retry}connection: close\r\n\r\n{body}",
                body.len()
            )
        }
    };
    out.write_all(response.as_bytes())?;
    out.flush()
}

/// The events of a Messages API stream of `text`, then of each tool call
/// `(id, name, input)`, stopping for `stop`.
pub fn anthropic_stream(text: &str, calls: &[(&str, &str, &str)], stop: &str) -> String {
    let event = |name: &str, data: serde_json::Value| format!("event: {name}\ndata: {data}\n\n");
    let mut out = event(
        "message_start",
        serde_json::json!({"type": "message_start", "message": {"model": "claude-opus-5-5", "usage": {"input_tokens": 10, "cache_read_input_tokens": 8}}}),
    );
    out += &event(
        "content_block_start",
        serde_json::json!({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
    );
    out += &event(
        "content_block_delta",
        serde_json::json!({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text}}),
    );
    for (index, (id, name, input)) in (1..).zip(calls) {
        out += &event(
            "content_block_start",
            serde_json::json!({"type": "content_block_start", "index": index, "content_block": {"type": "tool_use", "id": id, "name": name, "input": {}}}),
        );
        out += &event(
            "content_block_delta",
            serde_json::json!({"type": "content_block_delta", "index": index, "delta": {"type": "input_json_delta", "partial_json": input}}),
        );
    }
    out += &event(
        "message_delta",
        serde_json::json!({"type": "message_delta", "delta": {"stop_reason": stop}, "usage": {"output_tokens": 5}}),
    );
    out + &event("message_stop", serde_json::json!({"type": "message_stop"}))
}

/// The events of a chat-completions stream of `text`, then of each tool
/// call `(id, name, input)`, finishing for `finish`.
pub fn chat_stream(text: &str, calls: &[(&str, &str, &str)], finish: &str) -> String {
    let data = |v: serde_json::Value| format!("data: {v}\n\n");
    let mut out = data(serde_json::json!({"model": "local", "choices": [{"delta": {"content": text}}]}));
    for (i, (id, name, input)) in calls.iter().enumerate() {
        out += &data(
            serde_json::json!({"choices": [{"delta": {"tool_calls": [{"index": i, "id": id, "function": {"name": name, "arguments": input}}]}}]}),
        );
    }
    out += &data(serde_json::json!({"choices": [{"delta": {}, "finish_reason": finish}]}));
    out += &data(serde_json::json!({"choices": [], "usage": {"prompt_tokens": 12, "completion_tokens": 3}}));
    out + "data: [DONE]\n\n"
}
