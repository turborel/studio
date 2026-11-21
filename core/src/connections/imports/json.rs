//! JSON's records imported (RULES.md D63): a file of one array of objects
//! [RFC 8259], or of one object a line (NDJSON), read an object at a time,
//! so memory holds a record, whatever the file's size. The fields are the
//! keys of the first objects, in the order they first come; each value
//! taken as its text, a number's exactly as written, so a number of 38
//! digits keeps every one, an object's or array's as JSON's text.

use std::collections::VecDeque;
use std::fmt;
use std::io::{BufRead, Read};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::AtomicU64;

use serde::Deserialize;
use serde::de::{MapAccess, Visitor};
use serde_json::value::RawValue;
use turborel::value::Value;
use turborel_client::import::{Heading, Position, Record, Source, SourceError};

use crate::connections::imports::format::{ImportFormat, Takes, Total, first_byte, named};
use crate::connections::imports::{Format, Reading, opened};
use crate::error::Result as StudioResult;

/// The objects whose keys name the fields.
pub const KEYED_BY: usize = 100;
/// The longest object read, in bytes: one longer is refused, not read on.
pub const MAX_OBJECT_BYTES: u64 = 16 * 1024 * 1024;

/// An object's members, in the order they are written.
struct Ordered(Vec<(String, Box<RawValue>)>);

impl<'de> Deserialize<'de> for Ordered {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Ordered, D::Error> {
        /// What reads an object's members in order.
        struct Members;
        impl<'de> Visitor<'de> for Members {
            type Value = Ordered;

            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("an object")
            }

            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Ordered, A::Error> {
                let mut members = Vec::new();
                while let Some(member) = map.next_entry::<String, Box<RawValue>>()? {
                    members.push(member);
                }
                Ok(Ordered(members))
            }
        }
        deserializer.deserialize_map(Members)
    }
}

/// `raw`, a JSON value, as a field's value: null as null, a string as its
/// text, true and false as TRUE and FALSE, a number as written, an object
/// or array as its JSON text.
pub fn value_of(raw: &RawValue) -> Value {
    let text = raw.get().trim();
    match text.as_bytes().first() {
        Some(b'"') => serde_json::from_str::<String>(text).map_or_else(|_| Value::Char(text.to_owned()), Value::Char),
        Some(b'n') => Value::Null,
        Some(b't') => Value::Char("TRUE".to_owned()),
        Some(b'f') => Value::Char("FALSE".to_owned()),
        _ => Value::Char(text.to_owned()),
    }
}

/// How the objects are laid out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Layout {
    /// One array of objects.
    Array,
    /// One object a line.
    Lines,
}

/// A JSON file's records.
pub struct JsonRecords<R> {
    input: R,
    layout: Layout,
    /// The objects read to find the fields, not yet given.
    ahead: VecDeque<(Ordered, Position)>,
    keys: Option<Vec<String>>,
    /// Objects read.
    count: u64,
    /// Lines read, of `Lines`.
    line: u64,
    /// Whether the array's `[` is read.
    begun: bool,
    ended: bool,
}

impl<R: BufRead> JsonRecords<R> {
    /// The records of `input`, laid out as `layout` says.
    pub fn new(input: R, layout: Layout) -> JsonRecords<R> {
        JsonRecords { input, layout, ahead: VecDeque::new(), keys: None, count: 0, line: 0, begun: false, ended: false }
    }

    /// Where the object being read begins.
    fn here(&self) -> Position {
        let line = (self.layout == Layout::Lines).then_some(self.line);
        Position { record: self.count.saturating_add(1), line }
    }

    /// A failure at the object being read.
    fn failed(&self, message: impl Into<String>) -> SourceError {
        SourceError { position: self.here(), message: message.into() }
    }

    /// The input's buffer, filled if it is empty.
    fn buffered(&mut self) -> Result<&[u8], SourceError> {
        let here = self.here();
        self.input.fill_buf().map_err(|e| SourceError { position: here, message: format!("the file cannot be read: {e}") })
    }

    /// The next byte that is not white space, read past; none at the end.
    fn next_byte(&mut self) -> Result<Option<u8>, SourceError> {
        loop {
            let Some(&b) = self.buffered()?.first() else { return Ok(None) };
            self.input.consume(1);
            if !b.is_ascii_whitespace() {
                return Ok(Some(b));
            }
        }
    }

    /// The next object of the array, if one is left.
    fn next_in_array(&mut self) -> Result<Option<Ordered>, SourceError> {
        if self.begun {
            match self.next_byte()? {
                Some(b',') => {}
                Some(b']') => {
                    self.ended = true;
                    return Ok(None);
                }
                _ => return Err(self.failed("an object of the array is followed by neither , nor ]")),
            }
        } else {
            self.begun = true;
            match self.next_byte()? {
                Some(b'[') => {}
                _ => return Err(self.failed("the file is not a JSON array of objects: it does not begin with [")),
            }
            // An empty array, `[]`, has no object.
            if self.buffered()?.iter().find(|b| !b.is_ascii_whitespace()) == Some(&b']') {
                self.next_byte()?;
                self.ended = true;
                return Ok(None);
            }
        }
        let mut limited = (&mut self.input).take(MAX_OBJECT_BYTES);
        let mut reading = serde_json::Deserializer::from_reader(&mut limited);
        let object = Ordered::deserialize(&mut reading);
        object.map(Some).map_err(|e| self.failed(format!("not an object of JSON, or longer than {MAX_OBJECT_BYTES} bytes: {e}")))
    }

