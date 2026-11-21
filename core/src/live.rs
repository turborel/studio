//! Live Sessions in Studio's backend (RULES.md D56): the settings, the
//! workspace a presenter shares, filtered as they say before it leaves,
//! the log, and the sessions themselves, hosted or joined, on a runtime of
//! their own. The network's part is `turborel-studio-live`'s.

pub mod audit;
pub mod service;
pub mod settings;
pub mod share;
