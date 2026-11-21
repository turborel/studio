//! Definitions written of objects made for each case.

use super::{ScriptAs, create, create_domain, create_routine, create_sequence, script};
use crate::catalog::model::{
    Column, Constraint, Domain, Index, Parameter, Partition, PartitionOf, Partitioning, Reference, RoutineDetail, Sequence, TableDetail,
    Trigger, View,
};

/// A column of `name` and `type_written`.
fn column(name: &str, type_written: &str) -> Column {
    Column {
        name: name.into(),
        position: 1,
        type_written: type_written.into(),
        default: None,
        nullable: true,
        identity: None,
        generated: None,
        domain: None,
    }
}

/// Table C's constraints: its key, a foreign key and a check.
fn constraints() -> Vec<Constraint> {
    vec![
        Constraint {
            name: "C_PRIMARY1".into(),
            kind: "PRIMARY KEY".into(),
            columns: vec!["ID".into()],
            check: None,
            references: None,
            deferrable: false,
        },
        Constraint {
            name: "C_FOREIGN1".into(),
            kind: "FOREIGN KEY".into(),
            columns: vec!["T_ID".into()],
            check: None,
            references: Some(Reference {
                schema: "ANN".into(),
                table: "T".into(),
                columns: vec!["ID".into()],
                matching: "NONE".into(),
                on_update: "NO ACTION".into(),
                on_delete: "CASCADE".into(),
            }),
            deferrable: false,
        },
        Constraint {
            name: "C_CHECK1".into(),
            kind: "CHECK".into(),
            columns: vec![],
            check: Some("T_ID > 0".into()),
            references: None,
            deferrable: true,
        },
    ]
}

/// Table C's indexes: its key's, and one of its own.
fn indexes() -> Vec<Index> {
    vec![
        Index {
            name: "ANN.C.UNIQUE1".into(),
            method: "btree".into(),
            unique: true,
            columns: vec!["ID".into()],
            implied: true,
            options: vec![],
        },
        Index { name: "C_T".into(), method: "btree".into(), unique: false, columns: vec!["T_ID".into()], implied: false, options: vec![] },
    ]
}

/// The table C of the tests: an identity key, a column of a default, a
/// foreign key, a check, an index and a trigger.
fn table() -> TableDetail {
    TableDetail {
        schema: "ANN".into(),
        name: "C".into(),
        kind: "BASE TABLE".into(),
        columns: vec![
            Column { identity: Some("ALWAYS".into()), nullable: false, ..column("ID", "INTEGER") },
            Column { default: Some("'x'".into()), nullable: false, ..column("name", "CHARACTER VARYING(20)") },
            column("T_ID", "INTEGER"),
        ],
        constraints: constraints(),
        indexes: indexes(),
        triggers: vec![Trigger {
            schema: "ANN".into(),
            name: "TR".into(),
            event: "INSERT".into(),
            timing: "AFTER".into(),
            orientation: "ROW".into(),
            condition: None,
            action: Some("DELETE FROM T WHERE ID = 0".into()),
        }],
        privileges: vec![],
        view: None,
        partitioning: None,
        partition_of: None,
        storage: None,
    }
}

/// [DOC sql/statements/create-table.md SYNOPSIS] [DESIGN] D33: a table is
/// written with its columns, its constraints, its own indexes and its
/// triggers; a constraint's index is not written, and a name not regular
/// is delimited.
#[test]
fn a_table_is_written_whole() {
    assert_eq!(
        create(&table()),
        "CREATE TABLE ANN.C (\n    ID INTEGER GENERATED ALWAYS AS IDENTITY NOT NULL,\n    \"name\" CHARACTER VARYING(20) DEFAULT 'x' NOT NULL,\n    \
         T_ID INTEGER,\n    CONSTRAINT C_PRIMARY1 PRIMARY KEY (ID),\n    CONSTRAINT C_FOREIGN1 FOREIGN KEY (T_ID) REFERENCES ANN.T (ID) ON UPDATE NO ACTION \
         ON DELETE CASCADE,\n    CONSTRAINT C_CHECK1 CHECK (T_ID > 0) DEFERRABLE\n);\nCREATE INDEX C_T ON ANN.C (T_ID);\nCREATE TRIGGER ANN.TR AFTER INSERT \
         ON ANN.C\nFOR EACH ROW\nDELETE FROM T WHERE ID = 0;\n"
    );
}

