//! The tests of JSON's records (RULES.md D63): an array of objects and an
//! object a line, their fields, values and failures.

use turborel::value::Value;
use turborel_client::import::Source;

use super::{JsonRecords, KEYED_BY, Layout};

/// The headings and each record's values, as text or null, of `text`.
fn read(text: &str, layout: Layout) -> (Vec<String>, Vec<Vec<Option<String>>>) {
    let mut records = JsonRecords::new(text.as_bytes(), layout);
    let headings = records.headings().unwrap().unwrap().into_iter().map(|h| h.name).collect();
    let mut all = Vec::new();
    while let Some(record) = records.record().unwrap() {
        all.push(record.values.into_iter().map(|v| if let Value::Char(s) = v { Some(s.to_string()) } else { None }).collect());
    }
    (headings, all)
}

/// `text` as a value, of a test.
#[expect(clippy::unnecessary_wraps, reason = "a field's value, which is an Option")]
fn some(text: &str) -> Option<String> {
    Some(text.to_owned())
}

/// [DESIGN] D63: an array of objects gives a record an object, its fields
/// the keys in the order they first come; a number is kept as written,
/// every one of 38 digits; a string as its text; true and false as TRUE
/// and FALSE; an object or array as its JSON; a key missing, or null, as
/// null.
#[test]
fn an_array_of_objects_is_read() {
    let wide = "12345678901234567890123456789012345678";
    let text =
        format!(r#" [ {{"id": 1, "name": "Ada \"A\"", "n": {wide}}}, {{"name": null, "id": 2, "ok": true, "doc": {{"a": [1, 2]}}}} ] "#);
    let (headings, records) = read(&text, Layout::Array);
    assert_eq!(headings, ["id", "name", "n", "ok", "doc"]);
    assert_eq!(records[0], [some("1"), some("Ada \"A\""), some(wide), None, None]);
    assert_eq!(records[1], [some("2"), None, None, some("TRUE"), some(r#"{"a": [1, 2]}"#)]);
    assert_eq!(read("[]", Layout::Array), (Vec::new(), Vec::new()));
}

/// [DESIGN] D63: an object a line gives a record a line, blank lines
/// passed by, each failure told by its line.
#[test]
fn an_object_a_line_is_read() {
    let (headings, records) = read("{\"a\": 1.50}\n\n{\"a\": -2, \"b\": \"x\"}\n", Layout::Lines);
    assert_eq!(headings, ["a", "b"]);
    assert_eq!(records, [vec![some("1.50"), None], vec![some("-2"), some("x")]]);
    let mut bad = JsonRecords::new("{\"a\": 1}\n[2]\n".as_bytes(), Layout::Lines);
    let error = bad.headings().unwrap_err();
    assert_eq!(error.position.line, Some(2));
    assert!(error.message.contains("not an object of JSON"), "{error}");
}

/// [DESIGN] D63: a file that is not an array of objects, an object of an
/// array followed by neither `,` nor `]`, and a key first seen past the
/// objects whose keys name the fields, are refused, by their record.
#[test]
fn what_is_not_records_is_refused() {
    let mut scalar = JsonRecords::new("{\"a\": 1}".as_bytes(), Layout::Array);
    assert!(scalar.headings().unwrap_err().message.contains("does not begin with ["));
    let mut unended = JsonRecords::new("[{\"a\": 1} {\"a\": 2}]".as_bytes(), Layout::Array);
    assert!(unended.headings().unwrap_err().message.contains("neither , nor ]"));
    let mut text = String::from("[");
    for _ in 0..KEYED_BY {
        text.push_str("{\"a\": 1},");
    }
    text.push_str("{\"late\": 2}]");
    let mut late = JsonRecords::new(text.as_bytes(), Layout::Array);
    late.headings().unwrap();
    for _ in 0..KEYED_BY {
        late.record().unwrap().unwrap();
    }
    let error = late.record().unwrap_err();
    assert_eq!(error.position.record, u64::try_from(KEYED_BY).unwrap() + 1);
    assert!(error.message.contains("\"late\""), "{error}");
}
