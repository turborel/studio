//! Imports of each format (RULES.md D63), on an embedded database: CSV,
//! JSON, an object a line and an Excel sheet, a workbook made here as
//! Excel writes one; a 38-digit number kept whole; progress, cancel and a
//! limit of rows skipped.

use std::io::Write;
use std::path::{Path, PathBuf};

use turborel::value::Value;
use turborel_client::import::Source;
use turborel_studio_core::connections::imports::xlsx::{SheetRecords, cells, sheet_names, workbook};
use turborel_studio_core::connections::imports::{Format, ImportReport, ImportSpec, Reading, preview};
use turborel_studio_core::connections::manager::{ConnectionManager, ImportAnswer};
use turborel_studio_core::connections::outcome::Outcome;
use turborel_studio_core::events::{ConnectionId, Event};

use crate::{Scratch, open, run, spec};

/// The namespace of a sheet's XML.
const MAIN: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
/// The namespace of a package's relationships.
const RELS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
/// The relationships' types, under this.
const TYPES: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
/// The number of 38 digits the tests import.
const WIDE: &str = "12345678901234567890123456789012345678";

/// A sheet's XML of `rows`, each cell's XML whole, its dimensions told
/// as Excel tells them.
fn sheet(rows: &[&str]) -> String {
    let last = rows.iter().flat_map(|r| r.split("r=\"").skip(1)).filter_map(|r| r.chars().next()).max().unwrap_or('A');
    let rows_xml = rows.iter().enumerate().map(|(i, cells)| format!("<row r=\"{}\">{cells}</row>", i + 1)).collect::<Vec<_>>().concat();
    let dimension = format!("<dimension ref=\"A1:{last}{}\"/>", rows.len().max(1));
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><worksheet xmlns=\"{MAIN}\">{dimension}<sheetData>{rows_xml}</sheetData></worksheet>"
    )
}

/// A cell of text, at `at`.
fn text(at: &str, text: &str) -> String {
    format!("<c r=\"{at}\" t=\"inlineStr\"><is><t>{text}</t></is></c>")
}

/// The parts of a workbook of `sheets` but the sheets': its content types,
/// relationships, workbook and styles, its second style a date.
fn package(sheets: &[(&str, &[&str])]) -> Vec<(String, String)> {
    let kind = "application/vnd.openxmlformats-officedocument.spreadsheetml";
    let xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>";
    let overrides = (1..=sheets.len())
        .map(|n| format!("<Override PartName=\"/xl/worksheets/sheet{n}.xml\" ContentType=\"{kind}.worksheet+xml\"/>"))
        .collect::<Vec<_>>()
        .concat();
    let types = format!(
        "{xml}<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"{kind}.sheet.main+xml\"/><Override PartName=\"/xl/styles.xml\" ContentType=\"{kind}.styles+xml\"/>{overrides}</Types>"
    );
    let root = format!(
        "{xml}<Relationships xmlns=\"{RELS}\"><Relationship Id=\"rId1\" Type=\"{TYPES}/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>"
    );
    let listed = sheets
        .iter()
        .enumerate()
        .map(|(i, (name, _))| format!("<sheet name=\"{name}\" sheetId=\"{}\" r:id=\"rId{}\"/>", i + 1, i + 1))
        .collect::<Vec<_>>()
        .concat();
    let book = format!("{xml}<workbook xmlns=\"{MAIN}\" xmlns:r=\"{TYPES}\"><sheets>{listed}</sheets></workbook>");
    let mut rels = (1..=sheets.len())
        .map(|n| format!("<Relationship Id=\"rId{n}\" Type=\"{TYPES}/worksheet\" Target=\"worksheets/sheet{n}.xml\"/>"))
        .collect::<Vec<_>>();
    rels.push(format!("<Relationship Id=\"rId{}\" Type=\"{TYPES}/styles\" Target=\"styles.xml\"/>", sheets.len() + 1));
    let rels = format!("{xml}<Relationships xmlns=\"{RELS}\">{}</Relationships>", rels.concat());
    let styles = format!(
        "{xml}<styleSheet xmlns=\"{MAIN}\"><cellXfs count=\"2\"><xf numFmtId=\"0\"/><xf numFmtId=\"14\" applyNumberFormat=\"1\"/></cellXfs></styleSheet>"
    );
    [
        ("[Content_Types].xml", types),
        ("_rels/.rels", root),
        ("xl/workbook.xml", book),
        ("xl/_rels/workbook.xml.rels", rels),
        ("xl/styles.xml", styles),
    ]
    .into_iter()
    .map(|(name, xml)| (name.to_owned(), xml))
    .collect()
}

