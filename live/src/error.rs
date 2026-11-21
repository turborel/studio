//! The live crate's failures: each a sentence a person reads.

use std::fmt;

/// A failure of a live session, in words.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveError(pub String);

impl fmt::Display for LiveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for LiveError {}

/// A result of the live crate.
pub type Result<T> = std::result::Result<T, LiveError>;

/// A failure of `what`, for `why`.
pub fn failed(what: &str, why: impl fmt::Display) -> LiveError {
    LiveError(format!("{what}: {why}"))
}

/// A failure, `why`.
pub fn refused(why: impl Into<String>) -> LiveError {
    LiveError(why.into())
}
