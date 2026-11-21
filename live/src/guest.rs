//! A session's guest (RULES.md D56): it reaches the host an invitation
//! names, directly by each address in turn, then through its relay; says
//! hello with the invitation's secret and its name; shows its safety code
//! while it waits to be admitted; and is told the presenter's workspace,
//! its role and grants, and the session's end. It raises its hand,
//! suggests SQL where granted, presents where handed the role, and leaves.

use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tokio::io::AsyncWrite;
use tokio::sync::mpsc;

use crate::error::{Result, refused};
use crate::frame::{self, MAX_FRAME};
use crate::host::named;
use crate::invite::{Invite, now};
use crate::transport::{Channel, dial_direct, dial_relay};
use crate::wire::{Grants, PROTOCOL, Role, ToGuest, ToHost};

/// What happens to a guest, as its user is told.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum GuestEvent {
    /// The host is asked to admit the guest; both show this code.
    Waiting {
        /// The channel's safety code.
        code: String,
    },
    /// The guest is admitted.
    Admitted {
        /// Its role.
        role: Role,
        /// What it may do.
        grants: Grants,
    },
    /// The guest is not admitted.
    Refused {
        /// Why.
        why: String,
    },
    /// The presenter's workspace.
    State {
        /// The state.
        state: Value,
        /// Who presents it.
        presenter: String,
    },
    /// The guest's role or grants changed.
    Role {
        /// Its role.
        role: Role,
        /// What it may do.
        grants: Grants,
    },
    /// The host removed the guest.
    Removed,
    /// The host ended the session.
    Ended,
    /// The channel to the host was lost.
    Lost,
}

/// What a guest tells its user.
pub type OnGuest = Arc<dyn Fn(GuestEvent) + Send + Sync>;

/// A guest of a session.
#[derive(Debug)]
pub struct Guest {
    to: mpsc::UnboundedSender<ToHost>,
    /// The safety code of its channel.
    pub code: String,
}

/// The channel to the host `invite` names: directly by each address in
/// turn, then through its relay.
async fn reach(invite: &Invite) -> Result<Channel> {
    let pin = invite.pin()?;
    let mut failures = Vec::new();
    for address in &invite.direct {
        match address.parse() {
            Ok(target) => match dial_direct(target, pin, &invite.session).await {
                Ok(channel) => return Ok(channel),
                Err(e) => failures.push(e.0),
            },
            Err(_) => failures.push(format!("{address} is not an address")),
        }
    }
    if let Some(relay) = &invite.relay {
        match dial_relay(relay, pin, &invite.session).await {
            Ok(channel) => return Ok(channel),
            Err(e) => failures.push(e.0),
        }
    }
    Err(refused(format!("cannot reach the host: {}", failures.join("; "))))
}

/// The event of the host's `message`.
fn event_of(message: ToGuest, code: &str) -> GuestEvent {
    match message {
        ToGuest::Waiting => GuestEvent::Waiting { code: code.to_owned() },
        ToGuest::Admitted { role, grants } => GuestEvent::Admitted { role, grants },
        ToGuest::Refused { why } => GuestEvent::Refused { why },
        ToGuest::State { state, presenter } => GuestEvent::State { state, presenter },
        ToGuest::Role { role, grants } => GuestEvent::Role { role, grants },
        ToGuest::Removed => GuestEvent::Removed,
        ToGuest::Ended => GuestEvent::Ended,
    }
}

/// Writes each message of `from` to `writer`, until the guest leaves.
async fn write_to<W: AsyncWrite + Unpin>(mut writer: W, mut from: mpsc::UnboundedReceiver<ToHost>) {
    while let Some(message) = from.recv().await {
        let last = message == ToHost::Bye;
        if frame::write(&mut writer, &message, MAX_FRAME).await.is_err() || last {
            break;
        }
    }
    let _ = tokio::io::AsyncWriteExt::shutdown(&mut writer).await; // A stream already closed needs no closing.
}

impl Guest {
    /// Joins the session of `invite` as `name`, telling `on` what happens.
    ///
    /// # Errors
    ///
    /// Of a name out of its bounds, an invitation expired, or a host that
    /// cannot be reached or is not the invitation's. It is called within a
    /// tokio runtime.
    pub async fn join(invite: &Invite, name: &str, on: OnGuest) -> Result<Guest> {
        if !named(name) {
            return Err(refused("your name is 1 to 64 characters"));
        }
        if invite.expires < now() {
            return Err(refused("the invitation has expired: ask for another"));
        }
        let (mut reader, writer, code, keep) = reach(invite).await?.into_parts();
        let (to, from) = mpsc::unbounded_channel();
        tokio::spawn(write_to(writer, from));
        let hello =
            ToHost::Hello { version: PROTOCOL, session: invite.session.clone(), secret: invite.secret.clone(), name: name.to_owned() };
        let _ = to.send(hello); // Its writer was just made.
        let told = code.clone();
        tokio::spawn(async move {
            let _keep = keep;
            let mut over = false;
            while let Ok(Some(message)) = frame::read::<_, ToGuest>(&mut reader, MAX_FRAME).await {
                over = matches!(message, ToGuest::Refused { .. } | ToGuest::Removed | ToGuest::Ended);
                on(event_of(message, &told));
                if over {
                    break;
                }
            }
            if !over {
                on(GuestEvent::Lost);
            }
        });
        Ok(Guest { to, code })
    }

    /// Raises the guest's hand, or lowers it.
    pub fn hand(&self, up: bool) {
        let _ = self.to.send(ToHost::Hand { up }); // A guest gone tells nothing.
    }

    /// Suggests `sql` into the presenter's tab `tab`.
    pub fn suggest(&self, tab: &str, sql: &str) {
        let _ = self.to.send(ToHost::Suggest { tab: tab.to_owned(), sql: sql.to_owned() }); // As `hand`.
    }

    /// Shows `state`, while the guest presents.
    pub fn publish(&self, state: Value) {
        let _ = self.to.send(ToHost::State { state }); // As `hand`.
    }

    /// Leaves the session.
    pub fn leave(&self) {
        let _ = self.to.send(ToHost::Bye); // As `hand`.
    }
}
