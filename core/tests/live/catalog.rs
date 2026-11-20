//! The catalog, read from a live server's Information Schema
//! (`[DOC sql/07-information-schema.md The views]`).

use turborel_studio_core::catalog::Catalog;
use turborel_studio_core::catalog::ddl::{ScriptAs, create, create_type, script};
use turborel_studio_core::connections::manager::ConnectionManager;
use turborel_studio_core::events::ConnectionId;
use turborel_studio_core::guard::classify::classify_script;

use crate::server::OWNER;
use crate::{Live, run};

/// The objects the catalog's tests read, made by the owner in its schema.
const OBJECTS: &str = "CREATE TABLE CAT_T (ID INTEGER GENERATED ALWAYS AS IDENTITY, NAME VARCHAR(20) DEFAULT 'x' NOT NULL, \
     AMT DECIMAL(9,2), CONSTRAINT CAT_T_PK PRIMARY KEY (ID), CONSTRAINT CAT_T_AMT CHECK (AMT > 0)); \
     CREATE TABLE CAT_C (ID INTEGER, T_ID INTEGER, CONSTRAINT CAT_C_PK PRIMARY KEY (ID), \
     CONSTRAINT CAT_C_T FOREIGN KEY (T_ID) REFERENCES CAT_T (ID) ON DELETE CASCADE); \
     CREATE INDEX CAT_C_BY_T ON CAT_C (T_ID); \
     CREATE VIEW CAT_V AS SELECT ID, NAME FROM CAT_T; \
     CREATE FUNCTION CAT_F (N INTEGER) RETURNS INTEGER DETERMINISTIC CONTAINS SQL RETURN N * 2; \
     CREATE TRIGGER CAT_TR AFTER INSERT ON CAT_C FOR EACH ROW DELETE FROM CAT_T WHERE ID = 0; \
     CREATE SEQUENCE CAT_S START WITH 10; \
     CREATE DOMAIN CAT_D AS DECIMAL(9,2) DEFAULT 0 CONSTRAINT CAT_D_POS CHECK (VALUE >= 0)";

/// Runs each statement of `script` on `id`, each its own transaction, as
/// CREATE INDEX must be.
fn run_script(manager: &ConnectionManager, id: ConnectionId, script: &str) {
    manager.set_autocommit(id, true).unwrap();
    for statement in classify_script(script) {
        run(manager, id, &statement.text).unwrap();
    }
}

/// [DOC sql/07-information-schema.md The views] The explorer reads a
/// schema's objects, each of its kind, and a table whole: its columns of
/// their declared types, its keys, checks, indexes and triggers.
pub fn the_explorer_reads_a_schema(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    run_script(&manager, id, OBJECTS);
    let catalog = Catalog::of(&manager, id);
    assert!(catalog.schemas().unwrap().iter().any(|s| s.name == OWNER));
    let objects = catalog.objects(OWNER).unwrap();
    let tables: Vec<(&str, &str)> =
        objects.tables.iter().map(|t| (t.name.as_str(), t.kind.as_str())).filter(|(n, _)| n.starts_with("CAT_")).collect();
    assert_eq!(tables, [("CAT_C", "BASE TABLE"), ("CAT_T", "BASE TABLE"), ("CAT_V", "VIEW")]);
    assert!(objects.routines.iter().any(|r| r.name == "CAT_F" && r.kind == "FUNCTION"));
    assert!(objects.sequences.iter().any(|s| s.name == "CAT_S" && s.start.as_deref() == Some("10")));
    assert!(objects.domains.iter().any(|d| d.name == "CAT_D" && d.type_written == "DECIMAL(9,2)" && d.checks.len() == 1));
    let t = catalog.table(OWNER, "CAT_T").unwrap();
    let columns: Vec<(&str, &str, bool)> = t.columns.iter().map(|c| (c.name.as_str(), c.type_written.as_str(), c.nullable)).collect();
    assert_eq!(columns, [("ID", "INTEGER", false), ("NAME", "CHARACTER VARYING(20)", false), ("AMT", "DECIMAL(9,2)", true)]);
    assert_eq!(t.columns[0].identity.as_deref(), Some("ALWAYS"));
    let kinds: Vec<(&str, &str)> = t.constraints.iter().map(|c| (c.name.as_str(), c.kind.as_str())).collect();
    assert_eq!(kinds, [("CAT_T_AMT", "CHECK"), ("CAT_T_PK", "PRIMARY KEY")]);
    let c = catalog.table(OWNER, "CAT_C").unwrap();
    let key = c.constraints.iter().find(|k| k.name == "CAT_C_T").and_then(|k| k.references.clone()).unwrap();
    assert_eq!((key.table.as_str(), key.columns.as_slice(), key.on_delete.as_str()), ("CAT_T", &["ID".to_owned()][..], "CASCADE"));
    assert!(c.indexes.iter().any(|i| i.name == "CAT_C_BY_T" && !i.implied && i.columns == ["T_ID"]));
    assert!(c.indexes.iter().any(|i| i.implied));
    assert_eq!(c.triggers[0].name, "CAT_TR");
    assert_eq!(catalog.table(OWNER, "CAT_V").unwrap().view.unwrap().definition.as_deref(), Some("SELECT ID, NAME FROM CAT_T"));
    manager.close(id).unwrap();
}

