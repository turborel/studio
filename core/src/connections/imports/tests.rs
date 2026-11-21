//! The tests of imports: a file previewed, and its fields taken into the
//! columns chosen (RULES.md D43).

use std::io::Write;

use turborel::value::Value;
use turborel_client::import::{Heading, Position, Record, Source, SourceError};

use super::{Format, Mapped, PREVIEW_RECORDS, Reading, preview};

/// A file of `text`, in the test's own directory.
fn file(name: &str, text: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("studio-imports-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(name);
    std::fs::File::create(&path).unwrap().write_all(text.as_bytes()).unwrap();
    path
}

/// How a file of `format` is read, its header `header`.
fn reading(format: Format, header: bool) -> Reading {
    Reading { format, header, delimiter: None, null: None }
}

/// [CLIENT Importing] [DESIGN] D43: a file is previewed by its header and
/// its first records, a field quoted read whole, an empty one null, or the
/// text a null is written as.
#[test]
fn a_file_is_previewed() {
    let csv = file("staff.csv", "ID,NAME\n1,\"Ada, Countess\"\n2,\n");
    let shown = preview(&csv, &reading(Format::Csv, true)).unwrap();
    assert_eq!(shown.headings, Some(vec!["ID".to_owned(), "NAME".to_owned()]));
    assert_eq!(shown.records, [vec![Some("1".to_owned()), Some("Ada, Countess".to_owned())], vec![Some("2".to_owned()), None]]);
    let tsv = file("staff.tsv", "1\tN/A\n");
    let read = Reading { null: Some("N/A".to_owned()), ..reading(Format::Tsv, false) };
    assert_eq!(preview(&tsv, &read).unwrap(), super::Preview { headings: None, records: vec![vec![Some("1".to_owned()), None]] });
    let semi = file("semi.csv", "1;2\n");
    let read = Reading { delimiter: Some(';'), ..reading(Format::Csv, false) };
    assert_eq!(preview(&semi, &read).unwrap().records, [vec![Some("1".to_owned()), Some("2".to_owned())]]);
    let many = file("many.csv", &"x\n".repeat(PREVIEW_RECORDS + 5));
    assert_eq!(preview(&many, &reading(Format::Csv, false)).unwrap().records.len(), PREVIEW_RECORDS);
    let bad = Reading { delimiter: Some('"'), ..reading(Format::Csv, false) };
    assert_eq!(preview(&semi, &bad).unwrap_err().sqlstate, "TB910");
    assert_eq!(preview(&csv.with_extension("none"), &reading(Format::Csv, false)).unwrap_err().sqlstate, "TB910");
    let open = file("open.csv", "\"never closed\n");
    assert!(preview(&open, &reading(Format::Csv, false)).unwrap_err().message.contains("record 1"));
}

/// A source of fixed records, with a header or not.
struct Fixed {
    header: bool,
    records: Vec<Vec<Value>>,
}

impl Source for Fixed {
    fn headings(&mut self) -> Result<Option<Vec<Heading>>, SourceError> {
        Ok(self.header.then(|| vec![Heading { name: "A".to_owned(), data_type: None }]))
    }

    fn record(&mut self) -> Result<Option<Record>, SourceError> {
        if self.records.is_empty() {
            return Ok(None);
        }
        let values = self.records.remove(0);
        Ok(Some(Record { values, position: Position { record: 1, line: Some(1) } }))
    }
}

/// [DESIGN] D43: each field kept goes into the column chosen for it, by
/// its delimited name, and the others are let go; a header is read past.
#[test]
fn fields_go_into_the_columns_chosen() {
    let records = vec![vec![Value::Char("1".into()), Value::Char("x".into()), Value::Char("y".into())], vec![Value::Char("2".into())]];
    let mut mapped = Mapped {
        inner: Fixed { header: true, records },
        keep: vec![2, 0],
        names: vec!["\"B\"".to_owned(), "\"A\"".to_owned()],
        header_read: false,
    };
    let headings = mapped.headings().unwrap().unwrap();
    assert_eq!(headings.iter().map(|h| h.name.as_str()).collect::<Vec<_>>(), ["\"B\"", "\"A\""]);
    assert_eq!(mapped.headings().unwrap().unwrap().len(), 2);
    let first = mapped.record().unwrap().unwrap();
    assert!(matches!(first.values.as_slice(), [Value::Char(b), Value::Char(a)] if b == "y" && a == "1"));
    let second = mapped.record().unwrap().unwrap();
    assert!(matches!(second.values.as_slice(), [Value::Null, Value::Char(a)] if a == "2"));
    assert!(mapped.record().unwrap().is_none());
    let mut bare =
        Mapped { inner: Fixed { header: false, records: Vec::new() }, keep: vec![0], names: vec!["\"A\"".to_owned()], header_read: false };
    assert_eq!(bare.headings().unwrap().map(|h| h.len()), Some(1));
}
