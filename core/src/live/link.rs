//! An invitation's link opened (RULES.md D66): Studio's scheme,
//! `turborel-studio://join?code=…`, read as an invitation, and what it
//! holds shown in the join dialog, filled in; never joined until the user
//! presses Join. A link of an invitation expired, or that is no
//! invitation's, or carries more than one, is refused, saying why.

use serde::Serialize;
use turborel_studio_live::invite::Invite;

/// What an invitation's link holds, as the join dialog shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkView {
    /// The link, as given to Join.
    pub link: String,
    /// The session's identifier.
    pub session: String,
    /// The presenter's certificate's fingerprint, in hexadecimal.
    pub fingerprint: String,
    /// The addresses the presenter is reached by directly.
    pub direct: Vec<String>,
    /// The relay it is reached through, if one, by its address.
    pub relay: Option<String>,
    /// When the invitation expires, in seconds since 1970.
    pub expires: u64,
}

/// What a link opened came to: what it holds, or why it is refused.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum LinkOpened {
    /// An invitation's link, to be shown and joined if the user says.
    Invitation {
        /// What it holds.
        link: LinkView,
    },
    /// A link refused.
    Refused {
        /// Why.
        why: String,
    },
}

/// What `url`, a link the platform opened Studio by, holds.
pub fn opened(url: &str) -> LinkOpened {
    match Invite::read_link(url) {
        Ok(invite) => LinkOpened::Invitation {
            link: LinkView {
                link: invite.link(),
                session: invite.session.clone(),
                fingerprint: invite.fingerprint.clone(),
                direct: invite.direct.clone(),
                relay: invite.relay.as_ref().map(|r| r.address.clone()),
                expires: invite.expires,
            },
        },
        Err(e) => LinkOpened::Refused { why: e.0 },
    }
}

#[cfg(test)]
mod tests {
    use turborel_studio_live::base64;
    use turborel_studio_live::invite::{Invite, VERSION, hex, now, random};

    use super::{LinkOpened, opened};

    /// [DESIGN] D66: a link opened shows what its invitation holds, and the
    /// link itself, to be joined only as the user says; one expired, one of
    /// no invitation, and one carrying more, are refused, saying why.
    #[test]
    fn a_link_opened_is_shown_or_refused() {
        let invite = Invite {
            version: VERSION,
            session: hex(&random::<16>()),
            fingerprint: "AB".repeat(32),
            secret: base64::encode(&random::<32>()),
            expires: now().saturating_add(600),
            direct: vec!["192.0.2.7:4500".into()],
            relay: None,
        };
        let LinkOpened::Invitation { link } = opened(&invite.link()) else { panic!("refused") };
        assert_eq!(
            (link.link.as_str(), link.session.as_str(), link.direct.as_slice()),
            (invite.link().as_str(), invite.session.as_str(), &["192.0.2.7:4500".to_owned()][..])
        );
        let expired = Invite { expires: now().saturating_sub(1), ..invite.clone() };
        assert!(matches!(opened(&expired.link()), LinkOpened::Refused { why } if why.contains("expired")));
        assert!(matches!(opened("turborel-studio://join?code=nothing"), LinkOpened::Refused { why } if why.contains("not an invitation")));
        assert!(matches!(opened(&format!("{}&sql=x", invite.link())), LinkOpened::Refused { why } if why.contains("carries more")));
    }
}
