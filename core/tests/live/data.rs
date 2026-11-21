//! The live tests of data: rows imported from files (RULES.md D43).

use turborel_studio_core::connections::imports::{Format, ImportSpec, Reading};
use turborel_studio_core::connections::manager::{ImportAnswer, RunAnswer};
use turborel_studio_core::connections::outcome::Outcome;
use turborel_studio_core::guard::policy::Guards;
use turborel_studio_core::saved::Environment;

use crate::{Live, no_environment, run};

/// An import of `path` into IMPORTED as `fields` say, its batch `batch`,
/// skipping rows refused if `skip`.
fn spec(path: &std::path::Path, fields: &[Option<&str>], (batch, skip): (u64, bool)) -> ImportSpec {
    ImportSpec {
        path: path.to_owned(),
        reading: Reading { format: Format::Csv, header: true, delimiter: None, null: None },
        table: "\"ANN\".\"IMPORTED\"".to_owned(),
        fields: fields.iter().map(|f| f.map(str::to_owned)).collect(),
        batch,
        skip,
    }
}

/// The rows of IMPORTED, by ID.
fn imported(
    manager: &turborel_studio_core::connections::manager::ConnectionManager,
    id: turborel_studio_core::events::ConnectionId,
) -> Vec<Vec<Option<String>>> {
    let Outcome::Rows { page, .. } = run(manager, id, "SELECT ID, NAME FROM IMPORTED ORDER BY ID").unwrap().outcome else {
        panic!("no rows")
    };
    page.rows
}

/// [CLIENT Importing] [CLIENT Copying and exporting] [DESIGN] D43: a CSV
/// file's rows are imported, each
/// field into the column chosen, a field of none skipped; a row refused
/// ends the import, the rows committed before it kept, or, skipped, is
/// told; an import begins with no transaction active, and a production
/// connection asks first.
pub fn rows_are_imported_from_a_file(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    run(&manager, id, "CREATE TABLE IMPORTED (ID INTEGER PRIMARY KEY, NAME VARCHAR(20))").unwrap();
    let dir = live.server.dir.join("imports");
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("staff.csv");
    std::fs::write(&file, "NAME,ID,EXTRA\n\"Ada, Countess\",1,x\nGrace,2,y\n").unwrap();
    let fields = [Some("NAME"), Some("ID"), None];
    let ImportAnswer::Imported(done) = manager.import(id, spec(&file, &fields, (1000, false)), false).unwrap() else { panic!("asked") };
    assert_eq!((done.rows, done.rejected), (2, 0));
    assert_eq!(
        imported(&manager, id),
        [vec![Some("1".to_owned()), Some("Ada, Countess".to_owned())], vec![Some("2".to_owned()), Some("Grace".to_owned())]]
    );
    let again = dir.join("again.csv");
    std::fs::write(&again, "NAME,ID,EXTRA\nAlan,3,z\nDup,1,z\nEdsger,4,z\n").unwrap();
    let ImportAnswer::Imported(skipped) = manager.import(id, spec(&again, &fields, (1, true)), false).unwrap() else { panic!("asked") };
    assert_eq!((skipped.rows, skipped.rejected), (2, 1));
    assert!(skipped.skipped[0].starts_with("record 2, line 3:"), "{:?}", skipped.skipped);
    run(&manager, id, "DELETE FROM IMPORTED WHERE ID > 2").unwrap();
    let stopped = manager.import(id, spec(&again, &fields, (1, false)), false).unwrap_err();
    assert!(stopped.message.contains("1 row committed"), "{}", stopped.message);
    assert_eq!(imported(&manager, id).len(), 3);
    assert_eq!(manager.import(id, spec(&again, &[None, None], (1, false)), false).unwrap_err().sqlstate, "TB910");
    manager.set_autocommit(id, false).unwrap();
    run(&manager, id, "VALUES (1)").unwrap();
    assert!(manager.import(id, spec(&file, &fields, (1, false)), false).unwrap_err().message.contains("no transaction active"));
    run(&manager, id, "ROLLBACK").unwrap();
    manager.set_autocommit(id, true).unwrap();
    let guards = Guards { environment: Environment::Production, read_only: false };
    let production = manager.open((&live.spec(), guards), Some(&live.password()), no_environment).unwrap().connection;
    assert!(matches!(manager.import(production, spec(&file, &fields, (1, false)), false).unwrap(), ImportAnswer::Confirm(_)));
    manager.close(production).unwrap();
    let RunAnswer::Ran(_) = manager.run(id, "DROP TABLE IMPORTED CASCADE", true).unwrap() else { panic!("asked") };
    manager.close(id).unwrap();
}
