//! The tests of a `.sql` file read without the editor (RULES.md D62): its
//! encodings, its statements and their lines, memory held, and its scan
//! as the guards judge it.

use std::io::Read;

use super::{CHUNK_BYTES, Encoding, MAX_STATEMENT_BYTES, Statements, scan, shown};
use crate::guard::classify::Class;
use crate::guard::policy::Guards;
use crate::saved::Environment;

/// The statements of `bytes`: each one's text and line.
fn split(bytes: &[u8]) -> Vec<(String, u64)> {
    let mut statements = Statements::new(bytes);
    let mut found = Vec::new();
    while let Some(s) = statements.next_statement().unwrap() {
        found.push((s.text, s.line));
    }
    found
}

/// `text` in UTF-16, of the byte order `unit` writes, its mark first.
fn utf16(text: &str, mark: [u8; 2], unit: fn(u16) -> [u8; 2]) -> Vec<u8> {
    let mut bytes = mark.to_vec();
    for u in text.encode_utf16() {
        bytes.extend(unit(u));
    }
    bytes
}

/// [DOC client/05-protocol.md Query 'Q'] [DESIGN] D62: a file splits as a
/// script does, each statement with the line it begins on, a `;` in a
/// string or a comment no end.
#[test]
fn a_file_splits_into_statements_by_line() {
    let text = "-- a table\nCREATE TABLE T (A VARCHAR(9));\n\nINSERT INTO T VALUES ('a;b');\n/* two\nlines */ INSERT INTO T\n  VALUES ('c');\nSELECT * FROM T";
    let found = split(text.as_bytes());
    let lines: Vec<u64> = found.iter().map(|(_, l)| *l).collect();
    assert_eq!(lines, [2, 4, 6, 8]);
    assert_eq!(found[1].0, "INSERT INTO T VALUES ('a;b')");
    assert!(found[3].0.ends_with("SELECT * FROM T"), "{found:?}");
    assert_eq!(split(b""), []);
    assert_eq!(split(b" \n-- only a comment\n"), []);
}

/// [DESIGN] D62: UTF-8 with or without its mark, and UTF-16 of either
/// byte order with its mark, read alike; a character cut by a chunk's end
/// is carried to the next.
#[test]
fn utf8_and_utf16_with_a_mark_are_read() {
    let text = "INSERT INTO T VALUES ('caf\u{e9} \u{1F600}');\nSELECT 1;";
    let expected = split(text.as_bytes());
    let mut marked = vec![0xEF, 0xBB, 0xBF];
    marked.extend(text.as_bytes());
    assert_eq!(split(&marked), expected);
    assert_eq!(split(&utf16(text, [0xFF, 0xFE], u16::to_le_bytes)), expected);
    assert_eq!(split(&utf16(text, [0xFE, 0xFF], u16::to_be_bytes)), expected);
    for (bytes, encoding) in [(text.as_bytes().to_vec(), Encoding::Utf8), (utf16(text, [0xFE, 0xFF], u16::to_be_bytes), Encoding::Utf16Be)]
    {
        assert_eq!(scan(bytes.as_slice()).unwrap().encoding, encoding);
    }
    // A character of four bytes, and a surrogate pair, across a chunk's end.
    let long = format!("SELECT '{}\u{1F600}';", "x".repeat(CHUNK_BYTES - 10));
    assert_eq!(split(long.as_bytes())[0].0, long.trim_end_matches(';'));
    let wide = format!("SELECT '{}\u{1F600}';", "x".repeat(CHUNK_BYTES.div_euclid(2) - 10));
    assert_eq!(split(&utf16(&wide, [0xFF, 0xFE], u16::to_le_bytes))[0].0, wide.trim_end_matches(';'));
}

/// [DESIGN] D62: a file that is not UTF-8, nor UTF-16 with its mark, is
/// refused, saying how to save it.
#[test]
fn another_encoding_is_refused_clearly() {
    let latin1 = b"SELECT 'caf\xE9';";
    let error = Statements::new(&latin1[..]).next_statement().unwrap_err();
    assert!(error.message.contains("byte 11 is not of UTF-8"), "{error}");
    assert!(error.message.contains("Save it as UTF-8, or as UTF-16 with a byte order mark"), "{error}");
    let unmarked: Vec<u8> = "SELECT 1;".encode_utf16().flat_map(u16::to_le_bytes).collect();
    let error = Statements::new(unmarked.as_slice()).next_statement().unwrap_err();
    assert!(error.message.contains("UTF-16 without a byte order mark"), "{error}");
    let cut = [0xFF, 0xFE, b'S'];
    assert!(Statements::new(&cut[..]).next_statement().unwrap_err().message.contains("ends within a character"));
}

/// A source of `count` INSERT statements, made as it is read, so the test
/// holds none of it.
struct Generated {
    count: u64,
    made: u64,
    pending: Vec<u8>,
}

impl Read for Generated {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        while self.pending.len() < buf.len() && self.made < self.count {
            self.made = self.made.saturating_add(1);
            self.pending.extend(format!("INSERT INTO T VALUES ({}, 'row {} of the file');\n", self.made, self.made).as_bytes());
        }
        let n = buf.len().min(self.pending.len());
        buf[..n].copy_from_slice(&self.pending[..n]);
        self.pending.drain(..n);
        Ok(n)
    }
}

