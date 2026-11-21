//! The tests of the import formats as plug-ins (RULES.md D68): each
//! offered once, by its own name, and each file found its format by its
//! name and what it begins with.

use super::{detect, format_of, formats, offered};
use crate::connections::imports::Format;

/// A file `name` of `bytes`, in the test's own directory.
fn file(name: &str, bytes: &[u8]) -> std::path::PathBuf {
    let dir = crate::testing::scratch(&format!("imports/format-{name}"));
    let path = dir.join(name);
    std::fs::write(&path, bytes).unwrap();
    path
}

/// [DESIGN] D68: every format is offered once, of its name, label,
/// extensions and what of a reading it takes, and found again by its name.
#[test]
fn each_format_is_offered_once() {
    let all = offered();
    let ids: Vec<Format> = all.iter().map(|f| f.id).collect();
    assert_eq!(ids, [Format::Csv, Format::Tsv, Format::Json, Format::Ndjson, Format::Xlsx]);
    for f in formats() {
        assert_eq!(format_of(f.id()).label(), f.label());
        assert_eq!(f.extensions().first().copied(), Some(serde_json::to_value(f.id()).unwrap().as_str().unwrap()));
    }
    let xlsx = all.iter().find(|f| f.id == Format::Xlsx).unwrap();
    assert!(xlsx.takes.sheets && xlsx.takes.header && !xlsx.takes.delimited);
    let json = all.iter().find(|f| f.id == Format::Json).unwrap();
    assert!(!json.takes.header && !json.takes.delimited);
    assert_eq!(serde_json::to_value(&all[1]).unwrap()["id"], "tsv");
}

/// [DESIGN] D68: a file's format is found by its extension and what it
/// begins with: a `.txt` of tabs is tab-separated, of commas CSV; a file
/// of a zip's signature a workbook, whatever its name; a file no format
/// knows none.
#[test]
fn a_files_format_is_detected() {
    let cases: [(&str, &[u8], Option<Format>); 8] = [
        ("a.csv", b"ID,NAME\n1,Ada\n", Some(Format::Csv)),
        ("a.tsv", b"ID\tNAME\n", Some(Format::Tsv)),
        ("a.txt", b"ID\tNAME\n", Some(Format::Tsv)),
        ("b.txt", b"ID,NAME\n", Some(Format::Csv)),
        ("a.json", b" [{\"a\": 1}]", Some(Format::Json)),
        ("a.jsonl", b"{\"a\": 1}\n", Some(Format::Ndjson)),
        ("a.bin", b"PK\x03\x04rest", Some(Format::Xlsx)),
        ("a.dat", b"nothing known", None),
    ];
    for (name, bytes, wanted) in cases {
        assert_eq!(detect(&file(name, bytes)).unwrap(), wanted, "{name}");
    }
    assert!(detect(std::path::Path::new("/no/such/file.csv")).is_err());
}
