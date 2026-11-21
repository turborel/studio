//! The tests of imports: a file previewed, and its fields taken into the
//! columns chosen (RULES.md D43).

use std::io::Write;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use turborel::value::Value;
use turborel_client::import::{Heading, Position, Record, Source, SourceError};

use super::{Format, ImportProgress, Mapped, PREVIEW_RECORDS, Reading, Watch, preview};

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
    Reading { format, header, delimiter: None, null: None, sheet: None }
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
    let shown = preview(&tsv, &read).unwrap();
    assert_eq!((shown.headings, shown.records, shown.sheets), (None, vec![vec![Some("1".to_owned()), None]], None));
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

/// `inner`'s fields at `keep` taken into the columns `names`, unwatched.
fn mapped_of(inner: Fixed, keep: Vec<usize>, names: &[&str]) -> Mapped<'static, Fixed> {
    Mapped {
        inner,
        keep,
        names: names.iter().map(|&n| n.to_owned()).collect(),
        header_read: false,
        watch: None,
        read: (Arc::new(AtomicU64::new(0)), 0),
        records: 0,
        rejected: (Arc::new(AtomicU64::new(0)), None),
        told: Instant::now(),
        binary: Vec::new(),
    }
}

/// [DESIGN] D43: each field kept goes into the column chosen for it, by
/// its delimited name, and the others are let go; a header is read past.
#[test]
fn fields_go_into_the_columns_chosen() {
    let records = vec![vec![Value::Char("1".into()), Value::Char("x".into()), Value::Char("y".into())], vec![Value::Char("2".into())]];
    let mut mapped = mapped_of(Fixed { header: true, records }, vec![2, 0], &["\"B\"", "\"A\""]);
    let headings = mapped.headings().unwrap().unwrap();
    assert_eq!(headings.iter().map(|h| h.name.as_str()).collect::<Vec<_>>(), ["\"B\"", "\"A\""]);
    assert_eq!(mapped.headings().unwrap().unwrap().len(), 2);
    let first = mapped.record().unwrap().unwrap();
    assert!(matches!(first.values.as_slice(), [Value::Char(b), Value::Char(a)] if b == "y" && a == "1"));
    let second = mapped.record().unwrap().unwrap();
    assert!(matches!(second.values.as_slice(), [Value::Null, Value::Char(a)] if a == "2"));
    assert!(mapped.record().unwrap().is_none());
    let mut bare = mapped_of(Fixed { header: false, records: Vec::new() }, vec![0], &["\"A\""]);
    assert_eq!(bare.headings().unwrap().map(|h| h.len()), Some(1));
}

/// [DESIGN] D63: a watched source tells its progress at its end, stops
/// with the cancel's words once it is cancelled, and stops once more rows
/// were skipped than its limit allows.
#[test]
fn a_watched_source_tells_and_hears() {
    let records = || (1..=3).map(|n| vec![Value::Char(n.to_string())]).collect();
    let told = std::sync::Mutex::new(Vec::new());
    let tell = |p: ImportProgress| told.lock().unwrap().push(p);
    let stop = std::sync::atomic::AtomicBool::new(false);
    let watch = Watch { stop: &stop, tell: &tell };
    let mut watched = mapped_of(Fixed { header: false, records: records() }, vec![0], &["\"A\""]);
    watched.watch = Some(&watch);
    watched.read.1 = 3;
    while watched.record().unwrap().is_some() {}
    watched.tell(true);
    assert_eq!(told.lock().unwrap().last().copied(), Some(ImportProgress { records: 3, rejected: 0, read: 3, total: 3 }));
    let mut cancelled = mapped_of(Fixed { header: false, records: records() }, vec![0], &["\"A\""]);
    cancelled.watch = Some(&watch);
    assert!(cancelled.record().unwrap().is_some());
    stop.store(true, Ordering::SeqCst);
    let error = cancelled.record().unwrap_err();
    assert_eq!((error.message.as_str(), error.position.record), (super::CANCELLED, 2));
    let mut limited = mapped_of(Fixed { header: false, records: records() }, vec![0], &["\"A\""]);
    limited.rejected.1 = Some(1);
    limited.rejected.0.store(2, Ordering::Relaxed);
    assert_eq!(limited.record().unwrap_err().message, "more than 1 rows were refused");
}

/// [DESIGN] D63: JSON's records are previewed, each field's type inferred.
#[test]
fn json_is_previewed_and_inferred() {
    let json = file("people.json", r#"[{"id": 12345678901234567890123456789012345678, "doc": {"a": 1}}]"#);
    let shown = preview(&json, &reading(Format::Json, true)).unwrap();
    let types: Vec<&str> = shown.inferred.iter().map(|i| i.type_written.as_str()).collect();
    assert_eq!(types, ["NUMERIC(38,0)", "JSON"]);
    let lines = file("people.ndjson", "{\"ok\": true}\n{\"ok\": false}\n");
    assert_eq!(preview(&lines, &reading(Format::Ndjson, true)).unwrap().inferred[0].type_written, "BOOLEAN");
}
