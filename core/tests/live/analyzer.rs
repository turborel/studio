//! The live tests of the analyzer, its what-if index and the reports
//! (RULES.md D50, D51, D52).

use turborel_studio_core::analyzer::{FOREIGN_KEY_UNINDEXED, INDEX_DUPLICATE, INDEX_LEADS_ANOTHER, TABLE_NO_PRIMARY_KEY};
use turborel_studio_core::catalog::Catalog;
use turborel_studio_core::connections::outcome::Outcome;
use turborel_studio_core::reports::built_in_reports;

use crate::{Live, run};

/// [DESIGN] D50 [DOC sql/statements/create-index.md SYNOPSIS]: a
/// schema's analysis finds a foreign key no index leads, an index of
/// another's columns, one leading another's, and a table of no primary
/// key; their fixes run, and the analysis then finds none of them.
pub fn a_schemas_analysis_finds_what_its_rules_say(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    for sql in [
        "CREATE TABLE ANN.AN_DEPT (ID INTEGER PRIMARY KEY, TITLE VARCHAR(20))",
        "CREATE TABLE ANN.AN_STAFF (ID INTEGER NOT NULL, NAME VARCHAR(20), AGE INTEGER, \
         DEPT INTEGER CONSTRAINT AN_STAFF_DEPT REFERENCES ANN.AN_DEPT, CONSTRAINT AN_STAFF_ID UNIQUE (ID))",
        "CREATE INDEX AN_STAFF_NAME ON ANN.AN_STAFF (NAME)",
        "CREATE INDEX AN_STAFF_NAME_AGAIN ON ANN.AN_STAFF (NAME)",
        "CREATE INDEX AN_STAFF_NAME_AGE ON ANN.AN_STAFF (NAME, AGE)",
    ] {
        run(&manager, id, sql).unwrap_or_else(|e| panic!("{sql}: {}", e.message));
    }
    let ours = |rule: &str| rule != "SETTING-ADVISED";
    let analysis = Catalog::of(&manager, id).analysis("ANN").unwrap();
    let found: Vec<(&str, &str, &str)> = analysis
        .findings
        .iter()
        .filter(|f| ours(f.rule) && f.object.contains("AN_"))
        .map(|f| (f.rule, f.object.as_str(), f.fix.as_str()))
        .collect();
    assert_eq!(
        found,
        [
            (FOREIGN_KEY_UNINDEXED, "ANN.AN_STAFF AN_STAFF_DEPT", "CREATE INDEX AN_STAFF_DEPT_INDEX ON ANN.AN_STAFF (DEPT);"),
            (INDEX_DUPLICATE, "AN_STAFF_NAME_AGAIN", "DROP INDEX AN_STAFF_NAME_AGAIN;"),
            (INDEX_LEADS_ANOTHER, "AN_STAFF_NAME", "DROP INDEX AN_STAFF_NAME;"),
            (
                TABLE_NO_PRIMARY_KEY,
                "ANN.AN_STAFF",
                "ALTER TABLE ANN.AN_STAFF DROP CONSTRAINT AN_STAFF_ID RESTRICT;\nALTER TABLE ANN.AN_STAFF ADD CONSTRAINT AN_STAFF_ID PRIMARY KEY (ID);"
            ),
        ]
    );
    let served = analysis.indexes.iter().find(|r| r.table == "AN_DEPT").and_then(|r| r.serves.as_deref());
    assert!(served.is_some_and(|s| !s.is_empty()));
    assert!(analysis.settings.iter().all(|s| s.value != s.default));
    for sql in found.iter().flat_map(|(_, _, fix)| fix.split(";\n")) {
        run(&manager, id, sql.trim_end_matches(';')).unwrap_or_else(|e| panic!("{sql}: {}", e.message));
    }
    let again = Catalog::of(&manager, id).analysis("ANN").unwrap();
    assert!(again.findings.iter().all(|f| !ours(f.rule) || !f.object.contains("AN_")), "{:?}", again.findings);
    for sql in ["DROP TABLE ANN.AN_STAFF CASCADE", "DROP TABLE ANN.AN_DEPT CASCADE"] {
        run(&manager, id, sql).unwrap();
    }
    manager.close(id).unwrap();
}