/// [DOC sql/statements/create-table.md SYNOPSIS] [DESIGN] D33: a base
/// table is written with its engine, and the options of its engine given a
/// value of their own, after its partitioning.
#[test]
fn a_tables_storage_is_written() {
    use crate::catalog::model::Storage;
    let options = vec![("COLUMNSTORE.FREEZE_DELAY".to_owned(), "60".to_owned()), ("COLUMNSTORE.ORDER".to_owned(), "'region'".to_owned())];
    let stored =
        TableDetail { storage: Some(Storage { engine: "columnstore".into(), options }), indexes: vec![], triggers: vec![], ..table() };
    assert!(create(&stored).contains("\n) USING columnstore WITH (COLUMNSTORE.FREEZE_DELAY = 60, COLUMNSTORE.ORDER = 'region');\n"));
    let plain = TableDetail { storage: Some(Storage { engine: "rowstore".into(), options: vec![] }), ..stored };
    assert!(create(&plain).contains("\n) USING rowstore;\n"));
}

/// [DESIGN] D33: a table is scripted as each statement of its rows, by its
/// primary key, an identity GENERATED ALWAYS given no value.
#[test]
fn a_table_is_scripted_as_each_statement() {
    let t = table();
    assert_eq!(script(&t, ScriptAs::Select), "SELECT ID, \"name\", T_ID\nFROM ANN.C;\n");
    assert_eq!(script(&t, ScriptAs::Insert), "INSERT INTO ANN.C (\"name\", T_ID)\nVALUES (?, ?);\n");
    assert_eq!(script(&t, ScriptAs::Update), "UPDATE ANN.C\nSET \"name\" = ?, T_ID = ?\nWHERE ID = ?;\n");
    assert_eq!(script(&t, ScriptAs::Delete), "DELETE FROM ANN.C\nWHERE ID = ?;\n");
    assert_eq!(script(&t, ScriptAs::Drop), "DROP TABLE ANN.C RESTRICT;\n");
    assert_eq!(script(&t, ScriptAs::Alter), "ALTER TABLE ANN.C ADD COLUMN NEW_COLUMN INTEGER;\n");
    assert!(script(&t, ScriptAs::Create).starts_with("CREATE TABLE ANN.C ("));
}

/// [DOC sql/statements/create-view.md SYNOPSIS] [DESIGN] D33: a view is
/// written of its query and check option, and one whose query is not shown
/// says so.
#[test]
fn a_view_is_written_or_says_why_not() {
    let view = |definition: Option<&str>, check: &str| TableDetail {
        kind: "VIEW".into(),
        constraints: vec![],
        indexes: vec![],
        triggers: vec![],
        view: Some(View { definition: definition.map(str::to_owned), check_option: check.into() }),
        ..table()
    };
    assert_eq!(create(&view(Some("SELECT ID FROM T"), "CASCADED")), "CREATE VIEW ANN.C AS\nSELECT ID FROM T\nWITH CHECK OPTION;\n");
    assert_eq!(create(&view(Some("SELECT ID FROM T"), "LOCAL")), "CREATE VIEW ANN.C AS\nSELECT ID FROM T\nWITH LOCAL CHECK OPTION;\n");
    assert!(create(&view(None, "NONE")).starts_with("-- The view ANN.C's query"));
    assert_eq!(script(&view(None, "NONE"), ScriptAs::Drop), "DROP VIEW ANN.C RESTRICT;\n");
}

/// [DOC sql/statements/create-function.md SYNOPSIS] [DESIGN] D33: a routine,
/// a sequence and a domain are written as they are defined.
#[test]
fn routines_sequences_and_domains_are_written() {
    let routine = RoutineDetail {
        schema: "ANN".into(),
        specific: "DOUBLED_1".into(),
        name: "DOUBLED".into(),
        kind: "FUNCTION".into(),
        returns: Some("INTEGER".into()),
        parameters: vec![Parameter { mode: "IN".into(), name: Some("N".into()), type_written: "INTEGER".into() }],
        body: Some("RETURN N * 2".into()),
        deterministic: true,
        data_access: "CONTAINS SQL".into(),
        privileges: vec![],
    };
    assert_eq!(
        create_routine(&routine),
        "CREATE FUNCTION ANN.DOUBLED (IN N INTEGER) RETURNS INTEGER DETERMINISTIC CONTAINS SQL\nRETURN N * 2;\n"
    );
    assert!(create_routine(&RoutineDetail { body: None, ..routine }).starts_with("-- The routine ANN.DOUBLED's body"));
    let sequence = Sequence {
        name: "S".into(),
        type_written: "BIGINT".into(),
        start: Some("10".into()),
        minimum: None,
        maximum: None,
        increment: Some("2".into()),
        cycle: false,
    };
    assert_eq!(create_sequence("ANN", &sequence), "CREATE SEQUENCE ANN.S AS BIGINT START WITH 10 INCREMENT BY 2 NO CYCLE;\n");
    let domain = Domain {
        name: "MONEY".into(),
        type_written: "DECIMAL(9,2)".into(),
        default: Some("0".into()),
        checks: vec![("POS".into(), "VALUE >= 0".into())],
    };
    assert_eq!(create_domain("ANN", &domain), "CREATE DOMAIN ANN.MONEY AS DECIMAL(9,2) DEFAULT 0 CONSTRAINT POS CHECK (VALUE >= 0);\n");
}

