//! Live Sessions' service (RULES.md D56): the session this Studio hosts,
//! or the one it joined, at most one of either, on a runtime of its own
//! whose threads are named `studio-live`. What happens is told the window
//! as the events `liveHost` and `liveGuest`, and logged; what is shared is
//! filtered by `share` before it leaves.

use std::future::Future;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde::Serialize;
use turborel_studio_live::guest::{Guest, GuestEvent};
use turborel_studio_live::host::{Direct, Host, HostEvent, Options, Participant};
use turborel_studio_live::invite::{Invite, RelaySpec};
use turborel_studio_live::wire::{Grants, Role};

use crate::connections::manager::ConnectionManager;
use crate::error::{Result, StudioError};
use crate::events::{Event, EventSink};
use crate::live::audit::{Audit, LiveEntry, audit};
use crate::live::settings::{LiveSettings, SessionChoices, Settings};
use crate::live::share::{WorkspaceIn, read_shared, shared};

/// How long the runtime goes on as the service stops, so the end is told.
const FAREWELL: Duration = Duration::from_millis(500);
/// The threads of the runtime.
const THREADS: usize = 2;
/// The longest SQL a viewer suggests, in bytes.
const MAX_SUGGESTION_BYTES: usize = 64 * 1024;
/// An address of the documentation's own (RFC 5737), never reached: a UDP
/// socket connected to it is told the address this machine would send from.
const PROBE: (Ipv4Addr, u16) = (Ipv4Addr::new(192, 0, 2, 1), 9);

/// The session hosted.
struct Hosted {
    host: Host,
    settings: LiveSettings,
    choices: SessionChoices,
}

/// The session joined.
struct Joined {
    guest: Guest,
    role: Role,
    grants: Grants,
}

/// The session joined, as the guest's events change it.
type JoinedSlot = Arc<Mutex<Option<Joined>>>;

/// What the window is told of the session hosted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostedView {
    /// The session's identifier.
    pub session: String,
    /// Its certificate's fingerprint.
    pub fingerprint: String,
    /// The addresses it is reached by directly.
    pub direct: Vec<String>,
    /// The relay it is reached through, if one.
    pub relay: Option<String>,
    /// The participants admitted.
    pub participants: Vec<Participant>,
    /// The guest who presents, none while the host does.
    pub presenter: Option<u64>,
    /// The session's choices.
    pub choices: SessionChoices,
}

/// What the window is told of the session joined.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinedView {
    /// The safety code of the channel.
    pub code: String,
    /// The guest's role.
    pub role: Role,
    /// What it may do.
    pub grants: Grants,
}

/// What the window is told of Live Sessions now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// The session hosted, if one.
    pub hosted: Option<HostedView>,
    /// The session joined, if one.
    pub joined: Option<JoinedView>,
}

/// An invitation, as the window is given it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteView {
    /// Its code.
    pub code: String,
    /// When it expires, in seconds since 1970.
    pub expires: u64,
}

/// Live Sessions.
pub struct LiveService {
    runtime: tokio::runtime::Runtime,
    /// The settings.
    pub settings: Settings,
    /// The log.
    pub audit: Arc<Audit>,
    manager: Arc<ConnectionManager>,
    events: Arc<dyn EventSink>,
    hosted: Mutex<Option<Hosted>>,
    joined: JoinedSlot,
}

/// A failure of the session, as Studio's error.
fn misuse(e: impl std::fmt::Display) -> StudioError {
    StudioError::misuse(format!("[DESIGN] {e}"))
}

/// This machine's addresses to advertise: the one it sends from to the
/// world, or the loopback address of none.
pub fn found_addresses() -> Vec<IpAddr> {
    let found = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .and_then(|socket| socket.connect(PROBE).map(|()| socket))
        .and_then(|socket| socket.local_addr())
        .map(|address| address.ip())
        .ok()
        .filter(|ip| !ip.is_unspecified() && !ip.is_loopback());
    vec![found.unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST))]
}

