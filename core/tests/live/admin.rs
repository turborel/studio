//! The live tests of administration (RULES.md D57): the monitor's views
//! read of the server, and each act run through the guards.

use turborel_studio_core::admin::{Act, Password, Privilege, SettingValue, View, read, run};
use turborel_studio_core::connections::manager::RunAnswer;

use crate::{Live, run as run_sql};

/// [DESIGN] D57: each view is read as the database's owner; the server's
/// counters count the connections open.
pub fn the_monitors_views_are_read(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    for view in [
        View::Connections,
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
        View::Settings,
        View::Extensions,
        View::StatementStatistics,
        View::TableStatistics,
        View::IndexStatistics,
    ] {
        let rows = read(&manager, id, view).unwrap_or_else(|e| panic!("{view:?}: {}", e.message));
        assert!(rows.rows.iter().all(|r| r.len() == rows.columns.len()), "{view:?}");
    }
    let connections = read(&manager, id, View::Connections).unwrap();
    assert!(connections.rows.iter().any(|r| r[1].as_deref() == Some("ANN")), "the test's own connection is one");
    assert_eq!(read(&manager, id, View::Server).unwrap().rows.len(), 1);
    assert!(read(&manager, id, View::Replicas).unwrap().absent, "the tests' server is in no replica group");
    assert!(read(&manager, id, View::Jobs).unwrap().rows.iter().any(|r| r[0].as_deref() == Some("turborel-checkpoint")));
    let mine = connections.rows.iter().find(|r| r[4].as_deref() == Some("RUNNING")).expect("the reading connection runs");
    assert!(mine[6].as_deref().is_some_and(|t| t.contains("INFORMATION_SCHEMA.CONNECTIONS")), "{mine:?}");
    crate::run(&manager, id, "VALUES (1)").unwrap();
    let statements = read(&manager, id, View::StatementStatistics).unwrap();
    assert!(statements.rows.iter().any(|r| r[0].as_deref() == Some("VALUES (?)")), "{:?}", statements.rows);
    manager.close(id).unwrap();
}

/// Runs `act`, confirmed, on `id`.
fn act(manager: &turborel_studio_core::connections::manager::ConnectionManager, id: u64, act: &Act) {
    match run(manager, id, act, true) {
        Ok(RunAnswer::Ran(_)) => {}
        Ok(RunAnswer::Confirm(c)) => panic!("{act:?} asked to confirm: {c:?}"),
        Err(e) => panic!("{act:?}: {}", e.message),
    }
}

/// [DESIGN] D57: users, roles and privileges are made, granted, revoked
/// and dropped; settings set for the session and the database and back;
/// another connection cancelled and ended.
pub fn administration_acts_run(live: &Live) {
    let (manager, _) = live.manager();
    let id = live.owner(&manager);
    manager.set_autocommit(id, true).unwrap();
    run_sql(&manager, id, "CREATE TABLE ANN.AD_STAFF (ID INTEGER)").unwrap();
    for a in [
        Act::CreateUser { name: "AD_BOB".into(), password: Password("bob's secret".into()) },
        Act::ChangePassword { name: "AD_BOB".into(), password: Password("another".into()) },
        Act::AllowCreateRole { name: "AD_BOB".into(), allowed: true },
        // DROP USER finds no user who may create roles, on main at 7189b10.
        Act::AllowCreateRole { name: "AD_BOB".into(), allowed: false },
        Act::CreateRole { name: "AD_AUDITORS".into() },
        Act::GrantRole { role: "AD_AUDITORS".into(), grantee: "AD_BOB".into(), admin: false },
        Act::GrantPrivileges {
            privileges: vec![Privilege::Select, Privilege::Insert],
            table: "ANN.AD_STAFF".into(),
            grantee: "AD_BOB".into(),
            grant_option: false,
        },
        Act::RevokePrivileges {
            privileges: vec![Privilege::Insert],
            table: "ANN.AD_STAFF".into(),
            grantee: "AD_BOB".into(),
            cascade: false,
        },
        Act::RevokeRole { role: "AD_AUDITORS".into(), grantee: "AD_BOB".into(), cascade: false },
        Act::DropRole { name: "AD_AUDITORS".into(), cascade: false },
        Act::RevokePrivileges {
            privileges: vec![Privilege::Select],
            table: "ANN.AD_STAFF".into(),
            grantee: "AD_BOB".into(),
            cascade: false,
        },
        Act::DropUser { name: "AD_BOB".into() },
        Act::SetSession { name: "STATEMENT.TIMEOUT_MS".into(), value: SettingValue::Value { value: "5000".into(), integer: true } },
        Act::SetSession { name: "STATEMENT.TIMEOUT_MS".into(), value: SettingValue::Default },
        Act::SetDatabase { name: "LOCKS.WAIT".into(), value: SettingValue::Value { value: "OFF".into(), integer: false } },
        Act::SetDatabase { name: "LOCKS.WAIT".into(), value: SettingValue::Default },
    ] {
        act(&manager, id, &a);
    }
    let settings = read(&manager, id, View::Settings).unwrap();
    let timeout = settings.rows.iter().find(|r| r[0].as_deref() == Some("STATEMENT.TIMEOUT_MS")).unwrap();
    assert_eq!(timeout[2].as_deref(), Some("DEFAULT"));
    let other = live.owner(&manager);
    let ids: Vec<u64> = read(&manager, id, View::Connections).unwrap().rows.iter().filter_map(|r| r[0].as_deref()?.parse().ok()).collect();
    let target = *ids.iter().max().unwrap();
    act(&manager, id, &Act::CancelConnection { id: target });
    act(&manager, id, &Act::EndConnection { id: target });
    let _ = manager.close(other); // Ended already, as the server closed it.
    run_sql(&manager, id, "DROP TABLE ANN.AD_STAFF CASCADE").unwrap();
    manager.close(id).unwrap();
}
