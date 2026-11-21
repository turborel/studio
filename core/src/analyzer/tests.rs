//! The analyzer's rules, judged of tables and settings made in the test.

use super::{FOREIGN_KEY_UNINDEXED, INDEX_DUPLICATE, INDEX_LEADS_ANOTHER, SETTING_ADVISED, Setting, TABLE_NO_PRIMARY_KEY, analyze};
use crate::catalog::model::{Column, Constraint, Index, Reference, TableDetail};

/// A column of `name`, NOT NULL if `not_null`.
fn column(name: &str, not_null: bool) -> Column {
    Column {
        name: name.to_owned(),
        position: 1,
        type_written: "INTEGER".to_owned(),
        default: None,
        nullable: !not_null,
        identity: None,
        generated: None,
        domain: None,
    }
}

/// A constraint of `kind` and `columns`.
fn constraint(name: &str, kind: &str, columns: &[&str]) -> Constraint {
    Constraint {
        name: name.to_owned(),
        kind: kind.to_owned(),
        columns: columns.iter().map(|c| (*c).to_owned()).collect(),
        check: None,
        references: (kind == "FOREIGN KEY").then(|| Reference {
            schema: "ANN".to_owned(),
            table: "DEPT".to_owned(),
            columns: vec!["ID".to_owned()],
            matching: "NONE".to_owned(),
            on_update: "NO ACTION".to_owned(),
            on_delete: "NO ACTION".to_owned(),
        }),
        deferrable: false,
    }
}

/// An index of `method` and `columns`, a constraint's if `implied`.
fn index(name: &str, method: &str, columns: &[&str], implied: bool) -> Index {
    Index {
        name: name.to_owned(),
        method: method.to_owned(),
        unique: implied,
        columns: columns.iter().map(|c| (*c).to_owned()).collect(),
        implied,
        options: Vec::new(),
    }
}

/// A base table of ANN.
fn table(name: &str, columns: Vec<Column>, constraints: Vec<Constraint>, indexes: Vec<Index>) -> TableDetail {
    TableDetail {
        schema: "ANN".to_owned(),
        name: name.to_owned(),
        kind: "BASE TABLE".to_owned(),
        columns,
        constraints,
        indexes,
        triggers: Vec::new(),
        privileges: Vec::new(),
        view: None,
        partitioning: None,
        partition_of: None,
        storage: None,
    }
}

/// A setting of `value`, from `source`, of `default`.
fn setting(name: &str, value: &str, source: &str, default: &str, takes_effect: &str) -> Setting {
    Setting {
        name: name.to_owned(),
        value: value.to_owned(),
        source: source.to_owned(),
        default: default.to_owned(),
        takes_effect: takes_effect.to_owned(),
        description: String::new(),
    }
}

/// [DESIGN] D50: a foreign key no index leads is found, its fix an index
/// of its columns named for it; one a btree index leads, in any order, or
/// a hash index of its columns alone, is not.
#[test]
fn a_foreign_key_no_index_leads_is_found() {
    let staff = table(
        "STAFF",
        vec![column("ID", true), column("DEPT", false), column("BOSS", false), column("ROOM", false)],
        vec![
            constraint("STAFF_PRIMARY1", "PRIMARY KEY", &["ID"]),
            constraint("STAFF_DEPT", "FOREIGN KEY", &["DEPT"]),
            constraint("STAFF_BOSS", "FOREIGN KEY", &["BOSS", "ROOM"]),
            constraint("STAFF_ROOM", "FOREIGN KEY", &["ROOM"]),
        ],
        vec![
            index("ANN.STAFF.UNIQUE1", "btree", &["ID"], true),
            index("STAFF_ROOM_BOSS", "btree", &["ROOM", "BOSS", "ID"], false),
            index("STAFF_DEPT_INDEX", "rtree", &["DEPT"], false),
        ],
    );
    let found = analyze(&[staff], &[]).findings;
    assert_eq!(found.len(), 1);
    let f = &found[0];
    assert_eq!((f.rule, f.object.as_str()), (FOREIGN_KEY_UNINDEXED, "ANN.STAFF STAFF_DEPT"));
    assert_eq!(f.fix, "CREATE INDEX STAFF_DEPT_INDEX2 ON ANN.STAFF (DEPT);");
    assert!(f.says.contains("(DEPT)"), "{}", f.says);
    let hashed = table(
        "T",
        vec![column("A", false)],
        vec![constraint("T_PK", "PRIMARY KEY", &["A"]), constraint("T_A", "FOREIGN KEY", &["A"])],
        vec![index("T_A_HASH", "HASH", &["A"], false)],
    );
    assert!(analyze(&[hashed], &[]).findings.iter().all(|f| f.rule != FOREIGN_KEY_UNINDEXED));
}

/// [DESIGN] D50: an index of another's method, columns and options is a
/// duplicate, the one CREATE INDEX made after the other, or beside a
/// constraint's, dropped; one whose columns lead another btree index's is
/// found, and a constraint's index is never dropped.
#[test]
fn duplicate_and_leading_indexes_are_found() {
    let t = table(
        "T",
        vec![column("A", true), column("B", false), column("C", false)],
        vec![constraint("T_PRIMARY1", "PRIMARY KEY", &["A"])],
        vec![
            index("ANN.T.UNIQUE1", "btree", &["A"], true),
            index("T_A", "BTREE", &["A"], false),
            index("T_BC", "btree", &["B", "C"], false),
            index("T_BC2", "btree", &["B", "C"], false),
            index("T_B", "btree", &["B"], false),
            index("T_C", "hash", &["C"], false),
            index("T_CB", "btree", &["C", "B"], false),
            Index { options: vec![("FILL".to_owned(), "50".to_owned())], ..index("T_B2", "btree", &["B"], false) },
        ],
    );
    let found = analyze(&[t], &[]).findings;
    let rules: Vec<(&str, &str)> = found.iter().map(|f| (f.rule, f.object.as_str())).collect();
    assert_eq!(rules, [(INDEX_DUPLICATE, "T_A"), (INDEX_DUPLICATE, "T_BC2"), (INDEX_LEADS_ANOTHER, "T_B"), (INDEX_LEADS_ANOTHER, "T_B2"),]);
    assert_eq!(found[0].fix, "DROP INDEX T_A;");
    assert!(found[0].says.contains("ANN.T.UNIQUE1"), "{}", found[0].says);
    assert!(found[2].says.contains("lead those of T_BC (B, C)"), "{}", found[2].says);
}