/// [RULE] R-SAFE-1 [DESIGN] D62: a file far larger than a chunk is read
/// with no more held than a chunk and the statement under way, each of
/// its statements given in order with its line.
#[test]
fn a_large_file_is_read_with_bounded_memory() {
    let count = 400_000;
    let mut statements = Statements::new(Generated { count, made: 0, pending: Vec::new() });
    let mut most = 0;
    let mut seen = 0_u64;
    while let Some(s) = statements.next_statement().unwrap() {
        seen += 1;
        assert_eq!(s.line, seen);
        assert_eq!(s.number, seen);
        most = most.max(statements.held_bytes());
    }
    assert_eq!(seen, count);
    assert!(statements.bytes_read() > u64::try_from(160 * CHUNK_BYTES).unwrap(), "{}", statements.bytes_read());
    assert!(most <= 2 * CHUNK_BYTES, "held {most} bytes");
}

/// [DESIGN] D62: a statement longer than the most Studio sends is refused
/// by its line, not read on to the file's end.
#[test]
fn a_statement_too_long_is_refused() {
    let mut text = b"SELECT 1;\nSELECT '".to_vec();
    text.resize(text.len() + MAX_STATEMENT_BYTES + CHUNK_BYTES, b'x');
    let mut statements = Statements::new(text.as_slice());
    assert_eq!(statements.next_statement().unwrap().unwrap().text, "SELECT 1");
    let error = statements.next_statement().unwrap_err();
    assert!(error.message.contains("statement on line 2 is longer than"), "{error}");
}

/// [RULE] R-SEC-8 [DESIGN] D62: a scan counts the statements by class and
/// lists each destructive one and each not classified by its line, and
/// the guards ask once of it.
#[test]
fn a_scan_is_judged_by_the_guards() {
    let text = "CREATE TABLE T (A INTEGER);\nINSERT INTO T VALUES (1);\nSELECT * FROM T;\nDELETE FROM T;\nDROP TABLE T CASCADE;\nEXECUTE IMMEDIATE 'SELECT 1';";
    let scanned = scan(text.as_bytes()).unwrap();
    assert_eq!(scanned.statements, 6);
    assert_eq!(scanned.bytes, u64::try_from(text.len()).unwrap());
    assert_eq!(scanned.classes[&Class::WriteRows], 2);
    assert_eq!(scanned.classes[&Class::ChangeSchema], 2);
    assert_eq!(scanned.classes[&Class::Read], 1);
    assert_eq!(scanned.destroys.iter().map(|l| l.line).collect::<Vec<_>>(), [4, 5]);
    assert_eq!(scanned.unclassified[0].line, 6);
    let confirm = Guards::default().judge_scan(&scanned).unwrap().unwrap();
    assert_eq!(confirm.class, Class::Unclassified);
    assert!(confirm.destroys[0].starts_with("line 4: DELETE of every row of T"), "{:?}", confirm.destroys);
    assert!(confirm.unclassified[0].starts_with("line 6: EXECUTE IMMEDIATE"), "{:?}", confirm.unclassified);
    assert!(!confirm.production);
}

/// [RULE] R-SEC-7 [DESIGN] D62: a read-only connection refuses a file
/// that may write, by its line, and runs one that reads; production asks
/// of any write; CONNECT is refused.
#[test]
fn a_scan_is_refused_or_asked_by_the_connection() {
    let scanned = scan("CREATE TABLE T (A INTEGER);\nSELECT * FROM T;".as_bytes()).unwrap();
    let read_only = Guards { read_only: true, ..Guards::default() };
    let refused = read_only.judge_scan(&scanned).unwrap_err();
    assert_eq!(refused.sqlstate, "25006");
    assert!(refused.message.contains("line 1 may write"), "{refused}");
    let reads = scan("SELECT * FROM T;\nVALUES (2);".as_bytes()).unwrap();
    assert_eq!(read_only.judge_scan(&reads).unwrap(), None);
    let production = Guards { environment: Environment::Production, read_only: false };
    let inserts = scan("INSERT INTO T VALUES (1);".as_bytes()).unwrap();
    assert_eq!(Guards::default().judge_scan(&inserts).unwrap(), None);
    assert!(production.judge_scan(&inserts).unwrap().unwrap().production);
    let connects = scan("SELECT * FROM T;\nCONNECT TO 'other';".as_bytes()).unwrap();
    assert!(Guards::default().judge_scan(&connects).unwrap_err().message.contains("line 2"));
}

/// [DESIGN] D62: a scan lists at most `MAX_LISTED` of a kind, and tells
/// how many more.
#[test]
fn a_scan_lists_so_many_and_counts_the_rest() {
    let text = "DROP TABLE T CASCADE;\n".repeat(super::MAX_LISTED + 5);
    let scanned = scan(text.as_bytes()).unwrap();
    assert_eq!(scanned.destroys.len(), super::MAX_LISTED);
    assert_eq!(scanned.destroys_count, u64::try_from(super::MAX_LISTED + 5).unwrap());
    let confirm = Guards::default().judge_scan(&scanned).unwrap().unwrap();
    assert_eq!(confirm.destroys.last().map(String::as_str), Some("and 5 more"));
    assert_eq!(shown("SELECT\n   1"), "SELECT 1");
    assert_eq!(shown("-- why\n/* how */ SELECT 1"), "SELECT 1");
    assert_eq!(shown(&"x".repeat(300)).chars().count(), super::SHOWN_CHARS + 1);
}
