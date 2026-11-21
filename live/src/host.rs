//! A session's host (RULES.md D56): it listens directly, at a relay, or
//! both; makes one-time invitations; asks its user to admit each guest by
//! name, beside the safety code of the guest's channel; and passes the
//! presenter's workspace to every other participant. The host may present
//! itself or hand the role to a guest, whose workspace it then passes on;
//! it grants each guest's copying and suggesting, removes a guest, and
//! ends the session, at any moment.

use std::collections::{BTreeMap, HashMap};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{mpsc, oneshot};

use crate::base64;
use crate::cert::Identity;
use crate::error::{Result, refused};
use crate::frame::{self, MAX_FRAME};
use crate::invite::{Invite, RelaySpec, VERSION, hex, now, random};
use crate::transport::{ALPN, RelayHost, accept_direct, quic_server};
use crate::wire::{Grants, PROTOCOL, Role, ToGuest, ToHost};

/// The longest a guest takes to say hello.
const HELLO_WITHIN: Duration = Duration::from_secs(30);
/// The longest a guest waits to be admitted.
const ADMIT_WITHIN: Duration = Duration::from_mins(10);
/// The longest name of a participant, in characters.
pub const MAX_NAME_CHARS: usize = 64;
/// The longest SQL a guest suggests, in bytes.
pub const MAX_SUGGESTION_BYTES: usize = 64 * 1024;

/// How a host is reached directly: the address it binds, and those its
/// invitations name, each given the port it binds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Direct {
    /// The address bound, port 0 for any.
    pub bind: SocketAddr,
    /// The addresses invitations name; their ports are the one bound.
    pub advertise: Vec<std::net::IpAddr>,
}

/// A host's choices.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    /// The host's name, as its guests see it present.
    pub name: String,
    /// The most guests at once, admitted or waiting.
    pub guests: usize,
    /// How long an invitation lasts.
    pub invite_lifetime: Duration,
    /// Whether, and how, it is reached directly.
    pub direct: Option<Direct>,
    /// The relay it is reached through, if one.
    pub relay: Option<RelaySpec>,
}

/// What happens at a host, as its user is told.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum HostEvent {
    /// A guest asks to be admitted.
    Asked {
        /// Its number.
        id: u64,
        /// Its name.
        name: String,
        /// Its channel's safety code.
        code: String,
    },
    /// A guest is admitted.
    Joined {
        /// Its number.
        id: u64,
        /// Its name.
        name: String,
    },
    /// A guest left, or was removed, or was refused.
    Left {
        /// Its number.
        id: u64,
        /// Its name.
        name: String,
    },
    /// A guest raised or lowered its hand.
    Hand {
        /// Its number.
        id: u64,
        /// Whether it is up.
        up: bool,
    },
    /// A guest suggests SQL.
    Suggested {
        /// Its number.
        id: u64,
        /// Its name.
        name: String,
        /// The tab it suggests into.
        tab: String,
        /// The SQL.
        sql: String,
    },
    /// The workspace of the guest who presents.
    State {
        /// The state.
        state: Value,
        /// Who presents it.
        presenter: String,
    },
    /// A guest was refused, and why.
    Turned {
        /// Its name, as it said it.
        name: String,
        /// Why.
        why: String,
    },
}

/// What a host tells its user.
pub type OnHost = Arc<dyn Fn(HostEvent) + Send + Sync>;

/// A participant, as the host's user sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    /// Its number.
    pub id: u64,
    /// Its name.
    pub name: String,
    /// Its role.
    pub role: Role,
    /// What it may do.
    pub grants: Grants,
    /// Whether its hand is up.
    pub hand: bool,
}

/// An admitted guest: as seen, and its writer.
struct Admitted {
    seen: Participant,
    to: mpsc::UnboundedSender<ToGuest>,
}

/// A host's state.
struct State {
    invites: HashMap<String, u64>,
    pending: HashMap<u64, (String, oneshot::Sender<bool>)>,
    admitted: BTreeMap<u64, Admitted>,
    presenter: Option<u64>,
    last: Option<(Value, String)>,
    copy: bool,
    next: u64,
    ended: bool,
}

