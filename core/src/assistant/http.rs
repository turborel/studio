//! The assistant's requests of its model, over HTTP (RULES.md D55): to an
//! endpoint of HTTPS, or of plain HTTP on this machine alone; a request
//! refused for its rate or by the server's failure tried again after a
//! wait that grows, or that the server names; the stream of server-sent
//! events read a line at a time as it comes. The key is sent in a header
//! alone, and never written anywhere.

use std::io::{BufRead, BufReader};
use std::time::Duration;

use serde_json::Value;

use crate::assistant::wire::{ANTHROPIC_VERSION, Delta, FALLBACK_BETA, Reading, Reply, Wire, reading};
use crate::error::{Result, StudioError};
use crate::secret::Secret;

/// The longest a connection to the endpoint takes to open.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
/// The longest a whole request takes, its stream among it.
const REQUEST_TIMEOUT: Duration = Duration::from_mins(30);
/// The most times a request is made, the first among them.
const ATTEMPTS: u32 = 4;
/// The first wait before a request is made again; each after is twice the one before.
const FIRST_WAIT: Duration = Duration::from_secs(1);
/// The longest wait the server may name before a request is made again.
const MOST_WAIT: Duration = Duration::from_secs(60);
/// The User-Agent of Studio's requests.
const USER_AGENT: &str = concat!("turborel-studio/", env!("CARGO_PKG_VERSION"));

/// An endpoint a model is asked at.
#[derive(Debug, Clone)]
pub struct Endpoint {
    /// Its URL, to which `/v1/messages` or `/v1/chat/completions` is added.
    pub base: String,
    /// Its wire format.
    pub wire: Wire,
    /// Whether it is Claude, built in.
    pub claude: bool,
    /// Its key, if it takes one.
    pub key: Option<Secret>,
}

/// Whether `host` is this machine.
fn local(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "[::1]" | "::1")
}

/// `base` checked: of HTTPS, or of HTTP on this machine alone.
///
/// # Errors
///
/// SQLCODE -910 of a URL of another scheme, or of HTTP elsewhere.
pub fn checked(base: &str) -> Result<String> {
    let base = base.trim().trim_end_matches('/');
    let (scheme, rest) = base.split_once("://").ok_or_else(|| StudioError::misuse("[DESIGN] an endpoint is a URL"))?;
    let host = rest.split(['/', '?']).next().unwrap_or_default();
    let host = if host.starts_with('[') {
        host.split(']').next().map(|h| format!("{h}]")).unwrap_or_default()
    } else {
        host.split(':').next().unwrap_or_default().to_owned()
    };
    match scheme.to_ascii_lowercase().as_str() {
        "https" if !host.is_empty() => Ok(base.to_owned()),
        "http" if local(&host) => Ok(base.to_owned()),
        "http" => Err(StudioError::misuse("[DESIGN] an endpoint of another machine is of HTTPS")),
        _ => Err(StudioError::misuse("[DESIGN] an endpoint is of HTTPS, or of HTTP on this machine")),
    }
}

/// The URL `endpoint` is asked at.
fn url(endpoint: &Endpoint) -> String {
    let path = match endpoint.wire {
        Wire::Anthropic => "/v1/messages",
        Wire::ChatCompletions => "/v1/chat/completions",
    };
    format!("{}{path}", endpoint.base.trim_end_matches('/'))
}

/// The wait before attempt `n`, from 0, of the server's `retry-after` if it names one.
fn wait(n: u32, retry_after: Option<&str>) -> Duration {
    let named = retry_after.and_then(|s| s.trim().parse::<u64>().ok()).map(Duration::from_secs);
    named.map_or_else(|| FIRST_WAIT.saturating_mul(1 << n.min(6)), |d| d.min(MOST_WAIT))
}