/// A workbook at `path` of `sheets`, each its name and its rows' cells,
/// its parts as Excel writes them.
fn write_workbook(path: &Path, sheets: &[(&str, &[&str])]) {
    let mut zip = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let sheet_parts = sheets.iter().enumerate().map(|(n, (_, rows))| (format!("xl/worksheets/sheet{}.xml", n + 1), sheet(rows)));
    for (name, xml) in package(sheets).into_iter().chain(sheet_parts) {
        zip.start_file(name, stored).unwrap();
        zip.write_all(xml.as_bytes()).unwrap();
    }
    zip.finish().unwrap();
}

/// The values of `values` as text, a null as none.
fn texts(values: Vec<Value>) -> Vec<Option<String>> {
    values.into_iter().map(|v| if let Value::Char(s) = v { Some(s) } else { None }).collect()
}

/// `s` as a value, of a test.
#[expect(clippy::unnecessary_wraps, reason = "a field's value, which is an Option")]
fn some(s: &str) -> Option<String> {
    Some(s.to_owned())
}

/// A workbook of people: a header, then two rows of a number, a name, a
/// date, a truth value and a score, the second's score an error.
fn people(scratch: &Scratch) -> PathBuf {
    let at = scratch.path("people").with_extension("xlsx");
    let header = [text("A1", "ID"), text("B1", "Name"), text("C1", "Born"), text("D1", "Ok"), text("E1", "Score")].concat();
    let first = [
        r#"<c r="A2"><v>1</v></c>"#.to_owned(),
        text("B2", "Ada"),
        r#"<c r="C2" s="1"><v>45293</v></c>"#.to_owned(),
        r#"<c r="D2" t="b"><v>1</v></c>"#.to_owned(),
        r#"<c r="E2"><v>0.1</v></c>"#.to_owned(),
    ]
    .concat();
    let second = [r#"<c r="A3"><v>2</v></c>"#.to_owned(), r#"<c r="E3" t="e"><v>#N/A</v></c>"#.to_owned()].concat();
    write_workbook(&at, &[("People", &[&header, &first, &second]), ("Other", &[&text("A1", "x")])]);
    at
}

/// [DESIGN] D63: a sheet's rows are read a row at a time, its first the
/// headings if asked: numbers as their shortest decimal, a date as
/// `YYYY-MM-DD`, truth values as TRUE and FALSE, an error as Excel shows
/// it, a cell not written null; its sheets named in order; a file that is
/// no workbook, or a sheet it has not, refused.
pub fn a_sheet_is_read_by_rows(scratch: &Scratch) {
    let at = people(scratch);
    assert_eq!(sheet_names(&at).unwrap(), ["People", "Other"]);
    let mut book = workbook(&at).unwrap();
    let mut records = SheetRecords::new(cells(&mut book, None).unwrap(), true);
    let headings: Vec<String> = records.headings().unwrap().unwrap().into_iter().map(|h| h.name).collect();
    assert_eq!(headings, ["ID", "Name", "Born", "Ok", "Score"]);
    let one = records.record().unwrap().unwrap();
    assert_eq!((one.position.record, one.position.line), (1, Some(2)));
    assert_eq!(texts(one.values), [some("1"), some("Ada"), some("2024-01-02"), some("TRUE"), some("0.1")]);
    assert_eq!(texts(records.record().unwrap().unwrap().values), [some("2"), None, None, None, some("#N/A")]);
    assert!(records.record().unwrap().is_none());
    let mut book = workbook(&at).unwrap();
    let mut other = SheetRecords::new(cells(&mut book, Some("Other")).unwrap(), false);
    assert_eq!(other.headings().unwrap(), None);
    assert_eq!(texts(other.record().unwrap().unwrap().values), [some("x")]);
    let shown = preview(&at, &Reading { format: Format::Xlsx, header: true, delimiter: None, null: None, sheet: None }).unwrap();
    assert_eq!(shown.sheets, Some(vec!["People".to_owned(), "Other".to_owned()]));
    let types: Vec<&str> = shown.inferred.iter().map(|i| i.type_written.as_str()).collect();
    assert_eq!(types, ["INTEGER", "VARCHAR(10)", "DATE", "BOOLEAN", "VARCHAR(10)"]);
    let not = scratch.path("not").with_extension("xlsx");
    std::fs::write(&not, "ID,NAME\n").unwrap();
    assert!(workbook(&not).is_err_and(|e| e.message.contains("not a workbook Studio reads")));
    let mut opened = workbook(&at).unwrap();
    assert!(cells(&mut opened, Some("Missing")).is_err_and(|e| e.message.contains("the sheet Missing cannot be read")));
}

/// An import of `path`, read as `format` says, into WIDE, its fields the
/// columns `fields`.
fn wide_spec(path: &Path, format: Format, fields: &[&str]) -> ImportSpec {
    ImportSpec {
        path: path.to_owned(),
        reading: Reading { format, header: true, delimiter: None, null: None, sheet: None },
        table: "WIDE".into(),
        fields: fields.iter().map(|&f| Some(f.to_owned())).collect(),
        batch: 1000,
        skip: false,
        limit: None,
    }
}

/// What `spec` imported on `id`, not asked.
fn imported(manager: &ConnectionManager, id: ConnectionId, spec: ImportSpec) -> ImportReport {
    match manager.import(id, spec, false).unwrap() {
        ImportAnswer::Imported(report) => report,
        ImportAnswer::Confirm(confirm) => panic!("asked: {confirm:?}"),
    }
}

/// The rows of WIDE, by ID, the table emptied after.
fn emptied(manager: &ConnectionManager, id: ConnectionId) -> Vec<Vec<Option<String>>> {
    let Outcome::Rows { result, page, .. } = run(manager, id, "SELECT ID, N, OK FROM WIDE ORDER BY ID").unwrap().outcome else {
        panic!("no rows")
    };
    let _ = manager.close_result(id, result);
    run(manager, id, "DELETE FROM WIDE WHERE ID > 0").unwrap();
    page.rows
}

/// [DESIGN] D63 [DOC sql/02-data-types.md Numbers]: a JSON array, an
/// object a line and a sheet are each imported, a 38-digit number kept
/// whole, truth values as BOOLEAN; the progress told at the end.
pub fn each_format_is_imported(scratch: &Scratch) {
    let (manager, events) = scratch.manager();
    let id = open(&manager, &spec(&scratch.path("db"), true)).unwrap().connection;
    manager.set_autocommit(id, true).unwrap();
    run(&manager, id, "CREATE TABLE WIDE (ID INTEGER PRIMARY KEY, N NUMERIC(38,0), OK BOOLEAN, DOC JSON)").unwrap();
    let expected = vec![vec![some("1"), some(WIDE), some("TRUE")], vec![some("2"), some("-1"), some("FALSE")]];
    let json = scratch.path("wide").with_extension("json");
    std::fs::write(&json, format!(r#"[{{"id": 1, "n": {WIDE}, "ok": true, "doc": {{"a": [1]}}}}, {{"id": 2, "n": -1, "ok": false}}]"#))
        .unwrap();
    let report = imported(&manager, id, wide_spec(&json, Format::Json, &["ID", "N", "OK", "DOC"]));
    assert_eq!((report.rows, report.cancelled), (2, false));
    assert_eq!(emptied(&manager, id), expected);
    let lines = scratch.path("wide").with_extension("ndjson");
    std::fs::write(&lines, format!("{{\"id\": 1, \"n\": {WIDE}, \"ok\": true}}\n{{\"id\": 2, \"n\": -1, \"ok\": false}}\n")).unwrap();
    imported(&manager, id, wide_spec(&lines, Format::Ndjson, &["ID", "N", "OK"]));
    assert_eq!(emptied(&manager, id), expected);
    let book = scratch.path("wide").with_extension("xlsx");
    let header = [text("A1", "ID"), text("B1", "N"), text("C1", "OK")].concat();
    let one = [r#"<c r="A2"><v>1</v></c>"#.to_owned(), text("B2", WIDE), r#"<c r="C2" t="b"><v>1</v></c>"#.to_owned()].concat();
    let two = [r#"<c r="A3"><v>2</v></c>"#, r#"<c r="B3"><v>-1</v></c>"#, r#"<c r="C3" t="b"><v>0</v></c>"#].concat();
    write_workbook(&book, &[("Wide", &[&header, &one, &two])]);
    imported(&manager, id, wide_spec(&book, Format::Xlsx, &["ID", "N", "OK"]));
    assert_eq!(emptied(&manager, id), expected);
    let told: Vec<_> =
        events.take().into_iter().filter_map(|e| if let Event::Import { progress, .. } = e { Some(progress) } else { None }).collect();
    let last = told.last().unwrap();
    assert_eq!((last.records, last.read, last.total), (2, 2, 2));
    manager.close(id).unwrap();
}

/// [DESIGN] D63: an import skips at most the rows its limit allows, then
/// stops; cancelled, it keeps the batches committed, rolls back the one
/// under way, and says so.
pub fn an_import_is_limited_and_cancelled(scratch: &Scratch) {
    let (manager, _) = scratch.manager();
    let id = open(&manager, &spec(&scratch.path("db"), true)).unwrap().connection;
    manager.set_autocommit(id, true).unwrap();
    run(&manager, id, "CREATE TABLE WIDE (ID INTEGER PRIMARY KEY, N NUMERIC(38,0), OK BOOLEAN)").unwrap();
    let bad = scratch.path("bad").with_extension("csv");
    std::fs::write(&bad, "ID,N\n1,x\n2,y\n3,z\n4,5\n").unwrap();
    let limited = ImportSpec { skip: true, limit: Some(1), batch: 1, ..wide_spec(&bad, Format::Csv, &["ID", "N"]) };
    let stopped = manager.import(id, limited, false).unwrap_err();
    assert!(stopped.message.contains("more than 1 rows were refused"), "{}", stopped.message);
    let many = scratch.path("many").with_extension("csv");
    let text = std::iter::once("ID,N\n".to_owned()).chain((1..=20_000).map(|n| format!("{n},{n}\n"))).collect::<Vec<_>>().concat();
    std::fs::write(&many, text).unwrap();
    let report = std::thread::scope(|scope| {
        let running = scope.spawn(|| imported(&manager, id, ImportSpec { batch: 100, ..wide_spec(&many, Format::Csv, &["ID", "N"]) }));
        while !running.is_finished() {
            let _ = manager.cancel_import(id); // None runs until the import begins.
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        running.join().unwrap()
    });
    assert!(report.cancelled, "{report:?}");
    assert_eq!(report.rows % 100, 0);
    let Outcome::Rows { page, result, .. } = run(&manager, id, "SELECT COUNT(*) FROM WIDE").unwrap().outcome else { panic!("no rows") };
    let _ = manager.close_result(id, result);
    assert_eq!(page.rows[0][0], Some(report.rows.to_string()));
    assert!(manager.cancel_import(id).unwrap_err().message.contains("no import runs"));
    manager.close(id).unwrap();
}
