//! Live Sessions end to end (RULES.md D56): hosts, guests and a relay in
//! one process, over QUIC on the loopback address.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing, clippy::panic, reason = "a test fails where its premise does")]

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::json;
use turborel_studio_live::cert::Identity;
use turborel_studio_live::guest::{Guest, GuestEvent};
use turborel_studio_live::host::{Direct, Host, HostEvent, Options};
use turborel_studio_live::invite::{Invite, RelaySpec};
use turborel_studio_live::relay::{Limits, Relay};
use turborel_studio_live::wire::{Grants, Role};

/// Events kept as they are told.
struct Kept<T>(Arc<Mutex<Vec<T>>>);

impl<T: Clone + Send + 'static> Kept<T> {
    /// None yet.
    fn new() -> Kept<T> {
        Kept(Arc::new(Mutex::new(Vec::new())))
    }

    /// A teller that keeps each event.
    fn teller(&self) -> Arc<dyn Fn(T) + Send + Sync> {
        let kept = Arc::clone(&self.0);
        Arc::new(move |e| kept.lock().unwrap().push(e))
    }

    /// The first event `find` takes, waiting up to five seconds.
    async fn wait<R>(&self, find: impl Fn(&T) -> Option<R>) -> R {
        for _ in 0..500 {
            if let Some(found) = self.0.lock().unwrap().iter().find_map(&find) {
                return found;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("the event never came");
    }

    /// Whether any event `find` takes came.
    fn any(&self, find: impl Fn(&T) -> bool) -> bool {
        self.0.lock().unwrap().iter().any(find)
    }
}

/// A host's options, of the loopback address directly, or of `relay` alone.
fn options(relay: Option<RelaySpec>) -> Options {
    let loopback = IpAddr::V4(Ipv4Addr::LOCALHOST);
    Options {
        name: "Ann".into(),
        guests: 4,
        invite_lifetime: Duration::from_secs(600),
        direct: relay.is_none().then(|| Direct { bind: SocketAddr::new(loopback, 0), advertise: vec![loopback] }),
        relay,
    }
}

/// A guest of `invite` named `name`, admitted by `host`: the guest and its events.
async fn admitted(host: &Host, events: &Kept<HostEvent>, invite: &Invite, name: &str) -> (Guest, Kept<GuestEvent>, u64) {
    let told = Kept::new();
    let guest = Guest::join(invite, name, told.teller()).await.unwrap();
    let (id, code) = events
        .wait(|e| match e {
            HostEvent::Asked { id, name: n, code } if n == name => Some((*id, code.clone())),
            _ => None,
        })
        .await;
    let waiting = told.wait(|e| if let GuestEvent::Waiting { code } = e { Some(code.clone()) } else { None }).await;
    assert_eq!(waiting, code, "both sides show the same safety code");
    assert_eq!(guest.code, code);
    host.answer(id, true);
    told.wait(|e| matches!(e, GuestEvent::Admitted { role: Role::Viewer, .. }).then_some(())).await;
    (guest, told, id)
}

/// [DESIGN] D56: a guest reaches its host directly, both show one safety
/// code, it is admitted by name and shown the presenter's workspace; it
/// raises its hand, suggests once granted, presents once handed the role,
/// copies once allowed, and is removed.
#[tokio::test]
async fn a_guest_is_admitted_and_shown_the_workspace() {
    let events = Kept::new();
    let host = Host::start(options(None), events.teller()).await.unwrap();
    host.publish(json!({"tabs": [{"id": "w1", "text": "SELECT 1"}]}));
    let invite = host.invite();
    let (guest, told, id) = admitted(&host, &events, &invite, "Bob").await;
    let first =
        told.wait(|e| if let GuestEvent::State { state, presenter } = e { Some((state.clone(), presenter.clone())) } else { None }).await;
    assert_eq!(first, (json!({"tabs": [{"id": "w1", "text": "SELECT 1"}]}), "Ann".to_owned()));
    events.wait(|e| matches!(e, HostEvent::Joined { name, .. } if name == "Bob").then_some(())).await;
    guest.hand(true);
    events.wait(|e| matches!(e, HostEvent::Hand { up: true, .. }).then_some(())).await;
    assert!(host.participants()[0].hand);
    guest.suggest("w1", "SELECT 2");
    guest.hand(false);
    events.wait(|e| matches!(e, HostEvent::Hand { up: false, .. }).then_some(())).await;
    host.grant(id, Grants { copy: false, suggest: true });
    told.wait(|e| matches!(e, GuestEvent::Role { grants: Grants { suggest: true, .. }, .. }).then_some(())).await;
    guest.suggest("w1", "SELECT 3");
    let suggested = events.wait(|e| if let HostEvent::Suggested { sql, .. } = e { Some(sql.clone()) } else { None }).await;
    assert_eq!(suggested, "SELECT 3", "a suggestion before the grant is dropped");
    host.allow_copy(true);
    told.wait(|e| matches!(e, GuestEvent::Role { grants: Grants { copy: true, .. }, .. }).then_some(())).await;
    host.present(Some(id));
    told.wait(|e| matches!(e, GuestEvent::Role { role: Role::Presenter, .. }).then_some(())).await;
    assert_eq!(host.presenter(), Some(id));
    host.publish(json!({"ignored": true}));
    guest.publish(json!({"tabs": [{"id": "b1", "text": "VALUES (1)"}]}));
    let shown = events.wait(|e| if let HostEvent::State { presenter, .. } = e { Some(presenter.clone()) } else { None }).await;
    assert_eq!(shown, "Bob");
    host.present(None);
    told.wait(|e| matches!(e, GuestEvent::Role { role: Role::Viewer, grants: Grants { copy: true, suggest: true } }).then_some(())).await;
    host.remove(id);
    told.wait(|e| matches!(e, GuestEvent::Removed).then_some(())).await;
    events.wait(|e| matches!(e, HostEvent::Left { name, .. } if name == "Bob").then_some(())).await;
    assert_eq!(host.participants(), Vec::new());
    assert!(!told.any(|e| matches!(e, GuestEvent::State { state, .. } if state.get("ignored").is_some())));
}

/// [DESIGN] D56: an invitation is used once; a joiner the host refuses is
/// told so; a guest pinned to another certificate never reaches the host;
/// the session's end is told every guest.
#[tokio::test]
async fn invitations_are_used_once_and_joiners_refused() {
    let events = Kept::new();
    let host = Host::start(options(None), events.teller()).await.unwrap();
    let invite = host.invite();
    let (_guest, told, _) = admitted(&host, &events, &invite, "Bob").await;
    let again = Kept::new();
    let _second = Guest::join(&invite, "Eve", again.teller()).await.unwrap();
    let why = again.wait(|e| if let GuestEvent::Refused { why } = e { Some(why.clone()) } else { None }).await;
    assert!(why.contains("used"), "{why}");
    let refused = Kept::new();
    let _third = Guest::join(&host.invite(), "Mallory", refused.teller()).await.unwrap();
    let id = events.wait(|e| if let HostEvent::Asked { id, name, .. } = e { (name == "Mallory").then_some(*id) } else { None }).await;
    host.answer(id, false);
    refused.wait(|e| matches!(e, GuestEvent::Refused { .. }).then_some(())).await;
    events.wait(|e| matches!(e, HostEvent::Turned { name, .. } if name == "Mallory").then_some(())).await;
    let other = Identity::new().unwrap();
    let forged = Invite { fingerprint: other.fingerprint.to_string(), ..host.invite() };
    let failed = Guest::join(&forged, "Trudy", Kept::new().teller()).await;
    assert!(failed.is_err(), "a guest pinned to another certificate reached the host");
    assert!(Guest::join(&host.invite(), "", Kept::new().teller()).await.is_err());
    host.end();
    told.wait(|e| matches!(e, GuestEvent::Ended).then_some(())).await;
}

/// [DESIGN] D56: an invitation past its life is refused by the host.
#[tokio::test]
async fn an_expired_invitation_is_refused() {
    let events = Kept::new();
    let host = Host::start(Options { invite_lifetime: Duration::ZERO, ..options(None) }, events.teller()).await.unwrap();
    let invite = Invite { expires: u64::MAX, ..host.invite() };
    tokio::time::sleep(Duration::from_millis(1100)).await;
    let told = Kept::new();
    let _guest = Guest::join(&invite, "Bob", told.teller()).await.unwrap();
    let why = told.wait(|e| if let GuestEvent::Refused { why } = e { Some(why.clone()) } else { None }).await;
    assert!(why.contains("expired"), "{why}");
}

/// [DESIGN] D56: through a relay, a guest is admitted and shown the
/// workspace, while the relay passes only bytes it cannot read; a second
/// host of the session and a guest of no session are refused.
#[tokio::test]
async fn a_relay_passes_what_it_cannot_read() {
    let relay = Relay::new(Limits::default(), true);
    let identity = Identity::new().unwrap();
    let endpoint = relay.listen(&identity, SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0)).unwrap();
    let spec = RelaySpec { address: endpoint.local_addr().unwrap().to_string(), fingerprint: identity.fingerprint.to_string() };
    let events = Kept::new();
    let host = Host::start(options(Some(spec.clone())), events.teller()).await.unwrap();
    assert_eq!(relay.sessions(), 1);
    let invite = host.invite();
    assert_eq!(invite.direct, Vec::<String>::new());
    let (_guest, told, _) = admitted(&host, &events, &invite, "Bob").await;
    host.publish(json!({"tabs": [{"id": "w1", "text": "SELECT 'MARKER-7f3a' FROM T"}]}));
    told.wait(|e| matches!(e, GuestEvent::State { state, .. } if state.to_string().contains("MARKER-7f3a")).then_some(())).await;
    let passed = relay.passed();
    assert!(passed.len() > 100, "the relay passed {} bytes", passed.len());
    assert!(!passed.windows(11).any(|w| w == b"MARKER-7f3a"), "the relay read the workspace");
    assert!(!passed.windows(3).any(|w| w == b"Bob"), "the relay read the guest's name");
    let unknown = Invite { session: "0".repeat(32), ..invite.clone() };
    let lost = Guest::join(&unknown, "Eve", Kept::new().teller()).await.unwrap_err().0;
    assert!(lost.contains("no host"), "{lost}");
    let wrong = RelaySpec { fingerprint: Identity::new().unwrap().fingerprint.to_string(), ..spec };
    assert!(Host::start(options(Some(wrong)), Kept::new().teller()).await.is_err());
    host.end();
    for _ in 0..100 {
        if relay.sessions() == 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(relay.sessions(), 0);
}