/// [DOC sql/07-information-schema.md The views] A routine is read whole,
/// with its parameters and body, and the users and roles are read.
pub fn routines_and_users_are_read(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    let catalog = Catalog::of(&manager, id);
    let specific = catalog.objects(OWNER).unwrap().routines.into_iter().find(|r| r.name == "CAT_F").unwrap().specific;
    let routine = catalog.routine(OWNER, &specific).unwrap();
    assert_eq!((routine.returns.as_deref(), routine.body.as_deref(), routine.deterministic), (Some("INTEGER"), Some("RETURN N * 2"), true));
    assert_eq!(routine.parameters[0].name.as_deref(), Some("N"));
    let security = catalog.security().unwrap();
    assert!(security.users.iter().any(|u| u.name == OWNER && u.owner));
    assert_eq!(catalog.routine(OWNER, "NO_SUCH").unwrap_err().sqlstate, "TB910");
    manager.close(id).unwrap();
}

/// [DOC sql/07-information-schema.md The views] What uses a table and what
/// it uses are read from the usage views, and a search finds names and
/// definitions.
pub fn dependencies_and_search(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    let catalog = Catalog::of(&manager, id);
    let used_by = catalog.dependencies(OWNER, "CAT_T").unwrap().used_by;
    let names: Vec<(&str, &str)> = used_by.iter().map(|o| (o.kind.as_str(), o.name.as_str())).collect();
    assert!(names.contains(&("VIEW", "CAT_V")), "{names:?}");
    assert!(names.contains(&("TRIGGER", "CAT_TR")), "{names:?}");
    assert!(names.contains(&("CONSTRAINT", "CAT_C_T")), "{names:?}");
    let uses = catalog.dependencies(OWNER, "CAT_V").unwrap().uses;
    assert!(uses.iter().any(|o| o.name == "CAT_T"));
    let found = catalog.search("cat_v").unwrap();
    assert!(found.iter().any(|f| f.object.name == "CAT_V" && !f.in_definition));
    let defined = catalog.search("n * 2").unwrap();
    assert!(defined.iter().any(|f| f.in_definition && f.object.kind == "ROUTINE"), "{defined:?}");
    manager.close(id).unwrap();
}

/// [DOC sql/statements/create-table.md SYNOPSIS] [DESIGN] D33: a table
/// dropped and made again of the definition Studio writes of it is the
/// same table, and each script of its rows runs.
pub fn a_table_is_made_again_of_its_definition(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    let catalog = Catalog::of(&manager, id);
    run_script(
        &manager,
        id,
        "CREATE TABLE CAT_R (K INTEGER, \"lower\" VARCHAR(5) DEFAULT 'a', CONSTRAINT CAT_R_PK PRIMARY KEY (K)); CREATE INDEX CAT_R_L ON CAT_R (\"lower\")",
    );
    let before = catalog.table(OWNER, "CAT_R").unwrap();
    let definition = create(&before);
    run_script(&manager, id, "DROP TABLE CAT_R CASCADE");
    run_script(&manager, id, &definition);
    let after = catalog.table(OWNER, "CAT_R").unwrap();
    assert_eq!((&after.columns, &after.constraints, &after.indexes), (&before.columns, &before.constraints, &before.indexes));
    for kind in [ScriptAs::Select, ScriptAs::Alter] {
        run_script(&manager, id, &script(&before, kind));
    }
    manager.close(id).unwrap();
}

