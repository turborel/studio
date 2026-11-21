//! Live Sessions' service: two Studios in one process, one hosting and one
//! joining, directly and through a relay.

use std::sync::Arc;
use std::time::Duration;

use turborel_studio_live::guest::GuestEvent;
use turborel_studio_live::host::HostEvent;
use turborel_studio_live::wire::Role;

use super::{LiveService, found_addresses};
use crate::connections::manager::ConnectionManager;
use crate::events::{Event, KeptEvents};
use crate::live::settings::{Connectivity, LiveSettings, SessionChoices};
use crate::live::share::{TabIn, TabKind, WorkspaceIn};

/// A Studio of `name`, its settings `settings`, and its events.
fn studio(name: &str, settings: &LiveSettings) -> (LiveService, Arc<KeptEvents>) {
    let dir = crate::testing::scratch(&format!("live/service-{name}"));
    let events = Arc::new(KeptEvents::default());
    let manager = Arc::new(ConnectionManager::new(dir.join("spool"), events.clone()));
    let secrets: Arc<dyn crate::secrets::SecretStore> = Arc::new(crate::secrets::MemorySecrets::default());
    let service = LiveService::new(&dir, (manager, secrets), events.clone()).unwrap();
    service.settings.keep(&LiveSettings { name: name.into(), ..settings.clone() }).unwrap();
    (service, events)
}

/// Settings of the loopback address alone.
fn loopback() -> LiveSettings {
    LiveSettings {
        connectivity: Connectivity { advertise: vec!["127.0.0.1".into()], ..Connectivity::default() },
        ..LiveSettings::default()
    }
}

