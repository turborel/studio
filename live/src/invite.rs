//! An invitation (RULES.md D56): one use, a short life, of the session's
//! identifier, the host's fingerprint, a secret, and the addresses to reach
//! the host by, directly or through a relay. Its code is its JSON in
//! base64 of the URL's alphabet, after `turborel-live:`; its link
//! (D66), the same base64 after `turborel-studio://join?code=`, and
//! nothing else.

use std::fmt::Write as _;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::base64;
use crate::cert::Fingerprint;
use crate::error::{Result, refused};

/// What every code begins with.
pub const PREFIX: &str = "turborel-live:";
/// What every link begins with: the scheme Studio registers, and its one
/// parameter.
pub const LINK_PREFIX: &str = "turborel-studio://join?code=";
/// The invitation's format.
pub const VERSION: u32 = 1;
/// The longest code read, in bytes.
const MAX_CODE_BYTES: usize = 4096;
/// The most addresses an invitation names.
const MAX_ADDRESSES: usize = 8;

/// A relay: its address, `host:port`, and its certificate's fingerprint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RelaySpec {
    /// Its address, `host:port`.
    pub address: String,
    /// Its certificate's fingerprint, in hexadecimal.
    pub fingerprint: String,
}

/// An invitation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Invite {
    /// Its format.
    pub version: u32,
    /// The session's identifier, 32 hexadecimal digits.
    pub session: String,
    /// The host's certificate's fingerprint, in hexadecimal.
    pub fingerprint: String,
    /// Its secret, 32 bytes in base64, proved as the guest says hello.
    pub secret: String,
    /// When it expires, in seconds since 1970.
    pub expires: u64,
    /// The addresses the host listens on directly, `ip:port`.
    pub direct: Vec<String>,
    /// The relay the host is reached through, if one.
    pub relay: Option<RelaySpec>,
}

/// The seconds since 1970, now.
pub fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// `n` random bytes.
pub fn random<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    // aws-lc-rs's generator fails only where the system has none, which no
    // platform Studio runs on lacks; the bytes would then be zero, and the
    // handshake still pins the host.
    let _ = aws_lc_rs::rand::fill(&mut out);
    out
}

/// `bytes` in hexadecimal, lower case.
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut out, b| {
        let _ = write!(out, "{b:02x}"); // A String takes every write.
        out
    })
}

impl Invite {
    /// The invitation's code.
    pub fn code(&self) -> String {
        format!("{PREFIX}{}", base64::encode(serde_json::to_string(self).unwrap_or_default().as_bytes()))
    }

    /// The invitation's link, which opens Studio's join dialog filled in.
    pub fn link(&self) -> String {
        format!("{LINK_PREFIX}{}", self.code().trim_start_matches(PREFIX))
    }

    /// The invitation of `link`, checked as `read` checks a code: a link
    /// of Studio's scheme to join, of the one parameter `code` and nothing
    /// more, so no link carries SQL, data or settings.
    ///
    /// # Errors
    ///
    /// Of a link that is not an invitation's, or carries more, or of an
    /// invitation `read` refuses.
    pub fn read_link(link: &str) -> Result<Invite> {
        let link = link.trim();
        if link.len() > MAX_CODE_BYTES.saturating_add(LINK_PREFIX.len()) {
            return Err(refused("the invitation is too long"));
        }
        let Some(body) = link.strip_prefix(LINK_PREFIX) else {
            return Err(refused("this is not a Studio invitation's link: it begins turborel-studio://join?code="));
        };
        if body.contains(['&', '#', '?', '=', '/']) {
            return Err(refused("the link carries more than its invitation, and is refused"));
        }
        Invite::read(body)
    }