/// What a guest's task shares with the host.
struct Shared {
    session: String,
    options: Options,
    on: OnHost,
    state: Mutex<State>,
}

impl Shared {
    /// The state, locked.
    fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Sends `message` to every admitted guest but `except`.
    fn broadcast(&self, message: &ToGuest, except: Option<u64>) {
        for (id, guest) in &self.state().admitted {
            if Some(*id) != except {
                let _ = guest.to.send(message.clone()); // A guest gone is removed by its own task.
            }
        }
    }
}

/// A session's host.
pub struct Host {
    shared: Arc<Shared>,
    identity: Arc<Identity>,
    endpoint: Option<quinn::Endpoint>,
    relay: Option<Arc<RelayHost>>,
}

/// Whether `name` may name a participant: 1 to 64 characters, none of them control.
pub fn named(name: &str) -> bool {
    let count = name.chars().count();
    (1..=MAX_NAME_CHARS).contains(&count) && !name.chars().any(char::is_control) && !name.trim().is_empty()
}

impl Host {
    /// Starts a session of `options`, telling `on` what happens: listening
    /// directly where they say, and registered at their relay.
    ///
    /// # Errors
    ///
    /// Of neither way to reach it, an address that cannot be bound, or a
    /// relay that cannot be reached or refuses. It is called within a
    /// tokio runtime.
    pub async fn start(options: Options, on: OnHost) -> Result<Host> {
        if options.direct.is_none() && options.relay.is_none() {
            return Err(refused("a session is reached directly, through a relay, or both"));
        }
        if !named(&options.name) {
            return Err(refused("a presenter's name is 1 to 64 characters"));
        }
        let identity = Arc::new(Identity::new()?);
        let session = hex(&random::<16>());
        let state = State {
            invites: HashMap::new(),
            pending: HashMap::new(),
            admitted: BTreeMap::new(),
            presenter: None,
            last: None,
            copy: false,
            next: 1,
            ended: false,
        };
        let shared = Arc::new(Shared { session, options, on, state: Mutex::new(state) });
        let endpoint = match &shared.options.direct {
            Some(direct) => Some(quic_server(&identity, direct.bind, ALPN)?),
            None => None,
        };
        if let Some(endpoint) = endpoint.clone() {
            tokio::spawn(accept_directly(Arc::clone(&shared), endpoint));
        }
        let relay = match &shared.options.relay {
            Some(spec) => Some(Arc::new(RelayHost::register(spec, &shared.session).await?)),
            None => None,
        };
        if let Some(relay) = relay.clone() {
            tokio::spawn(accept_relayed(Arc::clone(&shared), relay, Arc::clone(&identity)));
        }
        Ok(Host { shared, identity, endpoint, relay })
    }

    /// The session's identifier.
    pub fn session(&self) -> &str {
        &self.shared.session
    }

    /// The fingerprint of the session's certificate, written.
    pub fn fingerprint(&self) -> String {
        self.identity.fingerprint.to_string()
    }

    /// The address the host listens on directly, if it does.
    pub fn local_address(&self) -> Option<SocketAddr> {
        self.endpoint.as_ref().and_then(|e| e.local_addr().ok())
    }

    /// A new invitation, of one use, expiring past the options' lifetime.
    pub fn invite(&self) -> Invite {
        let secret = base64::encode(&random::<32>());
        let expires = now().saturating_add(self.shared.options.invite_lifetime.as_secs());
        let mut state = self.shared.state();
        state.invites.retain(|_, until| *until >= now());
        state.invites.insert(secret.clone(), expires);
        drop(state);
        let port = self.local_address().map_or(0, |a| a.port());
        let direct =
            self.shared.options.direct.as_ref().map(|d| d.advertise.iter().map(|ip| SocketAddr::new(*ip, port).to_string()).collect());
        Invite {
            version: VERSION,
            session: self.shared.session.clone(),
            fingerprint: self.fingerprint(),
            secret,
            expires,
            direct: direct.unwrap_or_default(),
            relay: self.shared.options.relay.clone(),
        }
    }

