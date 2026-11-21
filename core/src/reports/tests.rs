//! The reports: kept, bounded, and the manual's file read.

use super::{Chart, ChartKind, MAX_CHART_VALUES, REPORTS_FILE, Report, Reports, built_in_reports};

/// A report of `id`, its rows a table.
fn report(id: &str) -> Report {
    Report { id: id.to_owned(), name: format!("report {id}"), sql: "SELECT 1 FROM T".to_owned(), chart: None }
}

/// [DESIGN] D52: a report is kept in place of the one of its identifier,
/// else last, and forgotten; the file is read back as written.
#[test]
fn reports_are_kept_and_forgotten() {
    let dir = crate::testing::scratch("reports/kept");
    let reports = Reports::new(&dir);
    assert_eq!(reports.list().unwrap(), []);
    reports.keep(report("a")).unwrap();
    let charted =
        Report { chart: Some(Chart { kind: ChartKind::Line, label: "DAY".to_owned(), values: vec!["SALES".to_owned()] }), ..report("b") };
    reports.keep(charted.clone()).unwrap();
    let renamed = Report { name: "again".to_owned(), ..report("a") };
    assert_eq!(reports.keep(renamed.clone()).unwrap(), [renamed.clone(), charted.clone()]);
    assert_eq!(Reports::new(&dir).list().unwrap(), [renamed, charted.clone()]);
    assert_eq!(reports.forget("a").unwrap(), [charted]);
}

/// [DESIGN] D52: a report out of its bounds is refused: no name, no
/// query, a built-in's identifier, or a chart of no columns or too many.
#[test]
fn a_report_out_of_its_bounds_is_refused() {
    let reports = Reports::new(&crate::testing::scratch("reports/bounds"));
    let chart = |values: usize| Chart { kind: ChartKind::Bar, label: "L".to_owned(), values: vec!["V".to_owned(); values] };
    for bad in [
        Report { name: String::new(), ..report("a") },
        Report { sql: " ".to_owned(), ..report("a") },
        Report { id: "built-in:files".to_owned(), ..report("a") },
        Report { chart: Some(chart(0)), ..report("a") },
        Report { chart: Some(chart(MAX_CHART_VALUES + 1)), ..report("a") },
        Report { chart: Some(Chart { label: "a\nb".to_owned(), ..chart(1) }), ..report("a") },
    ] {
        assert!(reports.keep(bad).is_err());
    }
    assert!(reports.keep(Report { chart: Some(chart(MAX_CHART_VALUES)), ..report("a") }).is_ok());
}

/// [RULE] R-FMT-2 [STUDIO reports.json]: the manual's example is a file
/// Studio reads.
#[test]
fn the_manuals_reports_file_is_read() {
    let dir = crate::testing::scratch("reports/manual");
    std::fs::write(dir.join(REPORTS_FILE), crate::testing::manual_json("appendix/d-files.md", "reports.json")).unwrap();
    let read = Reports::new(&dir).list().unwrap();
    assert_eq!(read.len(), 1);
    assert_eq!(read[0].chart.as_ref().map(|c| c.kind), Some(ChartKind::Bar));
}

/// [DESIGN] D52: the built-in reports are named apart, and none is kept.
#[test]
fn the_built_in_reports_are_named_apart() {
    let built = built_in_reports();
    let mut ids: Vec<&str> = built.iter().map(|r| r.id.as_str()).collect();
    ids.dedup();
    assert_eq!(ids.len(), built.len());
    assert!(built.iter().all(|r| r.id.starts_with("built-in:") && r.validate().is_err()));
}
