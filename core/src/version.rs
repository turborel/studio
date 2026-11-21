//! The release Studio is made for, and the Turborel commit its client
//! library is built from (RULES.md D5, D10).

use serde::Serialize;

/// Studio's version: the Turborel release it is made for (RULES.md D5),
/// written once, in the workspace's `Cargo.toml`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The commit of Turborel's main that `turborel-client` is pinned to
/// (RULES.md D10). The workspace's `Cargo.toml` names the same commit, as a
/// test holds it to.
pub const TURBOREL_COMMIT: &str = "406f617b6288665b75b7b68ffec3fe632f09207d";

/// What the application tells of itself, as the About box shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// Studio's version.
    pub version: String,
    /// The Turborel commit its client library is built from.
    pub turborel_commit: String,
}

/// This build's `AppInfo`.
pub fn app_info() -> AppInfo {
    AppInfo { version: VERSION.to_owned(), turborel_commit: TURBOREL_COMMIT.to_owned() }
}

#[cfg(test)]
mod tests;