    /// Admits guest `id`, or refuses it.
    pub fn answer(&self, id: u64, yes: bool) {
        if let Some((_, answer)) = self.shared.state().pending.remove(&id) {
            let _ = answer.send(yes); // A guest gone waits no more.
        }
    }

    /// The participants admitted.
    pub fn participants(&self) -> Vec<Participant> {
        self.shared.state().admitted.values().map(|a| a.seen.clone()).collect()
    }

    /// Removes guest `id`.
    pub fn remove(&self, id: u64) {
        let gone = {
            let mut state = self.shared.state();
            if state.presenter == Some(id) {
                state.presenter = None;
            }
            state.admitted.remove(&id)
        };
        if let Some(guest) = gone {
            let _ = guest.to.send(ToGuest::Removed); // The guest's writer ends with it.
            (self.shared.on)(HostEvent::Left { id, name: guest.seen.name });
        }
    }

    /// Grants guest `id` `grants`.
    pub fn grant(&self, id: u64, grants: Grants) {
        let mut state = self.shared.state();
        if let Some(guest) = state.admitted.get_mut(&id) {
            guest.seen.grants = grants;
            let _ = guest.to.send(ToGuest::Role { role: guest.seen.role, grants }); // As `broadcast`.
        }
    }

    /// Lets every guest copy text out of what it sees, or none.
    pub fn allow_copy(&self, on: bool) {
        let mut state = self.shared.state();
        state.copy = on;
        for guest in state.admitted.values_mut() {
            guest.seen.grants.copy = on;
            let _ = guest.to.send(ToGuest::Role { role: guest.seen.role, grants: guest.seen.grants }); // As `broadcast`.
        }
    }

    /// Hands the presenter's role to guest `id`, or takes it back of none.
    pub fn present(&self, id: Option<u64>) {
        let mut state = self.shared.state();
        if id.is_some_and(|i| !state.admitted.contains_key(&i)) {
            return;
        }
        let before = state.presenter;
        state.presenter = id;
        for (i, guest) in &mut state.admitted {
            let role = if Some(*i) == id { Role::Presenter } else { Role::Viewer };
            if guest.seen.role != role || Some(*i) == before {
                guest.seen.role = role;
                let _ = guest.to.send(ToGuest::Role { role, grants: guest.seen.grants }); // As `broadcast`.
            }
        }
    }

    /// The presenter's number: none while the host presents.
    pub fn presenter(&self) -> Option<u64> {
        self.shared.state().presenter
    }

    /// Shows `state` to every guest, while the host presents.
    pub fn publish(&self, state: Value) {
        let name = self.shared.options.name.clone();
        {
            let mut held = self.shared.state();
            if held.presenter.is_some() || held.ended {
                return;
            }
            held.last = Some((state.clone(), name.clone()));
        }
        self.shared.broadcast(&ToGuest::State { state, presenter: name }, None);
    }

    /// Ends the session: every guest told, and the host reached no more.
    pub fn end(&self) {
        {
            let mut state = self.shared.state();
            state.ended = true;
            state.invites.clear();
            for (_, (_, answer)) in state.pending.drain() {
                let _ = answer.send(false); // A guest gone waits no more.
            }
        }
        self.shared.broadcast(&ToGuest::Ended, None);
        self.shared.state().admitted.clear();
        let (endpoint, relay) = (self.endpoint.clone(), self.relay.clone());
        let close = move || {
            if let Some(endpoint) = &endpoint {
                endpoint.close(0u32.into(), b"ended");
            }
            if let Some(relay) = &relay {
                relay.close();
            }
        };
        match (tokio::runtime::Handle::try_current(), self.endpoint.clone()) {
            (Ok(runtime), Some(waited)) => {
                runtime.spawn(async move {
                    let _ = tokio::time::timeout(FAREWELL_WITHIN, waited.wait_idle()).await; // Guests close as told, or are let go.
                    close();
                });
            }
            (Ok(runtime), None) => {
                runtime.spawn(async move {
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    close();
                });
            }
            (Err(_), _) => close(),
        }
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        if !self.shared.state().ended {
            self.end();
        }
    }
}