    /// The invitation of `code`, checked: of this format, unexpired, of a
    /// fingerprint, and of no more than eight addresses.
    ///
    /// # Errors
    ///
    /// Of a code that is not an invitation, or of one expired.
    pub fn read(code: &str) -> Result<Invite> {
        let code = code.trim();
        let body = code.strip_prefix(PREFIX).unwrap_or(code);
        if body.len() > MAX_CODE_BYTES {
            return Err(refused("the invitation is too long"));
        }
        let bytes = base64::decode(body).ok_or_else(|| refused("this is not an invitation's code"))?;
        let invite: Invite = serde_json::from_slice(&bytes).map_err(|_| refused("this is not an invitation's code"))?;
        if invite.version != VERSION {
            return Err(refused(format!("an invitation of format {} is not read", invite.version)));
        }
        if invite.expires < now() {
            return Err(refused("the invitation has expired: ask for another"));
        }
        if invite.direct.len() > MAX_ADDRESSES || (invite.direct.is_empty() && invite.relay.is_none()) {
            return Err(refused("the invitation names no address to reach the host by"));
        }
        invite.pin()?;
        Ok(invite)
    }

    /// The host's fingerprint.
    ///
    /// # Errors
    ///
    /// Of one that is not 32 bytes of hexadecimal.
    pub fn pin(&self) -> Result<Fingerprint> {
        Fingerprint::parse(&self.fingerprint)
    }
}

#[cfg(test)]
mod tests {
    use super::{Invite, LINK_PREFIX, PREFIX, RelaySpec, VERSION, hex, now, random};
    use crate::base64;

    /// An invitation of `expires`.
    fn invite(expires: u64) -> Invite {
        Invite {
            version: VERSION,
            session: hex(&random::<16>()),
            fingerprint: "AB".repeat(32),
            secret: base64::encode(&random::<32>()),
            expires,
            direct: vec!["127.0.0.1:4500".into()],
            relay: Some(RelaySpec { address: "relay.example:4433".into(), fingerprint: "CD".repeat(32) }),
        }
    }

    /// [DESIGN] D56: a code is read back whole, with or without its prefix;
    /// one expired, of another format, tampered, too long, of no address or
    /// no fingerprint is refused.
    #[test]
    fn a_code_is_read_back_and_checked() {
        let made = invite(now().saturating_add(600));
        let code = made.code();
        assert!(code.starts_with(PREFIX));
        assert_eq!(Invite::read(&code).unwrap(), made);
        assert_eq!(Invite::read(&format!("  {}\n", code.trim_start_matches(PREFIX))).unwrap(), made);
        assert!(Invite::read(&invite(now().saturating_sub(1)).code()).unwrap_err().0.contains("expired"));
        assert!(Invite::read(&Invite { version: 2, ..made.clone() }.code()).unwrap_err().0.contains("format 2"));
        assert!(Invite::read(&format!("{code}x")).is_err());
        assert!(Invite::read("turborel-live:!!").is_err());
        assert!(Invite::read(&"A".repeat(5000)).unwrap_err().0.contains("too long"));
        assert!(Invite::read(&Invite { direct: vec![], relay: None, ..made.clone() }.code()).unwrap_err().0.contains("no address"));
        assert!(Invite::read(&Invite { fingerprint: "AB".into(), ..made }.code()).is_err());
        assert_eq!(hex(&[0, 255]), "00ff");
    }

    /// [DESIGN] D66: a link is the code's base64 after Studio's scheme,
    /// read back whole; one of another scheme or action, of another
    /// parameter, a fragment, or a parameter more, is refused, and one
    /// expired as its code is.
    #[test]
    fn a_link_is_read_back_and_carries_nothing_more() {
        let made = invite(now().saturating_add(600));
        let link = made.link();
        assert!(link.starts_with(LINK_PREFIX));
        assert!(!link.contains(PREFIX));
        assert_eq!(Invite::read_link(&format!(" {link}\n")).unwrap(), made);
        for bad in [
            link.replace("turborel-studio://", "https://"),
            link.replace("join?", "run?"),
            link.replace("code=", "sql="),
            format!("{link}&sql=DROP%20TABLE%20T"),
            format!("{link}#more"),
        ] {
            assert!(Invite::read_link(&bad).is_err(), "{bad}");
        }
        assert!(Invite::read_link(&invite(now().saturating_sub(1)).link()).unwrap_err().0.contains("expired"));
        assert!(Invite::read_link(&format!("{LINK_PREFIX}{}", "A".repeat(5000))).unwrap_err().0.contains("too long"));
    }
}