/// Studio's error of a model's refusal of the request by HTTP `status`, its body `body`.
fn refused(status: u16, body: &str) -> StudioError {
    let said = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.pointer("/error/message").and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_else(|| body.chars().take(400).collect());
    let what = match status {
        400 => "the request was refused as malformed",
        401 => "the key was refused",
        403 => "the key may not do this",
        404 => "no such model or endpoint",
        413 => "the request is too large",
        429 => "the rate limit was reached",
        500..=599 => "the model's server failed",
        _ => "the model refused the request",
    };
    StudioError::misuse(format!("[DESIGN] HTTP {status}: {what}: {said}"))
}

/// Asks `endpoint` with `body`, reading its stream: each part told to
/// `delta` as it comes. A refusal for the rate, or a failure of the
/// server, before the stream begins, is tried again.
///
/// # Errors
///
/// SQLCODE -910 of a request refused, by its HTTP status, of a stream that
/// failed, or of the network.
pub fn ask(endpoint: &Endpoint, body: &Value, delta: &mut dyn FnMut(Delta)) -> Result<Reply> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| StudioError::misuse(format!("[DESIGN] the HTTP client could not be made: {e}")))?;
    let payload = serde_json::to_vec(body).map_err(|e| StudioError::misuse(format!("[DESIGN] the request: {e}")))?;
    let mut attempt: u32 = 0;
    loop {
        let mut request = client.post(url(endpoint)).header("content-type", "application/json").body(payload.clone());
        request = match (endpoint.wire, &endpoint.key) {
            (Wire::Anthropic, key) => {
                let r = request.header("anthropic-version", ANTHROPIC_VERSION);
                let r = if endpoint.claude { r.header("anthropic-beta", FALLBACK_BETA) } else { r };
                match key {
                    Some(k) => r.header("x-api-key", k.expose()),
                    None => r,
                }
            }
            (Wire::ChatCompletions, Some(k)) => request.header("authorization", format!("Bearer {}", k.expose())),
            (Wire::ChatCompletions, None) => request,
        };
        let response = request.send().map_err(|e| StudioError::misuse(format!("[DESIGN] the model could not be reached: {e}")))?;
        let status = response.status().as_u16();
        if status == 200 {
            return streamed(endpoint.wire, response, delta);
        }
        let retry_after = response.headers().get("retry-after").and_then(|v| v.to_str().ok()).map(str::to_owned);
        let text = response.text().unwrap_or_default();
        let again = attempt.checked_add(1).filter(|next| (status == 429 || status >= 500) && *next < ATTEMPTS);
        if let Some(next) = again {
            std::thread::sleep(wait(attempt, retry_after.as_deref()));
            attempt = next;
            continue;
        }
        return Err(refused(status, &text));
    }
}

/// Reads `response`'s server-sent events into a reply.
fn streamed(wire: Wire, response: reqwest::blocking::Response, delta: &mut dyn FnMut(Delta)) -> Result<Reply> {
    let mut reader = reading(wire);
    read_events(BufReader::new(response), reader.as_mut(), delta)?;
    Ok(reader.finish())
}

/// Reads the server-sent events of `source` into `reader`: each event's
/// name and data, its lines of data joined, ended by a blank line.
///
/// # Errors
///
/// SQLCODE -910 of a stream that could not be read, or of an error event.
pub fn read_events(source: impl BufRead, reader: &mut dyn Reading, delta: &mut dyn FnMut(Delta)) -> Result<()> {
    let mut event = String::new();
    let mut data = String::new();
    for line in source.lines() {
        let line = line.map_err(|e| StudioError::misuse(format!("[DESIGN] the model's stream broke: {e}")))?;
        if line.is_empty() {
            if !data.is_empty() {
                reader.read(&event, &data, delta).map_err(|e| StudioError::misuse(format!("[DESIGN] the model failed: {e}")))?;
            }
            event.clear();
            data.clear();
        } else if let Some(name) = line.strip_prefix("event:") {
            name.trim().clone_into(&mut event);
        } else if let Some(more) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(more.strip_prefix(' ').unwrap_or(more));
        }
    }
    if !data.is_empty() {
        reader.read(&event, &data, delta).map_err(|e| StudioError::misuse(format!("[DESIGN] the model failed: {e}")))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