/// The longest a guest refused is waited for to close its side.
const FAREWELL_WITHIN: Duration = Duration::from_secs(5);

/// Writes `message` to a guest not yet admitted, ignoring a guest gone.
async fn tell<W: AsyncWrite + Unpin>(writer: &mut W, message: &ToGuest) {
    let _ = frame::write(writer, message, MAX_FRAME).await; // A guest gone hears nothing.
}

/// Tells a guest it is refused for `why`, ends the host's side, and waits
/// for the guest to close its own, so its connection is not closed before
/// the refusal arrives.
async fn refuse<R: AsyncRead + Unpin, W: AsyncWrite + Unpin>(reader: &mut R, writer: &mut W, why: String) {
    tell(writer, &ToGuest::Refused { why }).await;
    let _ = tokio::io::AsyncWriteExt::shutdown(writer).await; // A stream already closed needs no closing.
    let mut rest = Vec::new();
    let _ = tokio::time::timeout(FAREWELL_WITHIN, tokio::io::AsyncReadExt::read_to_end(reader, &mut rest)).await; // The guest closes, or is let go.
}

/// Why a hello is not admitted, if it is not.
fn checked(shared: &Shared, hello: Option<ToHost>) -> std::result::Result<String, String> {
    let Some(ToHost::Hello { version, session, secret, name }) = hello else {
        return Err("the guest did not say hello".to_owned());
    };
    if version != PROTOCOL {
        return Err(format!("a guest of protocol {version} is not admitted"));
    }
    if !named(&name) {
        return Err("a guest's name is 1 to 64 characters".to_owned());
    }
    let mut state = shared.state();
    if state.ended || session != shared.session {
        return Err("this is not the session the invitation is of".to_owned());
    }
    match state.invites.remove(&secret) {
        Some(until) if until >= now() => {}
        Some(_) => return Err("the invitation has expired: ask for another".to_owned()),
        None => return Err("the invitation was used, or is not this session's: ask for another".to_owned()),
    }
    if state.admitted.len().saturating_add(state.pending.len()) >= shared.options.guests {
        return Err("the session has as many guests as it may".to_owned());
    }
    Ok(name)
}

/// Admits each guest that reaches `endpoint` directly, until it closes.
async fn accept_directly(shared: Arc<Shared>, endpoint: quinn::Endpoint) {
    while let Some(incoming) = endpoint.accept().await {
        let shared = Arc::clone(&shared);
        tokio::spawn(async move {
            if let Ok(channel) = accept_direct(incoming, &shared.session).await {
                admit(shared, channel).await;
            }
        });
    }
}

/// Admits each guest `relay` pairs with the host, until its connection ends.
async fn accept_relayed(shared: Arc<Shared>, relay: Arc<RelayHost>, identity: Arc<Identity>) {
    while let Some(paired) = relay.accept(&identity, &shared.session).await {
        let shared = Arc::clone(&shared);
        if let Ok(channel) = paired {
            tokio::spawn(admit(shared, channel));
        }
    }
}

