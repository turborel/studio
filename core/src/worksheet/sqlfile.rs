//! A `.sql` file run without the editor (RULES.md D62): read a chunk at a
//! time, its encoding found by its byte order mark, split into statements
//! as the server splits a request of several (`[DOC client/05-protocol.md
//! Query 'Q']`), each with the line it begins on; and scanned first, so
//! the guards judge the whole file by what it holds, its statements
//! counted by class and each destructive one listed. Memory holds a chunk
//! and the statement being read, whatever the file's size.

use std::collections::{BTreeMap, VecDeque};
use std::io::Read;

use serde::Serialize;
use turborel_client::Splitter;

use crate::error::{Result, StudioError};
use crate::guard::classify::{Class, classify};

/// The bytes read at a time.
pub const CHUNK_BYTES: usize = 64 * 1024;
/// The longest statement a file may hold, in bytes: the longest Studio
/// sends (`[CLIENT Timeouts]`, `MAX_BODY`).
pub const MAX_STATEMENT_BYTES: usize = 16 * 1024 * 1024;
/// The statements a scan lists of each kind, at most.
pub const MAX_LISTED: usize = 200;
/// The characters of a statement a list or a log shows, at most.
pub const SHOWN_CHARS: usize = 200;

/// How a file's text is encoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Encoding {
    /// UTF-8, with a byte order mark or without.
    Utf8,
    /// UTF-16, little-endian, as its byte order mark says.
    Utf16Le,
    /// UTF-16, big-endian, as its byte order mark says.
    Utf16Be,
}

/// What a file that is not text Studio reads is refused with.
fn not_text(why: &str) -> StudioError {
    StudioError::misuse(format!("[DESIGN] the file is not text Studio reads: {why}. Save it as UTF-8, or as UTF-16 with a byte order mark"))
}

/// A file's text, decoded a chunk at a time.
pub struct Decoded<R> {
    input: R,
    encoding: Option<Encoding>,
    /// Bytes read but not yet decoded: a character cut by the chunk's end.
    carry: Vec<u8>,
    /// The bytes read so far.
    read: u64,
    ended: bool,
}

impl<R: Read> Decoded<R> {
    /// `input`, to be decoded.
    pub fn new(input: R) -> Decoded<R> {
        Decoded { input, encoding: None, carry: Vec::new(), read: 0, ended: false }
    }

    /// The encoding found, once the first chunk is read.
    pub fn encoding(&self) -> Option<Encoding> {
        self.encoding
    }

    /// The bytes read so far.
    pub fn bytes_read(&self) -> u64 {
        self.read
    }

    /// The next chunk of text; none at the end.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the file cannot be read, or is not UTF-8, nor
    /// UTF-16 with a byte order mark.
    pub fn chunk(&mut self) -> Result<Option<String>> {
        while !self.ended {
            let mut bytes = std::mem::take(&mut self.carry);
            let had = bytes.len();
            bytes.resize(had.saturating_add(CHUNK_BYTES), 0);
            let got = loop {
                match self.input.read(bytes.get_mut(had..).unwrap_or_default()) {
                    Ok(n) => break n,
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                    Err(e) => return Err(StudioError::misuse(format!("[DESIGN] the file cannot be read: {e}"))),
                }
            };
            bytes.truncate(had.saturating_add(got));
            self.read = self.read.saturating_add(u64::try_from(got).unwrap_or(u64::MAX));
            self.ended = got == 0;
            let encoding = if let Some(e) = self.encoding {
                e
            } else {
                let (encoding, mark) = encoding_of(&bytes)?;
                self.encoding = Some(encoding);
                bytes.drain(..mark);
                encoding
            };
            let text = match encoding {
                Encoding::Utf8 => self.utf8(bytes)?,
                Encoding::Utf16Le => self.utf16(bytes, u16::from_le_bytes)?,
                Encoding::Utf16Be => self.utf16(bytes, u16::from_be_bytes)?,
            };
            if !text.is_empty() {
                return Ok(Some(text));
            }
        }
        if self.carry.is_empty() { Ok(None) } else { Err(not_text("it ends within a character")) }
    }

    /// `bytes` as UTF-8, a character cut by the chunk's end carried.
    fn utf8(&mut self, mut bytes: Vec<u8>) -> Result<String> {
        match std::str::from_utf8(&bytes) {
            Ok(_) => {}
            Err(e) if e.error_len().is_none() && !self.ended => {
                self.carry = bytes.split_off(e.valid_up_to());
            }
            Err(e) => {
                let at = self.read.saturating_sub(u64::try_from(bytes.len().saturating_sub(e.valid_up_to())).unwrap_or(0));
                return Err(not_text(&format!("byte {at} is not of UTF-8")));
            }
        }
        String::from_utf8(bytes).map_err(|_| not_text("it is not UTF-8"))
    }

