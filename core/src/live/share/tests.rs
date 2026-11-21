//! What a presenter shares, filtered.

use serde_json::json;

use super::{Column, Pointer, Results, TabIn, TabKind, WorkspaceIn, read_shared, shared};
use crate::live::settings::{LiveSettings, SessionChoices};
use crate::saved::Environment;

/// A worksheet tab of `connection`, of a result of `rows` rows of ID and SALARY.
fn worksheet(id: &str, connection: Option<u64>, rows: usize) -> TabIn {
    TabIn {
        id: id.into(),
        kind: TabKind::Worksheet,
        title: format!("Sheet {id}"),
        connection,
        text: "SELECT ID, SALARY FROM STAFF".into(),
        selection: None,
        results: Some(Results {
            columns: vec![
                Column { name: Some("ID".into()), type_name: "INTEGER".into(), masked: false },
                Column { name: Some("SALARY".into()), type_name: "DECIMAL".into(), masked: false },
            ],
            rows: (0..rows).map(|i| vec![Some(i.to_string()), Some("1000".into())]).collect(),
            cut: false,
        }),
        messages: vec!["2 rows".into()],
        plan: vec!["-- physical:".into(), "SeqScan ANN.STAFF".into()],
        document: None,
    }
}

/// Connection 1 of development, 2 of production; none other open.
fn environment_of(c: u64) -> Option<Environment> {
    match c {
        1 => Some(Environment::Development),
        2 => Some(Environment::Production),
        _ => None,
    }
}

/// [DESIGN] D56: development shares its values, cut to the row limit, its
/// masked columns of none; production its SQL, columns and plan alone; a
/// tab of no connection open is judged as production's; no connection is
/// ever named in what is shared.
#[test]
fn a_workspace_is_filtered_by_environment() {
    let settings = LiveSettings { masked_columns: vec!["salary".into()], ..LiveSettings::default() };
    let choices = SessionChoices { row_limit: 3, ..SessionChoices::of(&settings) };
    let workspace = WorkspaceIn {
        tabs: vec![worksheet("a", Some(1), 5), worksheet("b", Some(2), 5), worksheet("c", Some(9), 5)],
        active: Some("b".into()),
        pointer: Some(Pointer { tab: 0, x: 0.5, y: 0.25 }),
    };
    let state = shared(workspace, (&settings, &choices), environment_of).unwrap();
    assert!(state.get("tabs").and_then(|t| t.as_array()).is_some_and(|t| t.iter().all(|tab| tab.get("connection").is_none())));
    let out = read_shared(&state).unwrap();
    let [dev, prod, unknown] = out.tabs.as_slice() else { panic!("three tabs") };
    let dev_results = dev.results.as_ref().unwrap();
    assert_eq!(dev_results.rows.len(), 3);
    assert!(dev_results.cut && dev_results.columns[1].masked && !dev_results.columns[0].masked);
    assert_eq!(dev_results.rows[2], vec![Some("2".to_owned()), None]);
    assert_eq!(dev.messages, vec!["2 rows".to_owned()]);
    for tab in [prod, unknown] {
        assert_eq!(tab.environment, Some(Environment::Production));
        assert!(!tab.values && tab.messages.is_empty());
        let results = tab.results.as_ref().unwrap();
        assert!(results.rows.is_empty() && results.cut && results.columns.len() == 2);
        assert_eq!(tab.plan.len(), 2);
        assert_eq!(tab.text, "SELECT ID, SALARY FROM STAFF");
    }
    assert_eq!((out.active.as_deref(), out.copy), (Some("b"), false));
}

/// [DESIGN] D56: an environment that shares nothing leaves its tabs out;
/// production's values are shared where the session chooses; a tab of no
/// connection, as a diagram, is shared whole; the active tab left out is none.
#[test]
fn sharing_follows_the_settings_and_choices() {
    let mut settings = LiveSettings::default();
    settings.environments.development.share = false;
    let model = TabIn { kind: TabKind::Model, results: None, document: Some(json!({"tables": []})), ..worksheet("m", None, 0) };
    let choices = SessionChoices { production_values: true, copy: true, ..SessionChoices::of(&settings) };
    let workspace =
        WorkspaceIn { tabs: vec![worksheet("a", Some(1), 2), worksheet("b", Some(2), 2), model], active: Some("a".into()), pointer: None };
    let out = read_shared(&shared(workspace, (&settings, &choices), environment_of).unwrap()).unwrap();
    assert_eq!(out.tabs.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["b", "m"]);
    assert!(out.tabs[0].values && out.tabs[0].results.as_ref().unwrap().rows.len() == 2);
    assert_eq!((out.tabs[1].environment, out.tabs[1].document.clone()), (None, Some(json!({"tables": []}))));
    assert_eq!((out.active, out.copy), (None, true));
}

/// [DESIGN] D56: a workspace out of its bounds is refused; a state not of
/// the shape shared is read as none.
#[test]
fn bounds_are_checked() {
    let settings = LiveSettings::default();
    let choices = SessionChoices::of(&settings);
    let many = WorkspaceIn { tabs: (0..33).map(|i| worksheet(&i.to_string(), None, 0)).collect(), active: None, pointer: None };
    assert!(shared(many, (&settings, &choices), environment_of).is_err());
    let away = WorkspaceIn { tabs: vec![], active: None, pointer: Some(Pointer { tab: 0, x: 2.0, y: 0.0 }) };
    assert!(shared(away, (&settings, &choices), environment_of).is_err());
    let long =
        WorkspaceIn { tabs: vec![TabIn { text: "x".repeat(2 * 1024 * 1024), ..worksheet("a", None, 0) }], active: None, pointer: None };
    assert!(shared(long, (&settings, &choices), environment_of).is_err());
    let wide = TabIn {
        results: Some(Results { columns: vec![], rows: vec![vec![Some("v".repeat(1024 * 1024))]; 9], cut: false }),
        ..worksheet("w", Some(1), 0)
    };
    let big = WorkspaceIn { tabs: vec![wide], active: None, pointer: None };
    assert!(
        shared(big, (&settings, &SessionChoices { row_limit: 10_000, ..choices }), environment_of).unwrap_err().message.contains("8 MiB")
    );
    assert_eq!(read_shared(&json!({"tabs": "no"})), None);
}