/// Admits the guest of `channel`, if its hello is good and the host's user
/// says yes, then serves it until it leaves.
async fn admit(shared: Arc<Shared>, channel: crate::transport::Channel) {
    let (mut reader, mut writer, code, _keep) = channel.into_parts();
    let hello =
        tokio::time::timeout(HELLO_WITHIN, frame::read::<_, ToHost>(&mut reader, MAX_FRAME)).await.ok().and_then(Result::ok).flatten();
    let name = match checked(&shared, hello) {
        Ok(name) => name,
        Err(why) => {
            refuse(&mut reader, &mut writer, why).await;
            return;
        }
    };
    let (answer, answered) = oneshot::channel();
    let id = {
        let mut state = shared.state();
        let id = state.next;
        state.next = id.saturating_add(1);
        state.pending.insert(id, (name.clone(), answer));
        id
    };
    (shared.on)(HostEvent::Asked { id, name: name.clone(), code });
    tell(&mut writer, &ToGuest::Waiting).await;
    let yes = tokio::time::timeout(ADMIT_WITHIN, answered).await.ok().and_then(std::result::Result::ok).unwrap_or(false);
    shared.state().pending.remove(&id);
    if !yes || shared.state().ended {
        (shared.on)(HostEvent::Turned { name, why: "not admitted".to_owned() });
        refuse(&mut reader, &mut writer, "the presenter did not admit you".to_owned()).await;
        return;
    }
    let (to, from) = mpsc::unbounded_channel();
    tokio::spawn(write_to(writer, from));
    seat(&shared, id, &name, to);
    serve(&shared, id, &mut reader).await;
    let gone = {
        let mut state = shared.state();
        if state.presenter == Some(id) {
            state.presenter = None;
        }
        state.admitted.remove(&id)
    };
    if gone.is_some() {
        (shared.on)(HostEvent::Left { id, name });
    }
}

/// Seats admitted guest `id`, named `name`, writing to it by `to`: told it
/// is admitted, shown the workspace, and the host's user told it joined.
fn seat(shared: &Shared, id: u64, name: &str, to: mpsc::UnboundedSender<ToGuest>) {
    {
        let mut state = shared.state();
        let grants = Grants { copy: state.copy, suggest: false };
        let seen = Participant { id, name: name.to_owned(), role: Role::Viewer, grants, hand: false };
        let _ = to.send(ToGuest::Admitted { role: Role::Viewer, grants }); // Its writer was just made.
        if let Some((state_now, presenter)) = state.last.clone() {
            let _ = to.send(ToGuest::State { state: state_now, presenter }); // As above.
        }
        state.admitted.insert(id, Admitted { seen, to });
    }
    (shared.on)(HostEvent::Joined { id, name: name.to_owned() });
}

/// Writes each message of `from` to `writer`, until the guest is removed,
/// the session ends, or the guest is gone.
async fn write_to<W: AsyncWrite + Unpin>(mut writer: W, mut from: mpsc::UnboundedReceiver<ToGuest>) {
    while let Some(message) = from.recv().await {
        let last = matches!(message, ToGuest::Removed | ToGuest::Ended);
        if frame::write(&mut writer, &message, MAX_FRAME).await.is_err() || last {
            break;
        }
    }
    let _ = tokio::io::AsyncWriteExt::shutdown(&mut writer).await; // A stream already closed needs no closing.
}

/// Serves admitted guest `id`'s messages until it leaves.
async fn serve<R: AsyncRead + Unpin>(shared: &Shared, id: u64, reader: &mut R) {
    while let Ok(Some(message)) = frame::read::<_, ToHost>(reader, MAX_FRAME).await {
        match message {
            ToHost::Hand { up } => {
                if let Some(guest) = shared.state().admitted.get_mut(&id) {
                    guest.seen.hand = up;
                }
                (shared.on)(HostEvent::Hand { id, up });
            }
            ToHost::Suggest { tab, sql } => {
                let name = shared.state().admitted.get(&id).filter(|g| g.seen.grants.suggest).map(|g| g.seen.name.clone());
                if let Some(name) = name.filter(|_| sql.len() <= MAX_SUGGESTION_BYTES) {
                    (shared.on)(HostEvent::Suggested { id, name, tab, sql });
                }
            }
            ToHost::State { state } => {
                let presenter = {
                    let mut held = shared.state();
                    let name = held.admitted.get(&id).map(|g| g.seen.name.clone()).filter(|_| held.presenter == Some(id));
                    if let Some(name) = &name {
                        held.last = Some((state.clone(), name.clone()));
                    }
                    name
                };
                if let Some(presenter) = presenter {
                    shared.broadcast(&ToGuest::State { state: state.clone(), presenter: presenter.clone() }, Some(id));
                    (shared.on)(HostEvent::State { state, presenter });
                }
            }
            ToHost::Bye => break,
            ToHost::Hello { .. } => {}
        }
    }
}