/// [DESIGN] D33: tables are ordered after the tables their foreign keys
/// reference, and a schema's script makes domains, sequences, tables, views
/// and routines in that order.
#[test]
fn a_schema_is_scripted_in_the_order_it_is_made() {
    let child = table();
    let parent = TableDetail { name: "T".into(), constraints: vec![], indexes: vec![], triggers: vec![], ..table() };
    let view = TableDetail {
        name: "V".into(),
        kind: "VIEW".into(),
        view: Some(View { definition: Some("SELECT 1".into()), check_option: "NONE".into() }),
        ..parent.clone()
    };
    let order = super::ordered(vec![view.clone(), child.clone(), parent.clone()]);
    assert_eq!(order.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), ["V", "T", "C"]);
    let parts = super::SchemaParts {
        types: vec![],
        domains: vec![Domain { name: "D".into(), type_written: "INTEGER".into(), default: None, checks: vec![] }],
        sequences: vec![],
        tables: order,
        routines: vec![],
    };
    let made = super::schema_script("ANN", &parts);
    let at = |text: &str| made.find(text).unwrap();
    assert!(at("CREATE DOMAIN ANN.D") < at("CREATE TABLE ANN.T"));
    assert!(at("CREATE TABLE ANN.T") < at("CREATE TABLE ANN.C"));
    assert!(at("CREATE TABLE ANN.C") < at("CREATE VIEW ANN.V"));
}

/// [DOC sql/23-partitioning.md Syntax] [DOC sql/statements/create-index.md SYNOPSIS] [DESIGN] D33:
/// a partitioned table is written with its strategy and key, a partition
/// as a partition of its table, of its bound, after it; an index with its
/// method and the options WITH gave it, and an index a template made on a
/// partition not at all.
#[test]
fn partitions_and_index_options_are_written() {
    let template = Index {
        name: "SALES_BODY".into(),
        method: "fulltext".into(),
        unique: false,
        columns: vec!["NOTE".into()],
        implied: false,
        options: vec![("FULLTEXT.STOP_WORDS".into(), "'the, about'".into())],
    };
    let sales = TableDetail {
        name: "SALES".into(),
        constraints: vec![],
        triggers: vec![],
        indexes: vec![template.clone()],
        partitioning: Some(Partitioning {
            strategy: "RANGE".into(),
            key: "SOLD".into(),
            partitions: vec![Partition { schema: "ANN".into(), name: "SOTHER".into(), bound: "DEFAULT".into(), partitioned: false }],
        }),
        ..table()
    };
    let other = TableDetail {
        name: "SOTHER".into(),
        partitioning: None,
        partition_of: Some(PartitionOf { schema: "ANN".into(), name: "SALES".into(), bound: "DEFAULT".into() }),
        indexes: vec![Index { name: "SALES_BODY\u{0}ANN\u{0}SOTHER".into(), implied: true, ..template }],
        ..sales.clone()
    };
    assert!(create(&sales).contains("\n) PARTITION BY RANGE (SOLD);\nCREATE INDEX SALES_BODY ON ANN.SALES (NOTE) USING fulltext WITH (FULLTEXT.STOP_WORDS = 'the, about');\n"));
    assert_eq!(create(&other), "CREATE TABLE ANN.SOTHER PARTITION OF ANN.SALES DEFAULT;\n");
    let order = super::ordered(vec![other, sales]);
    assert_eq!(order.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), ["SALES", "SOTHER"]);
}