    /// `bytes` as UTF-16, each unit made by `unit`, a byte or a unit cut
    /// by the chunk's end carried.
    fn utf16(&mut self, mut bytes: Vec<u8>, unit: fn([u8; 2]) -> u16) -> Result<String> {
        if bytes.len() % 2 == 1 {
            self.carry = bytes.split_off(bytes.len().saturating_sub(1));
        }
        let mut units: Vec<u16> = bytes.as_chunks::<2>().0.iter().map(|&p| unit(p)).collect();
        if !self.ended && units.last().is_some_and(|u| (0xD800..0xDC00).contains(u)) {
            let high = units.pop().unwrap_or(0);
            let mut carried = match unit([0, 1]) {
                1 => high.to_be_bytes().to_vec(),
                _ => high.to_le_bytes().to_vec(),
            };
            carried.append(&mut self.carry);
            self.carry = carried;
        }
        char::decode_utf16(units).collect::<std::result::Result<String, _>>().map_err(|_| not_text("it holds a UTF-16 surrogate unpaired"))
    }
}

/// The encoding `first`, a file's first bytes, says, and the bytes of its
/// byte order mark.
fn encoding_of(first: &[u8]) -> Result<(Encoding, usize)> {
    match first {
        [0xEF, 0xBB, 0xBF, ..] => Ok((Encoding::Utf8, 3)),
        [0xFF, 0xFE, ..] => Ok((Encoding::Utf16Le, 2)),
        [0xFE, 0xFF, ..] => Ok((Encoding::Utf16Be, 2)),
        _ if first.contains(&0) => Err(not_text("it holds NUL bytes, as UTF-16 without a byte order mark does")),
        _ => Ok((Encoding::Utf8, 0)),
    }
}

/// A statement of a file: its text, its number among them, the first 1,
/// and the line it begins on, the first 1.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileStatement {
    /// Its text.
    pub text: String,
    /// Its number.
    pub number: u64,
    /// The line it begins on.
    pub line: u64,
}

/// A file's statements, read as they are needed.
pub struct Statements<R> {
    decoded: Decoded<R>,
    splitter: Splitter,
    /// The text read but not yet placed: what follows the last statement
    /// placed.
    held: String,
    /// The lines before `held`.
    lines: u64,
    ready: VecDeque<FileStatement>,
    number: u64,
    finished: bool,
}

impl<R: Read> Statements<R> {
    /// The statements of `input`.
    pub fn new(input: R) -> Statements<R> {
        Statements {
            decoded: Decoded::new(input),
            splitter: Splitter::default(),
            held: String::new(),
            lines: 0,
            ready: VecDeque::new(),
            number: 0,
            finished: false,
        }
    }

    /// The bytes read so far.
    pub fn bytes_read(&self) -> u64 {
        self.decoded.bytes_read()
    }

    /// The encoding found, once the first chunk is read.
    pub fn encoding(&self) -> Option<Encoding> {
        self.decoded.encoding()
    }

    /// The bytes of text held now: what is read and not yet given, which
    /// the splitter holds a copy of as well.
    pub fn held_bytes(&self) -> usize {
        self.held.len().saturating_add(self.ready.iter().map(|s| s.text.len()).sum())
    }

    /// The next statement; none at the end.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the file cannot be read or decoded, or holds a
    /// statement longer than `MAX_STATEMENT_BYTES`.
    pub fn next_statement(&mut self) -> Result<Option<FileStatement>> {
        while self.ready.is_empty() && !self.finished {
            if let Some(text) = self.decoded.chunk()? {
                self.held.push_str(&text);
                let ended = self.splitter.feed(&text);
                self.place(ended);
                if self.held.len() > MAX_STATEMENT_BYTES {
                    return Err(self.too_long());
                }
            } else {
                let last = self.splitter.finish();
                self.place(last.into_iter().collect());
                self.finished = true;
            }
        }
        Ok(self.ready.pop_front())
    }

    /// The refusal of the statement held, too long to send.
    fn too_long(&self) -> StudioError {
        let begun = self.held.trim_start_matches(|c: char| c.is_whitespace() || c == ';');
        let blank = self.held.len().saturating_sub(begun.len());
        let line = self.lines.saturating_add(newlines(self.held.get(..blank).unwrap_or_default())).saturating_add(1);
        StudioError::misuse(format!(
            "[DESIGN] the statement on line {line} is longer than {MAX_STATEMENT_BYTES} bytes, the most Studio sends"
        ))
    }

    /// Each of `ended`, placed in the text held: its line found, and the
    /// text up to its end let go.
    fn place(&mut self, ended: Vec<String>) {
        for text in ended {
            // The splitter gives a statement without the separators around
            // it, but for the newline that ends a comment last in it.
            let sent = if self.held.contains(text.as_str()) { text.as_str() } else { text.strip_suffix('\n').unwrap_or(&text) };
            let (line, end) = match self.held.find(sent) {
                Some(at) => {
                    let before = self.held.get(..at).unwrap_or_default();
                    let line = self.lines.saturating_add(newlines(before)).saturating_add(1);
                    (line, at.saturating_add(sent.len()))
                }
                None => (self.lines.saturating_add(1), 0),
            };
            // A comment before the statement is sent with it, but the line
            // told is the one its code begins on.
            let line = line.saturating_add(newlines(text.get(..code_start(&text)).unwrap_or_default()));
            self.lines = self.lines.saturating_add(newlines(self.held.get(..end).unwrap_or_default()));
            self.held.drain(..end);
            self.number = self.number.saturating_add(1);
            self.ready.push_back(FileStatement { text, number: self.number, line });
        }
    }
}