/// The blocks of SQL under `## {heading}` of the manual's page `page`, a
/// path under `doc/`, in order, up to the next heading of its level.
fn manual_sql(page: &str, heading: &str) -> Vec<String> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("doc").join(page);
    let text = std::fs::read_to_string(path).unwrap();
    let after = text.split_once(&format!("\n## {heading}\n")).unwrap().1;
    let section = after.split("\n## ").next().unwrap_or_default();
    section.split("```sql\n").skip(1).map(|block| block.split_once("```").unwrap().0.to_owned()).collect()
}

/// [STUDIO The definition] [DESIGN] D33: the manual's table, made as it
/// says, has the definition it shows.
pub fn the_manuals_definition_is_written(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    let blocks = manual_sql("user/04-explorer.md", "The definition");
    let [made, shown] = blocks.as_slice() else { panic!("the page shows {} blocks of SQL", blocks.len()) };
    run_script(&manager, id, made);
    let written = create(&Catalog::of(&manager, id).table(OWNER, "ORDERS").unwrap());
    run_script(&manager, id, "DROP TABLE ORDERS CASCADE");
    assert_eq!(written, *shown, "the definition written:\n{written}");
    manager.close(id).unwrap();
}

/// [DOC sql/23-partitioning.md The Information Schema] [DOC sql/statements/create-index.md SYNOPSIS] [DESIGN] D33:
/// a partitioned table is read with its strategy, key and partitions, each
/// partition with its table and bound, its template's indexes not its own;
/// an index with the options WITH gave it; and each is made again of the
/// definition Studio writes of it.
pub fn partitions_and_index_options_are_read(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    let catalog = Catalog::of(&manager, id);
    let made = "CREATE TABLE CAT_SALES (ID INTEGER NOT NULL, SOLD DATE NOT NULL, NOTE VARCHAR(40), PRIMARY KEY (ID, SOLD)) PARTITION BY RANGE (SOLD); \
         CREATE TABLE CAT_S2025 PARTITION OF CAT_SALES FOR VALUES FROM (DATE '2025-01-01') TO (DATE '2026-01-01'); \
         CREATE TABLE CAT_SOTHER PARTITION OF CAT_SALES DEFAULT; \
         CREATE INDEX CAT_SALES_NOTE ON CAT_SALES (NOTE) USING FULLTEXT WITH (FULLTEXT.STOP_WORDS = 'the, about')";
    run_script(&manager, id, made);
    let sales = catalog.table(OWNER, "CAT_SALES").unwrap();
    let partitioning = sales.partitioning.clone().unwrap();
    assert_eq!((partitioning.strategy.as_str(), partitioning.key.as_str()), ("RANGE", "SOLD"));
    let bounds: Vec<(&str, &str)> = partitioning.partitions.iter().map(|p| (p.name.as_str(), p.bound.as_str())).collect();
    assert_eq!(bounds, [("CAT_S2025", "FOR VALUES FROM (DATE '2025-01-01') TO (DATE '2026-01-01')"), ("CAT_SOTHER", "DEFAULT")]);
    let note = sales.indexes.iter().find(|i| i.name == "CAT_SALES_NOTE").unwrap();
    assert_eq!((note.method.as_str(), note.implied), ("fulltext", false));
    assert_eq!(note.options, [("FULLTEXT.STOP_WORDS".to_owned(), "'the, about'".to_owned())]);
    let other = catalog.table(OWNER, "CAT_SOTHER").unwrap();
    assert_eq!(other.partition_of.as_ref().map(|p| (p.name.as_str(), p.bound.as_str())), Some(("CAT_SALES", "DEFAULT")));
    assert!(other.indexes.iter().all(|i| i.implied), "{:?}", other.indexes);
    let tables = ["CAT_SALES", "CAT_S2025", "CAT_SOTHER"].map(|t| catalog.table(OWNER, t).unwrap());
    let script: String = turborel_studio_core::catalog::ddl::ordered(tables.to_vec()).iter().map(create).collect();
    run_script(&manager, id, "DROP TABLE CAT_SALES CASCADE");
    run_script(&manager, id, &script);
    let again = ["CAT_SALES", "CAT_S2025", "CAT_SOTHER"].map(|t| catalog.table(OWNER, t).unwrap());
    assert_eq!(again, tables, "the script:\n{script}");
    run_script(&manager, id, "DROP TABLE CAT_SALES CASCADE");
    manager.close(id).unwrap();
}

