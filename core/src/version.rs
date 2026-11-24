//! The release Studio is made for, and the Turborel commit its client
//! library is built from (RULES.md D5, D10).

use serde::Serialize;

/// Studio's version: the Turborel release it is made for (RULES.md D5),
/// written once, in the workspace's `Cargo.toml`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The commit of Turborel's main that `turborel-client` is pinned to
/// (RULES.md D10). The workspace's `Cargo.toml` names the same commit, as a
/// test holds it to.
pub const TURBOREL_COMMIT: &str = "32e1334d37c7b4ca489491eed7b216a2d778bff1";

/// What the application tells of itself, as the About box shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// Studio's version.
    pub version: String,
    /// The Turborel commit its client library is built from.
    pub turborel_commit: String,
    /// The user's home folder, which the window writes as `~` at a path's
    /// start, as `HOME`, or `USERPROFILE` on Windows, names it; none if
    /// neither does.
    pub home: Option<String>,
}

/// This build's `AppInfo`.
pub fn app_info() -> AppInfo {
    let home = ["HOME", "USERPROFILE"].iter().find_map(|name| std::env::var(name).ok().filter(|v| !v.is_empty()));
    AppInfo { version: VERSION.to_owned(), turborel_commit: TURBOREL_COMMIT.to_owned(), home }
}

#[cfg(test)]
mod tests;