/// Where the code of `text`, a statement, begins: after the separators and
/// comments before it.
pub(crate) fn code_start(text: &str) -> usize {
    let mut rest = text;
    loop {
        let trimmed = rest.trim_start();
        let after = if trimmed.starts_with("--") {
            trimmed.find('\n').map_or("", |at| trimmed.get(at..).unwrap_or_default())
        } else if let Some(open) = trimmed.strip_prefix("/*") {
            open.find("*/").map_or("", |at| open.get(at.saturating_add(2)..).unwrap_or_default())
        } else {
            return text.len().saturating_sub(trimmed.len());
        };
        rest = after;
    }
}

/// The line breaks of `text`.
fn newlines(text: &str) -> u64 {
    u64::try_from(text.bytes().filter(|&b| b == b'\n').count()).unwrap_or(u64::MAX)
}

/// `text` as a list or a log shows it: on one line, its first
/// `SHOWN_CHARS` characters.
pub fn shown(text: &str) -> String {
    let code = text.get(code_start(text)..).unwrap_or_default();
    let one: String = code.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut cut: String = one.chars().take(SHOWN_CHARS).collect();
    if cut.len() < one.len() {
        cut.push('…');
    }
    cut
}

/// A statement a scan lists: its line, and what it is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listed {
    /// The line it begins on.
    pub line: u64,
    /// What it is, or its text, cut.
    pub what: String,
}

/// What a file holds, as a scan found it before it runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
    /// Its bytes.
    pub bytes: u64,
    /// Its encoding.
    pub encoding: Encoding,
    /// Its statements.
    pub statements: u64,
    /// Its statements of each class.
    pub classes: BTreeMap<Class, u64>,
    /// Its destructive statements, the first `MAX_LISTED`.
    pub destroys: Vec<Listed>,
    /// Its destructive statements in all.
    pub destroys_count: u64,
    /// Its statements no class is known of, the first `MAX_LISTED`.
    pub unclassified: Vec<Listed>,
    /// Its statements no class is known of in all.
    pub unclassified_count: u64,
    /// The first that may write, if one does.
    pub first_write: Option<Listed>,
    /// The first that makes a transaction READ WRITE, if one does.
    pub read_write: Option<Listed>,
    /// The first CONNECT, SET CONNECTION or DISCONNECT, if one is.
    pub connects: Option<Listed>,
}

impl Scan {
    /// The strictest class of its statements; `Read` of none.
    pub fn strictest(&self) -> Class {
        self.classes.keys().copied().max().unwrap_or(Class::Read)
    }
}

/// `list` with `item` added, if it holds fewer than `MAX_LISTED`.
fn listed(list: &mut Vec<Listed>, item: Listed) {
    if list.len() < MAX_LISTED {
        list.push(item);
    }
}

/// Scans the statements of `input`, each classified, none kept.
///
/// # Errors
///
/// As `Statements::next_statement`'s.
pub fn scan<R: Read>(input: R) -> Result<Scan> {
    let mut statements = Statements::new(input);
    let mut scan = Scan {
        bytes: 0,
        encoding: Encoding::Utf8,
        statements: 0,
        classes: BTreeMap::new(),
        destroys: Vec::new(),
        destroys_count: 0,
        unclassified: Vec::new(),
        unclassified_count: 0,
        first_write: None,
        read_write: None,
        connects: None,
    };
    while let Some(s) = statements.next_statement()? {
        let classified = classify(&s.text);
        scan.statements = scan.statements.saturating_add(1);
        let count = scan.classes.entry(classified.class).or_insert(0);
        *count = count.saturating_add(1);
        let here = |what: String| Listed { line: s.line, what };
        if let Some(destroys) = classified.destroys {
            scan.destroys_count = scan.destroys_count.saturating_add(1);
            listed(&mut scan.destroys, here(destroys));
        }
        if classified.class == Class::Unclassified {
            scan.unclassified_count = scan.unclassified_count.saturating_add(1);
            listed(&mut scan.unclassified, here(shown(&s.text)));
        }
        if classified.class.writes() && scan.first_write.is_none() {
            scan.first_write = Some(here(shown(&s.text)));
        }
        if classified.read_write && scan.read_write.is_none() {
            scan.read_write = Some(here(shown(&s.text)));
        }
        if classified.connects && scan.connects.is_none() {
            scan.connects = Some(here(shown(&s.text)));
        }
    }
    scan.bytes = statements.bytes_read();
    scan.encoding = statements.encoding().unwrap_or(Encoding::Utf8);
    Ok(scan)
}

#[cfg(test)]
mod tests;