/// [DOC sql/07-information-schema.md The views] [DOC sql/statements/create-type.md SYNOPSIS] [DESIGN] D33:
/// a distinct type is read with its source and a structured type with its
/// attributes, and each is made again of the definition Studio writes.
pub fn types_are_read_and_made_again(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    let catalog = Catalog::of(&manager, id);
    run_script(
        &manager,
        id,
        "CREATE TYPE CAT_MONEY AS DECIMAL(10,2); CREATE TYPE CAT_ADDR AS (STREET VARCHAR(30), CITY VARCHAR(20) DEFAULT 'Rome') NOT FINAL",
    );
    let names: Vec<String> = catalog.objects(OWNER).unwrap().types.into_iter().map(|(name, _)| name).collect();
    assert!(names.contains(&"CAT_MONEY".to_owned()) && names.contains(&"CAT_ADDR".to_owned()), "{names:?}");
    let money = catalog.user_type(OWNER, "CAT_MONEY").unwrap();
    let address = catalog.user_type(OWNER, "CAT_ADDR").unwrap();
    assert_eq!((money.category.as_str(), money.is_final), ("DISTINCT", true));
    assert_eq!(address.attributes.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["STREET", "CITY"]);
    assert_eq!(address.attributes[1].default.as_deref(), Some("'Rome'"));
    let script = format!("{}{}", create_type(&money), create_type(&address));
    run_script(&manager, id, "DROP TYPE CAT_MONEY CASCADE; DROP TYPE CAT_ADDR CASCADE");
    run_script(&manager, id, &script);
    assert_eq!(
        (catalog.user_type(OWNER, "CAT_MONEY").unwrap(), catalog.user_type(OWNER, "CAT_ADDR").unwrap()),
        (money, address),
        "{script}"
    );
    run_script(&manager, id, "DROP TYPE CAT_MONEY CASCADE; DROP TYPE CAT_ADDR CASCADE");
    manager.close(id).unwrap();
}

/// [DOC sql/07-information-schema.md The views] [DESIGN] D33: privileges
/// on a column, a routine, a domain and a sequence are read with those on
/// a table, and the roles the user may grant.
pub fn privileges_and_roles_are_read(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    let catalog = Catalog::of(&manager, id);
    run_script(
        &manager,
        id,
        "CREATE TABLE CAT_P (A INTEGER, B INTEGER); CREATE FUNCTION CAT_PF (N INTEGER) RETURNS INTEGER DETERMINISTIC CONTAINS SQL RETURN N; \
         CREATE DOMAIN CAT_PD AS INTEGER; CREATE SEQUENCE CAT_PS; CREATE USER CAT_BOB PASSWORD 'x'; CREATE ROLE CAT_CLERK; \
         GRANT UPDATE (B) ON CAT_P TO CAT_BOB; GRANT EXECUTE ON FUNCTION CAT_PF TO CAT_BOB; GRANT USAGE ON DOMAIN CAT_PD TO CAT_BOB; \
         GRANT USAGE ON SEQUENCE CAT_PS TO CAT_BOB",
    );
    let table = catalog.table(OWNER, "CAT_P").unwrap();
    assert!(
        table.privileges.iter().any(|p| p.grantee == "CAT_BOB" && p.privilege == "UPDATE" && p.column.as_deref() == Some("B")),
        "{:?}",
        table.privileges
    );
    let specific = catalog.objects(OWNER).unwrap().routines.into_iter().find(|r| r.name == "CAT_PF").unwrap().specific;
    let routine = catalog.routine(OWNER, &specific).unwrap();
    assert!(routine.privileges.iter().any(|p| p.grantee == "CAT_BOB" && p.privilege == "EXECUTE"), "{:?}", routine.privileges);
    for (name, kind) in [("CAT_PD", "DOMAIN"), ("CAT_PS", "SEQUENCE")] {
        let usage = catalog.usage(OWNER, name, kind).unwrap();
        assert!(usage.iter().any(|p| p.grantee == "CAT_BOB" && p.privilege == "USAGE"), "{kind}: {usage:?}");
    }
    assert!(catalog.security().unwrap().administrable.contains(&"CAT_CLERK".to_owned()));
    run_script(
        &manager,
        id,
        "DROP TABLE CAT_P CASCADE; DROP FUNCTION CAT_PF CASCADE; DROP DOMAIN CAT_PD CASCADE; DROP SEQUENCE CAT_PS CASCADE; DROP USER CAT_BOB; DROP ROLE CAT_CLERK CASCADE",
    );
    manager.close(id).unwrap();
}