/// The physical stage of `explained`'s plan, its lines joined.
fn physical(
    manager: &turborel_studio_core::connections::manager::ConnectionManager,
    id: turborel_studio_core::events::ConnectionId,
    explained: &str,
) -> String {
    let Outcome::Rows { page, .. } = run(manager, id, &format!("EXPLAIN {explained}")).unwrap().outcome else { panic!("no plan") };
    let lines: Vec<String> = page.rows.iter().filter_map(|r| r.first().cloned().flatten()).collect();
    lines.split(|l| l.trim_start().starts_with("-- physical:")).nth(1).map(|p| p.join("\n")).unwrap_or_default()
}

/// [DESIGN] D51 [DOC sql/statements/explain.md EXAMPLES]: a what-if index
/// is made, the statement explained, and the index dropped: the plan
/// scans the table before, reads the index while it stands, and the
/// table has no index after. Not under autocommit, the transaction the
/// EXPLAIN began is rolled back before DROP INDEX, which runs outside one.
pub fn a_what_if_index_changes_the_plan(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    for sql in [
        "CREATE TABLE ANN.WI_PARTS (ID INTEGER PRIMARY KEY, NAME VARCHAR(20))",
        "INSERT INTO ANN.WI_PARTS WITH RECURSIVE N (I) AS (VALUES (CAST(1 AS INTEGER)) UNION ALL SELECT I + 1 FROM N WHERE I < 1000) \
         SELECT I, 'part ' || CAST(I AS VARCHAR(4)) FROM N",
    ] {
        run(&manager, id, sql).unwrap_or_else(|e| panic!("{sql}: {}", e.message));
    }
    manager.set_autocommit(id, false).unwrap();
    let query = "SELECT ID FROM ANN.WI_PARTS WHERE NAME = 'part 7'";
    let before = physical(&manager, id, query);
    assert!(before.contains("SeqScan ANN.WI_PARTS"), "{before}");
    run(&manager, id, "ROLLBACK").unwrap();
    run(&manager, id, "CREATE INDEX WI_PARTS_NAME ON ANN.WI_PARTS (NAME)").unwrap();
    let during = physical(&manager, id, query);
    assert!(during.contains("IndexScan ANN.WI_PARTS using WI_PARTS_NAME [btree]"), "{during}");
    run(&manager, id, "ROLLBACK").unwrap();
    run(&manager, id, "DROP INDEX WI_PARTS_NAME").unwrap();
    let table = Catalog::of(&manager, id).table("ANN", "WI_PARTS").unwrap();
    assert!(table.indexes.iter().all(|i| i.implied), "{:?}", table.indexes);
    run(&manager, id, "ROLLBACK").unwrap();
    manager.set_autocommit(id, true).unwrap();
    run(&manager, id, "DROP TABLE ANN.WI_PARTS CASCADE").unwrap();
    manager.close(id).unwrap();
}

/// [DESIGN] D52: each built-in report's query runs, and gives the
/// columns its chart draws.
pub fn the_built_in_reports_run(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    for report in built_in_reports() {
        let ran = run(&manager, id, &report.sql).unwrap_or_else(|e| panic!("{}: {}", report.name, e.message));
        let Outcome::Rows { columns, .. } = ran.outcome else { panic!("{} gave no rows", report.name) };
        let names: Vec<&str> = columns.iter().filter_map(|c| c.name.as_deref()).collect();
        if let Some(chart) = &report.chart {
            assert!(names.contains(&chart.label.as_str()), "{}: {names:?}", report.name);
            assert!(chart.values.iter().all(|v| names.contains(&v.as_str())), "{}: {names:?}", report.name);
        }
    }
    manager.close(id).unwrap();
}
