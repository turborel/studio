//! Turborel Studio's Live Sessions (RULES.md D56): a presenter's workspace
//! shown live to viewers in their own Studio, end to end encrypted.
//!
//! A host makes a session: a certificate of its own, made as it starts,
//! whose fingerprint each one-time invitation carries with the session's
//! identifier, a secret and the addresses to reach it by. A guest reaches
//! the host directly over QUIC, TLS 1.3 pinned to that fingerprint, or
//! through a relay, a QUIC server that pairs the two and passes only the
//! bytes of a TLS 1.3 session of their own, pinned the same way, so the
//! relay reads nothing. Both sides show a safety code drawn from the TLS
//! session's keys, which the host compares before it admits the guest by
//! name. Frames are JSON, each its length first.
//!
//! The crate knows nothing of what a workspace holds: the host and guest
//! pass its state as JSON, which Studio's backend makes and filters.

pub mod base64;
pub mod cert;
pub mod error;
pub mod frame;
pub mod guest;
pub mod host;
pub mod invite;
pub mod relay;
pub mod transport;
pub mod wire;