/// The first event `find` takes of `events`, kept in `seen`, waiting up to five seconds.
fn wait<R>(events: &KeptEvents, seen: &mut Vec<Event>, find: impl Fn(&Event) -> Option<R>) -> R {
    for _ in 0..500 {
        seen.extend(events.take());
        if let Some(found) = seen.iter().find_map(&find) {
            return found;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("the event never came: {seen:?}");
}

/// A workspace of one worksheet of no connection, of `text`.
fn workspace(text: &str) -> WorkspaceIn {
    let tab = TabIn {
        id: "w1".into(),
        kind: TabKind::Worksheet,
        title: "Sheet".into(),
        connection: None,
        text: text.into(),
        selection: None,
        results: None,
        messages: vec![],
        plan: vec![],
        document: None,
    };
    WorkspaceIn { tabs: vec![tab], active: Some("w1".into()), pointer: None }
}

/// Admits the guest asking at `host`, as the guest's code shows: the guest's number.
fn admit(host: &LiveService, host_events: &KeptEvents, guest_events: &KeptEvents) -> u64 {
    let (mut at_host, mut at_guest) = (Vec::new(), Vec::new());
    let (id, code) = wait(host_events, &mut at_host, |e| match e {
        Event::LiveHost { event: HostEvent::Asked { id, code, .. } } => Some((*id, code.clone())),
        _ => None,
    });
    let shown = wait(guest_events, &mut at_guest, |e| match e {
        Event::LiveGuest { event: GuestEvent::Waiting { code } } => Some(code.clone()),
        _ => None,
    });
    assert_eq!(shown, code);
    host.answer(id, true).unwrap();
    wait(guest_events, &mut at_guest, |e| matches!(e, Event::LiveGuest { event: GuestEvent::Admitted { .. } }).then_some(()));
    id
}

/// Asserts `service` logged each of `whats`.
fn logged(service: &LiveService, whats: &[&str]) {
    let logged: Vec<String> = service.audit.entries().unwrap().into_iter().map(|e| e.what).collect();
    for what in whats {
        assert!(logged.iter().any(|w| w == what), "{what} of {logged:?}");
    }
}

/// [DESIGN] D56: a Studio hosts, another joins by its invitation and is
/// admitted, is shown the workspace filtered, suggests once granted,
/// presents once handed the role, and is removed; each step is logged.
#[test]
fn two_studios_share_a_session() {
    let (host, host_events) = studio("Ann", &loopback());
    let (guest, guest_events) = studio("Bob", &loopback());
    assert!(host.invite().is_err() && host.end().is_err() && guest.leave().is_err() && guest.hand(true).is_err());
    let hosted = host.present().unwrap().hosted.unwrap();
    assert_eq!(hosted.direct.len(), 1);
    assert!(host.present().is_err());
    let invite = host.invite().unwrap();
    let joined = guest.join(&invite.code).unwrap().joined.unwrap();
    assert!(guest.join(&invite.code).is_err() && guest.present().is_err());
    let id = admit(&host, &host_events, &guest_events);
    assert_eq!(joined.code.len(), 7);
    host.publish(workspace("SELECT 'shown' FROM T")).unwrap();
    let mut seen = Vec::new();
    wait(&guest_events, &mut seen, |e| {
        matches!(e, Event::LiveGuest { event: GuestEvent::State { state, .. } } if state.to_string().contains("shown")).then_some(())
    });
    assert!(guest.suggest("w1", "SELECT 1").unwrap_err().message.contains("not let you"));
    host.grant_suggest(id, true).unwrap();
    wait(&guest_events, &mut seen, |e| {
        matches!(e, Event::LiveGuest { event: GuestEvent::Role { grants, .. } } if grants.suggest).then_some(())
    });
    guest.suggest("w1", "SELECT 2").unwrap();
    let mut at_host = Vec::new();
    let sql = wait(&host_events, &mut at_host, |e| match e {
        Event::LiveHost { event: HostEvent::Suggested { sql, .. } } => Some(sql.clone()),
        _ => None,
    });
    assert_eq!(sql, "SELECT 2");
    assert!(guest.publish(workspace("x")).is_err());
    host.hand_over(Some(id)).unwrap();
    wait(&guest_events, &mut seen, |e| {
        matches!(e, Event::LiveGuest { event: GuestEvent::Role { role: Role::Presenter, .. } }).then_some(())
    });
    guest.publish(workspace("SELECT 'from Bob'")).unwrap();
    wait(&host_events, &mut at_host, |e| {
        matches!(e, Event::LiveHost { event: HostEvent::State { presenter, .. } } if presenter == "Bob").then_some(())
    });
    host.hand_over(None).unwrap();
    guest.hand(true).unwrap();
    wait(&host_events, &mut at_host, |e| matches!(e, Event::LiveHost { event: HostEvent::Hand { up: true, .. } }).then_some(()));
    assert_eq!(host.status().unwrap().hosted.unwrap().participants.len(), 1);
    host.remove(id).unwrap();
    wait(&guest_events, &mut seen, |e| matches!(e, Event::LiveGuest { event: GuestEvent::Removed }).then_some(()));
    assert_eq!(guest.status().unwrap().joined, None);
    host.end().unwrap();
    logged(&host, &["started", "invited", "asked", "admitted", "granted suggest", "suggested", "presenter", "removed", "ended"]);
    logged(&guest, &["joined", "removed"]);
}

/// [DESIGN] D56: sessions off, or of no name, are refused; Suggest the
/// settings do not allow is not granted; locked settings are not widened;
/// a viewer that leaves is told the host; the session's end is told.
#[test]
fn the_settings_hold_a_session() {
    let (off, _) = studio("Cy", &LiveSettings { enabled: false, ..loopback() });
    assert!(off.present().unwrap_err().message.contains("off"));
    let (nameless, _) = studio("Dee", &loopback());
    nameless.settings.keep(&loopback()).unwrap();
    assert!(nameless.join("turborel-live:x").unwrap_err().message.contains("name"));
    let strict = LiveSettings { allow_suggest: false, locked: true, ..loopback() };
    let (host, host_events) = studio("Eve", &strict);
    let (guest, guest_events) = studio("Fay", &loopback());
    host.present().unwrap();
    assert!(guest.join("not a code").is_err());
    guest.join(&host.invite().unwrap().code).unwrap();
    let id = admit(&host, &host_events, &guest_events);
    assert!(host.grant_suggest(id, true).is_err());
    let wider = SessionChoices { copy: true, ..SessionChoices::of(&strict) };
    assert!(host.choose(wider).unwrap_err().message.contains("locked"));
    assert!(host.choose(SessionChoices { row_limit: 0, ..wider }).is_err());
    host.choose(SessionChoices { row_limit: 5, ..SessionChoices::of(&strict) }).unwrap();
    guest.leave().unwrap();
    let mut at_host = Vec::new();
    wait(&host_events, &mut at_host, |e| matches!(e, Event::LiveHost { event: HostEvent::Left { .. } }).then_some(()));
    guest.join(&host.invite().unwrap().code).unwrap();
    admit(&host, &host_events, &guest_events);
    drop(host);
    let mut seen = Vec::new();
    wait(&guest_events, &mut seen, |e| matches!(e, Event::LiveGuest { event: GuestEvent::Ended }).then_some(()));
    assert_eq!(guest.status().unwrap().joined, None);
    assert_eq!(found_addresses().len(), 1);
}

/// [DESIGN] D56: two Studios meet through a relay, which passes what it
/// cannot read.
#[test]
fn two_studios_meet_through_a_relay() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let relay = turborel_studio_live::relay::Relay::new(turborel_studio_live::relay::Limits::default(), true);
    let identity = turborel_studio_live::cert::Identity::new().unwrap();
    let endpoint = runtime.block_on(async { relay.listen(&identity, "127.0.0.1:0".parse().unwrap()) }).unwrap();
    let relayed = Connectivity {
        direct: false,
        relay: true,
        relay_address: endpoint.local_addr().unwrap().to_string(),
        relay_fingerprint: identity.fingerprint.to_string(),
        ..Connectivity::default()
    };
    let settings = LiveSettings { connectivity: relayed, ..LiveSettings::default() };
    let (host, host_events) = studio("Gus", &settings);
    let (guest, guest_events) = studio("Hal", &settings);
    let hosted = host.present().unwrap().hosted.unwrap();
    assert!(hosted.direct.is_empty() && hosted.relay.is_some());
    guest.join(&host.invite().unwrap().code).unwrap();
    admit(&host, &host_events, &guest_events);
    host.publish(workspace("SELECT 'QZX-marker'")).unwrap();
    let mut seen = Vec::new();
    wait(&guest_events, &mut seen, |e| {
        matches!(e, Event::LiveGuest { event: GuestEvent::State { state, .. } } if state.to_string().contains("QZX-marker")).then_some(())
    });
    assert!(!relay.passed().windows(10).any(|w| w == b"QZX-marker"));
    host.end().unwrap();
}

/// [DESIGN] D67: a session recorded keeps exactly what was shared, its
/// masks and row limit applied, a guest's suggestion and coming in turn,
/// on the presenter's machine; its guest keeps nothing; recording chosen
/// off ends the record, and settings locked with recording not allowed
/// refuse it.
#[test]
fn a_recorded_session_keeps_only_what_was_shared() {
    use crate::live::record::{Entry, list, read};
    use crate::live::settings::Records;
    use crate::live::share::{Column, Results};
    let settings = LiveSettings {
        masked_columns: vec!["SALARY".into()],
        row_limit: 1,
        records: Records { by_default: true, ..Records::default() },
        ..loopback()
    };
    let (host, host_events) = studio("Ivy", &settings);
    let (guest, guest_events) = studio("Jo", &loopback());
    let hosted = host.present().unwrap().hosted.unwrap();
    let path = hosted.record.clone().unwrap();
    let invite = host.invite().unwrap();
    guest.join(&invite.link).unwrap();
    let id = admit(&host, &host_events, &guest_events);
    let mut shared = workspace("SELECT NAME, SALARY FROM STAFF");
    let column = |name: &str| Column { name: Some(name.into()), type_name: "VARCHAR(9)".into(), masked: false };
    let rows = vec![vec![Some("Ada".into()), Some("100".into())], vec![Some("Bo".into()), Some("200".into())]];
    shared.tabs[0].results = Some(Results { columns: vec![column("NAME"), column("SALARY")], rows, cut: false });
    host.publish(shared).unwrap();
    host.grant_suggest(id, true).unwrap();
    let mut seen = Vec::new();
    wait(&guest_events, &mut seen, |e| {
        matches!(e, Event::LiveGuest { event: GuestEvent::Role { grants, .. } } if grants.suggest).then_some(())
    });
    guest.suggest("w1", "SELECT 1").unwrap();
    let mut at_host = Vec::new();
    wait(&host_events, &mut at_host, |e| matches!(e, Event::LiveHost { event: HostEvent::Suggested { .. } }).then_some(()));
    host.choose(SessionChoices { record: false, ..hosted.choices }).unwrap();
    assert_eq!(host.status().unwrap().hosted.unwrap().record, None);
    let kept = read(std::path::Path::new(&path), None).unwrap();
    let state = kept.entries.iter().find_map(|e| if let Entry::Shared { state, .. } = e { Some(state.clone()) } else { None }).unwrap();
    let results = &state["tabs"][0]["results"];
    assert_eq!(results["rows"], serde_json::json!([["Ada", null]]));
    assert_eq!((results["cut"].as_bool(), results["columns"][1]["masked"].as_bool()), (Some(true), Some(true)));
    assert!(kept.entries.iter().any(|e| matches!(e, Entry::Joined { by, .. } if by == "Jo")));
    assert!(kept.entries.iter().any(|e| matches!(e, Entry::Suggested { by, sql, .. } if by == "Jo" && sql == "SELECT 1")));
    assert!(matches!(kept.entries.last(), Some(Entry::Ended { .. })));
    let guest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../target/test-scratch/live/service-Jo")
        .join(crate::live::record::RECORDS_DIR);
    assert_eq!(list(&guest_dir).unwrap(), []);
    guest.leave().unwrap();
    host.end().unwrap();
    let locked = LiveSettings { locked: true, records: Records { allowed: false, by_default: false, sealed: false }, ..loopback() };
    let (refusing, _) = studio("Kai", &locked);
    let choices = refusing.present().unwrap().hosted.unwrap().choices;
    assert!(refusing.choose(SessionChoices { record: true, ..choices }).unwrap_err().message.contains("locked"));
    refusing.end().unwrap();
}

/// [DESIGN] D67: a record sealed is listed and read back through the
/// keychain's key; a file not among this Studio's records is not read.
#[test]
fn a_sealed_record_is_listed_and_read_back() {
    use crate::live::settings::Records;
    let settings = LiveSettings { records: Records { allowed: true, by_default: true, sealed: true }, ..loopback() };
    let (host, _) = studio("Lou", &settings);
    host.present().unwrap();
    host.publish(workspace("SELECT 'kept'")).unwrap();
    host.end().unwrap();
    let records = host.records().unwrap();
    assert_eq!(records.len(), 1);
    assert!(records[0].head.sealed);
    let read = host.record(std::path::Path::new(&records[0].path)).unwrap();
    assert!(read.entries.iter().any(|e| serde_json::to_string(e).unwrap().contains("kept")));
    let elsewhere = std::env::temp_dir().join("studio-not-a-record.jsonl");
    std::fs::write(&elsewhere, "{}").unwrap();
    assert!(host.record(&elsewhere).unwrap_err().message.contains("only a record this Studio kept"));
    assert!(host.record(std::path::Path::new("/no/such/record.jsonl")).is_err());
}