/// [DESIGN] D50: a base table of no primary key is found, its fix a key
/// of its first UNIQUE constraint whose columns are each NOT NULL, or a
/// commented template; a view, a partition and a table with a key are not.
#[test]
fn a_table_of_no_primary_key_is_found() {
    let keyed = table(
        "K",
        vec![column("A", false), column("B", true)],
        vec![constraint("K_A", "UNIQUE", &["A"]), constraint("K_B", "UNIQUE", &["B"])],
        Vec::new(),
    );
    let bare = table("lower", vec![column("A", false)], Vec::new(), Vec::new());
    let view = TableDetail { kind: "VIEW".to_owned(), ..table("V", Vec::new(), Vec::new(), Vec::new()) };
    let versioned = TableDetail {
        kind: "SYSTEM VERSIONED".to_owned(),
        ..table("S", vec![column("A", true)], vec![constraint("S_PK", "PRIMARY KEY", &["A"])], Vec::new())
    };
    let found = analyze(&[keyed, bare, view, versioned], &[]).findings;
    let fixes: Vec<&str> = found.iter().map(|f| f.fix.as_str()).collect();
    assert_eq!(
        fixes,
        [
            "-- Name the columns that tell each row of ANN.\"lower\" from every other, each NOT NULL:\n-- ALTER TABLE ANN.\"lower\" ADD PRIMARY KEY (column);",
            "ALTER TABLE ANN.K DROP CONSTRAINT K_B RESTRICT;\nALTER TABLE ANN.K ADD CONSTRAINT K_B PRIMARY KEY (B);",
        ]
    );
    assert!(found.iter().all(|f| f.rule == TABLE_NO_PRIMARY_KEY));
}

/// [DESIGN] D50: a setting of a value the manual warns of is found, its
/// fix of the scope its value comes from; the settings that differ from
/// their defaults are listed.
#[test]
fn a_setting_the_manual_warns_of_is_found() {
    let settings = [
        setting("LOG.COMMIT_SYNC", "OFF", "SESSION", "ON", "STATEMENT"),
        setting("LOG.DURABILITY", "none", "DATABASE", "DATA", "STATEMENT"),
        setting("SERVER.SCRAM_WITHOUT_TLS", "ON", "DATABASE", "OFF", "CONNECTION"),
        setting("SERVER.TRUST_LOCAL", "ON", "NODE", "OFF", "START"),
        setting("SERVER.TLS", "ON", "DATABASE", "OFF", "START"),
        setting("LOCKS.WAIT", "ON", "DEFAULT", "ON", "TRANSACTION"),
    ];
    let analysis = analyze(&[], &settings);
    let fixes: Vec<&str> = analysis.findings.iter().map(|f| f.fix.as_str()).collect();
    assert_eq!(
        fixes,
        [
            "SET LOG.COMMIT_SYNC TO DEFAULT;",
            "SET DATABASE LOG.DURABILITY = DEFAULT;",
            "SET DATABASE SERVER.SCRAM_WITHOUT_TLS = DEFAULT;",
            "-- SERVER.TRUST_LOCAL is set by the node's operator, not by SQL: its default is OFF.",
        ]
    );
    assert!(analysis.findings.iter().all(|f| f.rule == SETTING_ADVISED));
    assert!(analysis.findings[2].says.ends_with("from the next connection."), "{}", analysis.findings[2].says);
    assert!(analysis.findings[3].says.ends_with("at the next start."), "{}", analysis.findings[3].says);
    let advised = analyze(&[], &[setting("LOCKS.WAIT", "OFF", "DATABASE", "ON", "TRANSACTION")]);
    assert_eq!(advised.findings, []);
    assert_eq!(analysis.settings.len(), 5);
}

/// [DESIGN] D50: each index of the schema is listed with its table and
/// the PRIMARY KEY or UNIQUE constraint it was made for.
#[test]
fn each_index_is_listed_with_the_constraint_it_serves() {
    let t = table(
        "T",
        vec![column("A", true), column("B", false)],
        vec![constraint("T_PRIMARY1", "PRIMARY KEY", &["A"]), constraint("T_B", "UNIQUE", &["B"])],
        vec![
            index("ANN.T.UNIQUE1", "btree", &["A"], true),
            index("ANN.T.UNIQUE2", "btree", &["B"], true),
            index("T_AB", "btree", &["A", "B"], false),
        ],
    );
    let listed: Vec<(String, Option<String>)> = analyze(&[t], &[]).indexes.into_iter().map(|r| (r.index.name, r.serves)).collect();
    assert_eq!(
        listed,
        [
            ("ANN.T.UNIQUE1".to_owned(), Some("T_PRIMARY1".to_owned())),
            ("ANN.T.UNIQUE2".to_owned(), Some("T_B".to_owned())),
            ("T_AB".to_owned(), None),
        ]
    );
}
