//! The messages of a session (RULES.md D56), between a guest and its host.
//! A workspace's state is JSON the crate does not read: Studio's backend
//! makes it, filtered, before it is sent.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The protocol's version, as a guest says hello.
pub const PROTOCOL: u32 = 1;

/// What a participant is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    /// The one whose workspace is shown.
    Presenter,
    /// One who watches.
    Viewer,
}

/// What a participant may do, beside its role.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Grants {
    /// Whether it may copy text out of what it sees.
    pub copy: bool,
    /// Whether it may suggest SQL into the presenter's worksheet.
    pub suggest: bool,
}

/// A guest's message to its host.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ToHost {
    /// The first: the session, the invitation's secret, and the guest's name.
    Hello {
        /// The protocol's version.
        version: u32,
        /// The session's identifier.
        session: String,
        /// The invitation's secret.
        secret: String,
        /// The guest's name, as the host is asked to admit it.
        name: String,
    },
    /// A hand raised, or lowered.
    Hand {
        /// Whether it is up.
        up: bool,
    },
    /// SQL suggested into a tab of the presenter's.
    Suggest {
        /// The tab's identifier, as the state names it.
        tab: String,
        /// The SQL.
        sql: String,
    },
    /// The workspace of a guest who presents.
    State {
        /// The state.
        state: Value,
    },
    /// The guest leaves.
    Bye,
}

/// A host's message to a guest.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ToGuest {
    /// The host is asked to admit the guest.
    Waiting,
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
}
