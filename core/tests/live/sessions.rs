//! The live tests of Live Sessions (RULES.md D56): two Studios and a
//! relay in this process, sharing a worksheet of a connection to the
//! server, whose settings and secrets never leave.

use std::sync::Arc;
use std::time::Duration;

use turborel_studio_core::events::{Event, EventSink, KeptEvents};
use turborel_studio_core::guard::policy::Guards;
use turborel_studio_core::live::service::LiveService;
use turborel_studio_core::live::settings::{Connectivity, LiveSettings};
use turborel_studio_core::live::share::{Column, Results, TabIn, TabKind, WorkspaceIn};
use turborel_studio_core::saved::Environment;
use turborel_studio_live::guest::GuestEvent;
use turborel_studio_live::host::HostEvent;

use crate::{Live, no_environment, run};

/// The first event `find` takes of `events`, waiting up to five seconds.
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

/// A relay in `runtime`, recording, and the connectivity that reaches it.
fn relay_of(runtime: &tokio::runtime::Runtime) -> (Arc<turborel_studio_live::relay::Relay>, Connectivity, Box<dyn std::any::Any>) {
    let relay = turborel_studio_live::relay::Relay::new(turborel_studio_live::relay::Limits::default(), true);
    let identity = turborel_studio_live::cert::Identity::new().unwrap();
    let endpoint = runtime.block_on(async { relay.listen(&identity, "127.0.0.1:0".parse().unwrap()) }).unwrap();
    let connectivity = Connectivity {
        direct: false,
        relay: true,
        relay_address: endpoint.local_addr().unwrap().to_string(),
        relay_fingerprint: identity.fingerprint.to_string(),
        ..Connectivity::default()
    };
    (relay, connectivity, Box::new(endpoint))
}

/// A Studio named `name` of `manager`'s connections, reaching others by `connectivity`, and its events.
fn studio_of(
    live: &Live,
    manager: &Arc<turborel_studio_core::connections::manager::ConnectionManager>,
    name: &str,
    connectivity: &Connectivity,
) -> (LiveService, Arc<KeptEvents>) {
    let dir = live.server.dir.join(format!("live-{name}"));
    std::fs::create_dir_all(&dir).unwrap();
    let events = Arc::new(KeptEvents::default());
    let sink: Arc<dyn EventSink> = events.clone();
    let service = LiveService::new(&dir, Arc::clone(manager), sink).unwrap();
    service.settings.keep(&LiveSettings { name: name.into(), connectivity: connectivity.clone(), ..LiveSettings::default() }).unwrap();
    (service, events)
}

/// A worksheet tab `id` of `connection`, of a result of one row of `value`.
fn tab(id: &str, connection: u64, value: &str) -> TabIn {
    TabIn {
        id: id.into(),
        kind: TabKind::Worksheet,
        title: id.into(),
        connection: Some(connection),
        text: "VALUES (1)".into(),
        selection: None,
        results: Some(Results {
            columns: vec![Column { name: None, type_name: "VARCHAR".into(), masked: false }],
            rows: vec![vec![Some(value.into())]],
            cut: false,
        }),
        messages: vec![],
        plan: vec![],
        document: None,
    }
}

/// [DESIGN] D56: a worksheet of a connection to the server is shared
/// through a relay: its rows of development shared, of production none;
/// no connection setting nor secret is in any state shared, nor any byte
/// the relay passed.
pub fn no_setting_nor_secret_is_shared(live: &Live) {
    let (manager, _) = live.manager();
    let manager = Arc::new(manager);
    let development = live.owner(&manager);
    let production = manager
        .open((&live.spec(), Guards { environment: Environment::Production, read_only: false }), Some(&live.password()), no_environment)
        .unwrap()
        .connection;
    let ran = run(&manager, development, "VALUES ('row-of-development')").unwrap();
    assert!(format!("{ran:?}").contains("row-of-development"));
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let (relay, connectivity, _endpoint) = relay_of(&runtime);
    let studio = |name: &str| studio_of(live, &manager, name, &connectivity);
    let (host, host_events) = studio("Ann");
    let (guest, guest_events) = studio("Bob");
    host.present().unwrap();
    guest.join(&host.invite().unwrap().code).unwrap();
    let (mut at_host, mut at_guest) = (Vec::new(), Vec::new());
    let id =
        wait(&host_events, &mut at_host, |e| if let Event::LiveHost { event: HostEvent::Asked { id, .. } } = e { Some(*id) } else { None });
    host.answer(id, true).unwrap();
    let workspace = WorkspaceIn {
        tabs: vec![tab("dev", development, "row-of-development"), tab("prod", production, "row-of-production")],
        active: None,
        pointer: None,
    };
    host.publish(workspace).unwrap();
    let state = wait(&guest_events, &mut at_guest, |e| match e {
        Event::LiveGuest { event: GuestEvent::State { state, .. } } => Some(state.to_string()),
        _ => None,
    });
    assert!(state.contains("row-of-development") && !state.contains("row-of-production"), "{state}");
    let spec = live.spec();
    let secrets = [
        crate::server::OWNER_PASSWORD.to_owned(),
        spec.host.clone().unwrap(),
        spec.port.clone().unwrap(),
        spec.tls_roots.clone().unwrap(),
        crate::server::OWNER.to_owned(),
    ];
    let passed = relay.passed();
    for secret in &secrets {
        assert!(!state.contains(secret.as_str()), "{secret} was shared: {state}");
        assert!(!passed.windows(secret.len()).any(|w| w == secret.as_bytes()), "{secret} passed the relay");
    }
    assert!(!passed.windows(18).any(|w| w == b"row-of-development"), "the relay read a row");
    host.end().unwrap();
    manager.close(development).unwrap();
    manager.close(production).unwrap();
}