impl LiveService {
    /// Live Sessions of `dir`'s files, sharing connections of `manager`,
    /// telling `events`.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the runtime cannot be made.
    pub fn new(dir: &Path, manager: Arc<ConnectionManager>, events: Arc<dyn EventSink>) -> Result<LiveService> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(THREADS)
            .thread_name("studio-live")
            .enable_all()
            .build()
            .map_err(|e| misuse(format!("Live Sessions' runtime: {e}")))?;
        Ok(LiveService {
            runtime,
            settings: Settings::new(dir),
            audit: Arc::new(audit(dir)),
            manager,
            events,
            hosted: Mutex::new(None),
            joined: Arc::new(Mutex::new(None)),
        })
    }

    /// The session hosted, locked.
    fn hosted(&self) -> MutexGuard<'_, Option<Hosted>> {
        self.hosted.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The session joined, locked.
    fn joined(&self) -> MutexGuard<'_, Option<Joined>> {
        self.joined.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// `work`'s outcome, run on the runtime, waited for on this thread.
    fn wait<T: Send + 'static>(&self, work: impl Future<Output = T> + Send + 'static) -> Result<T> {
        let (done, outcome) = std::sync::mpsc::channel();
        self.runtime.spawn(async move {
            let _ = done.send(work.await); // The caller waits on it.
        });
        outcome.recv().map_err(|_| misuse("Live Sessions' runtime stopped"))
    }

    /// Logs `what` of `who`, with `detail`; a log that cannot be written is
    /// let be, as the session goes on.
    fn log(&self, what: &str, who: Option<&str>, detail: Option<&str>) {
        let _ = self.audit.add(&LiveEntry::of(what, who, detail)); // As above.
    }

    /// The settings, of sessions on and a name set.
    fn usable(&self) -> Result<LiveSettings> {
        let settings = self.settings.read()?;
        if !settings.enabled {
            return Err(misuse("Live Sessions are off: turn them on in their settings"));
        }
        if settings.name.is_empty() {
            return Err(misuse("give your name in Live Sessions' settings first, as others see it"));
        }
        Ok(settings)
    }

    /// The options of a session hosted of `settings`.
    fn options(settings: &LiveSettings) -> Options {
        let c = &settings.connectivity;
        let advertise: Vec<IpAddr> = c.advertise.iter().filter_map(|a| a.parse().ok()).collect();
        let advertise = if advertise.is_empty() { found_addresses() } else { advertise };
        Options {
            name: settings.name.clone(),
            guests: usize::try_from(settings.max_viewers).unwrap_or(1),
            invite_lifetime: Duration::from_secs(u64::from(settings.invite_minutes).saturating_mul(60)),
            direct: c.direct.then(|| Direct { bind: SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), c.port), advertise }),
            relay: c.relay.then(|| RelaySpec { address: c.relay_address.clone(), fingerprint: c.relay_fingerprint.clone() }),
        }
    }

    /// What the host's user is told, and the log, of each event.
    fn on_host(&self) -> Arc<dyn Fn(HostEvent) + Send + Sync> {
        let (events, audit) = (Arc::clone(&self.events), Arc::clone(&self.audit));
        Arc::new(move |event: HostEvent| {
            let entry = match &event {
                HostEvent::Asked { name, .. } => Some(LiveEntry::of("asked", Some(name), None)),
                HostEvent::Joined { name, .. } => Some(LiveEntry::of("admitted", Some(name), None)),
                HostEvent::Turned { name, why } => Some(LiveEntry::of("refused", Some(name), Some(why))),
                HostEvent::Left { name, .. } => Some(LiveEntry::of("left", Some(name), None)),
                HostEvent::Suggested { name, sql, .. } => Some(LiveEntry::of("suggested", Some(name), Some(sql))),
                HostEvent::Hand { .. } | HostEvent::State { .. } => None,
            };
            if let Some(entry) = entry {
                let _ = audit.add(&entry); // As `log`.
            }
            if let HostEvent::State { state, .. } = &event
                && read_shared(state).is_none()
            {
                return;
            }
            events.emit(Event::LiveHost { event });
        })
    }

    /// Hosts a session, as the settings say.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of sessions off or no name set, a session hosted or
    /// joined already, or a session that cannot start.
    pub fn present(&self) -> Result<Status> {
        let settings = self.usable()?;
        if self.hosted().is_some() || self.joined().is_some() {
            return Err(misuse("a session is hosted or joined already: end it first"));
        }
        let on = self.on_host();
        let host = self.wait(Host::start(LiveService::options(&settings), on))?.map_err(misuse)?;
        let choices = SessionChoices::of(&settings);
        *self.hosted() = Some(Hosted { host, settings, choices });
        self.log("started", None, None);
        self.status()
    }

    /// A new invitation of the session hosted.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of no session hosted.
    pub fn invite(&self) -> Result<InviteView> {
        let hosted = self.hosted();
        let host = &hosted.as_ref().ok_or_else(|| misuse("no session is hosted"))?.host;
        let invite = host.invite();
        drop(hosted);
        self.log("invited", None, None);
        Ok(InviteView { code: invite.code(), expires: invite.expires })
    }

    /// Runs `act` on the session hosted.
    fn with_host<T>(&self, act: impl FnOnce(&mut Hosted) -> Result<T>) -> Result<T> {
        let _entered = self.runtime.enter();
        let mut hosted = self.hosted();
        act(hosted.as_mut().ok_or_else(|| misuse("no session is hosted"))?)
    }

    /// The name of participant `id`, if it is one.
    fn name_of(hosted: &Hosted, id: u64) -> Option<String> {
        hosted.host.participants().into_iter().find(|p| p.id == id).map(|p| p.name)
    }

    /// Admits guest `id`, or refuses it.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of no session hosted.
    pub fn answer(&self, id: u64, yes: bool) -> Result<()> {
        self.with_host(|h| {
            h.host.answer(id, yes);
            Ok(())
        })
    }

    /// Removes guest `id`.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of no session hosted.
    pub fn remove(&self, id: u64) -> Result<()> {
        let name = self.with_host(|h| {
            let name = LiveService::name_of(h, id);
            h.host.remove(id);
            Ok(name)
        })?;
        self.log("removed", name.as_deref(), None);
        Ok(())
    }

    /// Grants guest `id` Suggest, or takes it back.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of no session hosted, or of Suggest the settings do not allow.
    pub fn grant_suggest(&self, id: u64, on: bool) -> Result<()> {
        let name = self.with_host(|h| {
            if on && !h.settings.allow_suggest {
                return Err(misuse("the settings allow no viewer to suggest"));
            }
            let copy = h.choices.copy;
            h.host.grant(id, Grants { copy, suggest: on });
            Ok(LiveService::name_of(h, id))
        })?;
        self.log(if on { "granted suggest" } else { "took suggest back" }, name.as_deref(), None);
        Ok(())
    }

    /// Hands the presenter's role to guest `id`, or takes it back of none.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of no session hosted.
    pub fn hand_over(&self, id: Option<u64>) -> Result<()> {
        let name = self.with_host(|h| {
            h.host.present(id);
            Ok(id.and_then(|i| LiveService::name_of(h, i)))
        })?;
        self.log("presenter", name.as_deref().or(Some("the host")), None);
        Ok(())
    }

    /// Sets the session's choices, within the settings where they are locked.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of no session hosted, a row limit out of its bounds, or
    /// choices wider than locked settings allow.
    pub fn choose(&self, choices: SessionChoices) -> Result<()> {
        if !(1..=10_000).contains(&choices.row_limit) {
            return Err(misuse("the rows shared are from 1 to 10000"));
        }
        self.with_host(|h| {
            if !h.settings.allows(&choices) {
                return Err(misuse("the settings are locked: a session may not widen them"));
            }
            h.choices = choices;
            h.host.allow_copy(choices.copy);
            Ok(())
        })?;
        self.log("choices", None, Some(&serde_json::to_string(&choices).unwrap_or_default()));
        Ok(())
    }

    /// Shares `workspace`, filtered, where this Studio presents.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of a workspace out of its bounds, or of no session this
    /// Studio presents.
    pub fn publish(&self, workspace: WorkspaceIn) -> Result<()> {
        let environment_of = |c: u64| self.manager.environment(c).ok();
        if let Some(h) = self.hosted().as_ref() {
            let state = shared(workspace, (&h.settings, &h.choices), environment_of)?;
            h.host.publish(state);
            return Ok(());
        }
        let joined = self.joined();
        let presenting = joined.as_ref().filter(|j| j.role == Role::Presenter).ok_or_else(|| misuse("this Studio presents no session"))?;
        let settings = self.settings.read()?;
        let state = shared(workspace, (&settings, &SessionChoices::of(&settings)), environment_of)?;
        presenting.guest.publish(state);
        Ok(())
    }

    /// Ends the session hosted.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of no session hosted.
    pub fn end(&self) -> Result<()> {
        let _entered = self.runtime.enter();
        let hosted = self.hosted().take().ok_or_else(|| misuse("no session is hosted"))?;
        hosted.host.end();
        drop(hosted);
        self.log("ended", None, None);
        Ok(())
    }

    /// What the guest's user is told of each event, its state checked, and
    /// the session joined let go as it ends.
    fn on_guest(&self, over: Arc<AtomicBool>) -> Arc<dyn Fn(GuestEvent) + Send + Sync> {
        let (events, audit, joined) = (Arc::clone(&self.events), Arc::clone(&self.audit), Arc::clone(&self.joined));
        Arc::new(move |event: GuestEvent| {
            let mut slot = joined.lock().unwrap_or_else(PoisonError::into_inner);
            match &event {
                GuestEvent::Admitted { role, grants } | GuestEvent::Role { role, grants } => {
                    if let Some(j) = slot.as_mut() {
                        (j.role, j.grants) = (*role, *grants);
                    }
                }
                GuestEvent::Refused { .. } | GuestEvent::Removed | GuestEvent::Ended | GuestEvent::Lost => {
                    over.store(true, Ordering::SeqCst);
                    *slot = None;
                    let what = serde_json::to_value(&event).ok().and_then(|v| v.get("kind").and_then(|k| k.as_str().map(str::to_owned)));
                    let _ = audit.add(&LiveEntry::of(&what.unwrap_or_default(), None, None)); // As `log`.
                }
                GuestEvent::State { state, .. } if read_shared(state).is_none() => return,
                GuestEvent::Waiting { .. } | GuestEvent::State { .. } => {}
            }
            drop(slot);
            events.emit(Event::LiveGuest { event });
        })
    }

    /// Joins the session of invitation `code`.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of sessions off or no name set, a session hosted or
    /// joined already, an invitation that is not one or expired, or a host
    /// that cannot be reached.
    pub fn join(&self, code: &str) -> Result<Status> {
        let settings = self.usable()?;
        if self.hosted().is_some() || self.joined().is_some() {
            return Err(misuse("a session is hosted or joined already: end it first"));
        }
        let invite = Invite::read(code).map_err(misuse)?;
        let over = Arc::new(AtomicBool::new(false));
        let on = self.on_guest(Arc::clone(&over));
        let name = settings.name.clone();
        let guest = self.wait(async move { Guest::join(&invite, &name, on).await })?.map_err(misuse)?;
        let mut joined = self.joined();
        // A refusal told before the guest is kept leaves no session joined.
        if !over.load(Ordering::SeqCst) {
            *joined = Some(Joined { guest, role: Role::Viewer, grants: Grants::default() });
        }
        drop(joined);
        self.log("joined", None, None);
        self.status()
    }

    /// Runs `act` on the session joined.
    fn with_guest(&self, act: impl FnOnce(&Joined) -> Result<()>) -> Result<()> {
        act(self.joined().as_ref().ok_or_else(|| misuse("no session is joined"))?)
    }

    /// Raises this Studio's hand, or lowers it.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of no session joined.
    pub fn hand(&self, up: bool) -> Result<()> {
        self.with_guest(|j| {
            j.guest.hand(up);
            Ok(())
        })
    }

    /// Suggests `sql` into the presenter's tab `tab`.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of no session joined, no grant to suggest, or SQL past 64 KiB.
    pub fn suggest(&self, tab: &str, sql: &str) -> Result<()> {
        if sql.len() > MAX_SUGGESTION_BYTES || sql.trim().is_empty() {
            return Err(misuse("a suggestion is 1 byte to 64 KiB of SQL"));
        }
        self.with_guest(|j| {
            if !j.grants.suggest {
                return Err(misuse("the presenter has not let you suggest"));
            }
            j.guest.suggest(tab, sql);
            Ok(())
        })?;
        self.log("suggested", None, Some(sql));
        Ok(())
    }

    /// Leaves the session joined.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of no session joined.
    pub fn leave(&self) -> Result<()> {
        let joined = self.joined().take().ok_or_else(|| misuse("no session is joined"))?;
        joined.guest.leave();
        self.log("left", None, None);
        Ok(())
    }

    /// Live Sessions now.
    ///
    /// # Errors
    ///
    /// Never, but as its signature allows.
    pub fn status(&self) -> Result<Status> {
        let hosted = self.hosted().as_ref().map(|h| {
            let address = h.host.local_address();
            let options = LiveService::options(&h.settings);
            let direct = match (address, options.direct) {
                (Some(bound), Some(d)) => d.advertise.iter().map(|ip| SocketAddr::new(*ip, bound.port()).to_string()).collect(),
                _ => Vec::new(),
            };
            HostedView {
                session: h.host.session().to_owned(),
                fingerprint: h.host.fingerprint(),
                direct,
                relay: options.relay.map(|r| r.address),
                participants: h.host.participants(),
                presenter: h.host.presenter(),
                choices: h.choices,
            }
        });
        let joined = self.joined().as_ref().map(|j| JoinedView { code: j.guest.code.clone(), role: j.role, grants: j.grants });
        Ok(Status { hosted, joined })
    }
}

impl Drop for LiveService {
    fn drop(&mut self) {
        let _entered = self.runtime.enter();
        let hosted = self.hosted().take();
        let joined = self.joined().take();
        if let Some(hosted) = &hosted {
            hosted.host.end();
        }
        if let Some(joined) = &joined {
            joined.guest.leave();
        }
        if hosted.is_some() || joined.is_some() {
            // The runtime's threads tell the guests, or the host, before it stops.
            std::thread::sleep(FAREWELL);
        }
    }
}

#[cfg(test)]
mod tests;
