//! Administration's statements, written of what the window asks.

use super::{Act, Password, Privilege, SettingValue, View};

/// The statement of `act`.
fn sql(act: &Act) -> String {
    act.statement().unwrap().expose().to_owned()
}

/// [DESIGN] D57: each act is written as Turborel's statement of it
/// ([DOC sql/statements/grant.md SYNOPSIS]), its names as written and its
/// values as literals.
#[test]
fn each_act_is_written() {
    let value = |v: &str, integer: bool| SettingValue::Value { value: v.into(), integer };
    let cases = [
        (Act::EndConnection { id: 7 }, "END CONNECTION 7"),
        (Act::CancelConnection { id: 8 }, "CANCEL CONNECTION 8"),
        (Act::SetSession { name: "STATEMENT.TIMEOUT_MS".into(), value: value("5000", true) }, "SET STATEMENT.TIMEOUT_MS = 5000"),
        (Act::SetSession { name: "locks.wait".into(), value: SettingValue::Default }, "SET locks.wait = DEFAULT"),
        (Act::SetDatabase { name: "LOCKS.WAIT".into(), value: value("it's", false) }, "SET DATABASE LOCKS.WAIT = 'it''s'"),
        (Act::CreateUser { name: "bob".into(), password: Password("pa'ss".into()) }, "CREATE USER bob PASSWORD 'pa''ss'"),
        (Act::ChangePassword { name: "\"Bob\"".into(), password: Password("x".into()) }, "ALTER USER \"Bob\" PASSWORD 'x'"),
        (Act::AllowCreateRole { name: "BOB".into(), allowed: false }, "ALTER USER BOB NO CREATE ROLE"),
        (Act::AllowCreateRole { name: "BOB".into(), allowed: true }, "ALTER USER BOB CREATE ROLE"),
        (Act::DropUser { name: "BOB".into() }, "DROP USER BOB"),
        (Act::CreateRole { name: "AUDITORS".into() }, "CREATE ROLE AUDITORS"),
        (Act::DropRole { name: "AUDITORS".into(), cascade: true }, "DROP ROLE AUDITORS CASCADE"),
        (Act::GrantRole { role: "AUDITORS".into(), grantee: "public".into(), admin: true }, "GRANT AUDITORS TO PUBLIC WITH ADMIN OPTION"),
        (Act::RevokeRole { role: "AUDITORS".into(), grantee: "BOB".into(), cascade: false }, "REVOKE AUDITORS FROM BOB RESTRICT"),
        (
            Act::GrantPrivileges {
                privileges: vec![Privilege::Select, Privilege::Update],
                table: "ANN.STAFF".into(),
                grantee: "BOB".into(),
                grant_option: true,
            },
            "GRANT SELECT, UPDATE ON TABLE ANN.STAFF TO BOB WITH GRANT OPTION",
        ),
        (
            Act::RevokePrivileges {
                privileges: vec![Privilege::Insert, Privilege::Delete, Privilege::References, Privilege::Trigger],
                table: "STAFF".into(),
                grantee: "BOB".into(),
                cascade: true,
            },
            "REVOKE INSERT, DELETE, REFERENCES, TRIGGER ON TABLE STAFF FROM BOB CASCADE",
        ),
    ];
    for (act, written) in cases {
        assert_eq!(sql(&act), written);
    }
}

/// [DESIGN] D57: a name that is no identifier, a value not of its kind, a
/// password out of its bounds, and no privilege are refused.
#[test]
fn what_does_not_fit_is_refused() {
    let refused = [
        Act::DropUser { name: "BOB; DROP TABLE T".into() },
        Act::DropUser { name: String::new() },
        Act::DropUser { name: "A.B".into() },
        Act::DropUser { name: "'BOB'".into() },
        Act::CreateRole { name: "A..B".into() },
        Act::GrantPrivileges { privileges: vec![Privilege::Select], table: "A.B.C.D".into(), grantee: "BOB".into(), grant_option: false },
        Act::GrantPrivileges { privileges: vec![], table: "T".into(), grantee: "BOB".into(), grant_option: false },
        Act::GrantRole { role: "R".into(), grantee: "BOB, EVE".into(), admin: false },
        Act::SetSession { name: "X.".into(), value: SettingValue::Default },
        Act::SetSession { name: "X".into(), value: SettingValue::Value { value: "1; DROP".into(), integer: true } },
        Act::SetSession { name: "X".into(), value: SettingValue::Value { value: "-".into(), integer: true } },
        Act::SetSession { name: "X".into(), value: SettingValue::Value { value: "a\nb".into(), integer: false } },
        Act::CreateUser { name: "BOB".into(), password: Password(String::new()) },
        Act::CreateUser { name: "BOB".into(), password: Password("a\u{0}".into()) },
    ];
    for act in refused {
        assert!(act.statement().is_err(), "{act:?}");
    }
    let made = Act::CreateUser { name: "BOB".into(), password: Password("hidden".into()) };
    assert!(!format!("{made:?}").contains("hidden"));
    assert_eq!(sql(&Act::SetSession { name: "X".into(), value: SettingValue::Value { value: "-5".into(), integer: true } }), "SET X = -5");
}

/// [DOC sql/07-information-schema.md This implementation's own views *(extension)*]:
/// each view's columns are those its query reads.
#[test]
fn each_view_names_its_columns() {
    assert_eq!(View::Connections.columns(), ["ID", "USER_NAME", "PEER", "SECURE", "STATE", "APPLICATION"]);
    assert_eq!(View::Settings.columns().len(), 10);
    for view in [
        View::ConnectionAttributes,
        View::Server,
        View::Jobs,
        View::Files,
        View::FileFormats,
        View::MemoryReservations,
        View::Backups,
        View::ArchivedSegments,
        View::RestorePoints,
        View::Replicas,
        View::Extensions,
    ] {
        assert!(view.query().starts_with("SELECT ") && !view.columns().is_empty(), "{view:?}");
    }
}
