//! The checks tool's failures: each a message saying what failed and where.

use std::fmt;

/// A check that failed, or a step that could not run.
#[derive(Debug)]
pub struct Error(pub String);

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Error {
        Error(error.to_string())
    }
}

/// The checks tool's results.
pub type Result<T> = std::result::Result<T, Error>;

/// A failure of `what`.
pub fn fail<T>(what: impl Into<String>) -> Result<T> {
    Err(Error(what.into()))
}