    /// The next object a line, blank lines passed by, if one is left.
    fn next_line(&mut self) -> Result<Option<Ordered>, SourceError> {
        loop {
            let mut text = Vec::new();
            let read = (&mut self.input).take(MAX_OBJECT_BYTES.saturating_add(1)).read_until(b'\n', &mut text);
            let read = read.map_err(|e| self.failed(format!("the file cannot be read: {e}")))?;
            if read == 0 {
                self.ended = true;
                return Ok(None);
            }
            self.line = self.line.saturating_add(1);
            if u64::try_from(text.len()).unwrap_or(u64::MAX) > MAX_OBJECT_BYTES {
                return Err(self.failed(format!("the line is longer than {MAX_OBJECT_BYTES} bytes")));
            }
            if text.iter().all(u8::is_ascii_whitespace) {
                continue;
            }
            return serde_json::from_slice::<Ordered>(&text).map(Some).map_err(|e| self.failed(format!("not an object of JSON: {e}")));
        }
    }

    /// The next object, if one is left, with where it began: one read
    /// ahead first.
    fn next_object(&mut self) -> Result<Option<(Ordered, Position)>, SourceError> {
        match self.ahead.pop_front() {
            Some(ahead) => Ok(Some(ahead)),
            None => self.read_object(),
        }
    }

    /// The next object of the file, if one is left, with where it began.
    fn read_object(&mut self) -> Result<Option<(Ordered, Position)>, SourceError> {
        if self.ended {
            return Ok(None);
        }
        let object = match self.layout {
            Layout::Array => self.next_in_array()?,
            Layout::Lines => self.next_line()?,
        };
        Ok(object.map(|o| {
            self.count = self.count.saturating_add(1);
            let line = (self.layout == Layout::Lines).then_some(self.line);
            (o, Position { record: self.count, line })
        }))
    }
}

impl<R: BufRead> Source for JsonRecords<R> {
    fn headings(&mut self) -> Result<Option<Vec<Heading>>, SourceError> {
        let mut keys: Vec<String> = Vec::new();
        while self.ahead.len() < KEYED_BY {
            let Some(object) = self.read_object()? else { break };
            for (key, _) in &object.0.0 {
                if !keys.contains(key) {
                    keys.push(key.clone());
                }
            }
            self.ahead.push_back(object);
        }
        self.keys = Some(keys.clone());
        Ok(Some(keys.into_iter().map(|name| Heading { name, data_type: None }).collect()))
    }

    fn record(&mut self) -> Result<Option<Record>, SourceError> {
        let Some((Ordered(members), position)) = self.next_object()? else { return Ok(None) };
        let keys = self.keys.as_deref().unwrap_or_default();
        let mut values = vec![Value::Null; keys.len()];
        for (key, raw) in members {
            let Some(at) = keys.iter().position(|k| *k == key) else {
                return Err(SourceError {
                    position,
                    message: format!("the key \"{key}\" is of none of the first {KEYED_BY} objects, whose keys name the fields"),
                });
            };
            if let Some(slot) = values.get_mut(at) {
                *slot = value_of(&raw);
            }
        }
        Ok(Some(Record { values, position }))
    }
}

/// JSON as a format of the import wizard (RULES.md D68): one array of
/// objects, or one object a line.
pub struct JsonFormat {
    layout: Layout,
}

/// One JSON array of objects.
pub static JSON: JsonFormat = JsonFormat { layout: Layout::Array };
/// One JSON object a line.
pub static NDJSON: JsonFormat = JsonFormat { layout: Layout::Lines };

impl ImportFormat for JsonFormat {
    fn id(&self) -> Format {
        match self.layout {
            Layout::Array => Format::Json,
            Layout::Lines => Format::Ndjson,
        }
    }

    fn label(&self) -> &'static str {
        match self.layout {
            Layout::Array => "JSON array",
            Layout::Lines => "JSON, an object a line",
        }
    }

    fn extensions(&self) -> &'static [&'static str] {
        match self.layout {
            Layout::Array => &["json"],
            Layout::Lines => &["ndjson", "jsonl"],
        }
    }

    fn takes(&self) -> Takes {
        Takes { header: false, delimited: false, sheets: false }
    }

    /// Of an array, `[` first; of objects a line, `{` first; by name too
    /// of its own extensions.
    fn detect(&self, path: &Path, first: &[u8]) -> u8 {
        let begins = match self.layout {
            Layout::Array => b'[',
            Layout::Lines => b'{',
        };
        let by_content = u8::from(first_byte(first) == Some(begins));
        if named(path, self.extensions()) { by_content.saturating_add(2) } else { by_content }
    }

    fn records(
        &self,
        path: &Path,
        _: &Reading,
        read: &Arc<AtomicU64>,
        work: &mut dyn FnMut(&mut dyn Source, Total) -> StudioResult<()>,
    ) -> StudioResult<()> {
        let size = std::fs::metadata(path).map_or(0, |m| m.len());
        let mut source = JsonRecords::new(opened(path, Arc::clone(read))?, self.layout);
        work(&mut source, Total::Bytes(size))
    }
}

#[cfg(test)]
mod tests;
