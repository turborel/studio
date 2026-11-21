//! Live Sessions' settings (RULES.md D56), in `live-sessions.json`, format
//! 1, each choice of a safe default: whether sessions are on, what each
//! environment shares, the rows a result shares and the columns masked,
//! whether viewers may copy, whether Suggest may be granted, how many
//! viewers, how long an invitation lasts, how a host is reached, and
//! whether a session may widen them.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Result, StudioError};
use crate::saved::Environment;
use crate::store::{self, FORMAT};

/// The settings' file.
pub const SETTINGS_FILE: &str = "live-sessions.json";
/// The longest the file may be, in bytes.
const MAX_FILE_BYTES: u64 = 256 * 1024;
/// The most columns masked.
const MAX_MASKED: usize = 500;
/// The longest name of a column masked, or of an address, in characters.
const MAX_NAME_CHARS: usize = 400;
/// The most addresses advertised.
const MAX_ADVERTISED: usize = 8;

/// What a connection's environment shares.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sharing {
    /// Whether its tabs are shared at all.
    pub share: bool,
    /// Whether its results' values and messages are, or its SQL and schema alone.
    pub values: bool,
}

/// What each environment shares.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Environments {
    /// Development's.
    pub development: Sharing,
    /// Test's.
    pub test: Sharing,
    /// Production's: its SQL and schema, no values, at first.
    pub production: Sharing,
}

impl Default for Environments {
    fn default() -> Environments {
        let all = Sharing { share: true, values: true };
        Environments { development: all, test: all, production: Sharing { share: true, values: false } }
    }
}

impl Environments {
    /// What `environment` shares.
    pub fn of(&self, environment: Environment) -> Sharing {
        match environment {
            Environment::Development => self.development,
            Environment::Test => self.test,
            Environment::Production => self.production,
        }
    }
}

/// How a host is reached.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct Connectivity {
    /// Whether viewers reach the presenter directly.
    pub direct: bool,
    /// The UDP port listened on directly, 0 for any.
    pub port: u16,
    /// The addresses invitations name, this machine's found if none.
    pub advertise: Vec<String>,
    /// Whether viewers reach the presenter through a relay too.
    pub relay: bool,
    /// The relay's address, `host:port`.
    pub relay_address: String,
    /// The relay's certificate's fingerprint, as `studio-relay` prints it.
    pub relay_fingerprint: String,
}

impl Default for Connectivity {
    fn default() -> Connectivity {
        Connectivity {
            direct: true,
            port: 0,
            advertise: Vec::new(),
            relay: false,
            relay_address: String::new(),
            relay_fingerprint: String::new(),
        }
    }
}

/// Live Sessions' settings.
#[expect(clippy::struct_excessive_bools, reason = "a settings file's switches, each a choice its page shows apart")]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct LiveSettings {
    /// The file's format.
    pub format: u32,
    /// Whether sessions may be presented and joined.
    pub enabled: bool,
    /// The name others see, as the presenter or a viewer.
    pub name: String,
    /// What each environment shares.
    pub environments: Environments,
    /// The most rows of a result shared.
    pub row_limit: u32,
    /// The columns whose values are masked, by name.
    pub masked_columns: Vec<String>,
    /// Whether viewers may copy text out of what they see.
    pub allow_copy: bool,
    /// Whether a viewer may be granted Suggest.
    pub allow_suggest: bool,
    /// The most viewers at once.
    pub max_viewers: u32,
    /// The minutes an invitation lasts.
    pub invite_minutes: u32,
    /// How a host is reached.
    pub connectivity: Connectivity,
    /// Whether a session may not widen these settings.
    pub locked: bool,
}

impl Default for LiveSettings {
    fn default() -> LiveSettings {
        LiveSettings {
            format: FORMAT,
            enabled: true,
            name: String::new(),
            environments: Environments::default(),
            row_limit: 100,
            masked_columns: Vec::new(),
            allow_copy: false,
            allow_suggest: true,
            max_viewers: 10,
            invite_minutes: 10,
            connectivity: Connectivity::default(),
            locked: false,
        }
    }
}

/// The bounds of each number, least and most.
const BOUNDS: [(&str, u32, u32); 3] = [("rows shared", 1, 10_000), ("viewers", 1, 64), ("minutes an invitation lasts", 1, 60)];

/// Whether `text` is of 1 to `MAX_NAME_CHARS` characters, none control.
fn fits(text: &str) -> bool {
    let count = text.chars().count();
    (1..=MAX_NAME_CHARS).contains(&count) && !text.chars().any(char::is_control)
}

impl LiveSettings {
    /// Checks the settings' bounds.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of a number out of its bounds, a list too long, a name
    /// that does not fit, neither way to be reached, or a relay of no
    /// address or fingerprint.
    pub fn validate(&self) -> Result<()> {
        for ((what, low, high), value) in BOUNDS.iter().zip([self.row_limit, self.max_viewers, self.invite_minutes]) {
            if value < *low || value > *high {
                return Err(StudioError::misuse(format!("[DESIGN] the {what} are from {low} to {high}")));
            }
        }
        if self.masked_columns.len() > MAX_MASKED || !self.masked_columns.iter().all(|c| fits(c)) {
            return Err(StudioError::misuse("[DESIGN] at most 500 columns are masked, each named in 1 to 400 characters"));
        }
        if !self.name.is_empty() && !turborel_studio_live::host::named(&self.name) {
            return Err(StudioError::misuse("[DESIGN] a name is 1 to 64 characters"));
        }
        let c = &self.connectivity;
        if !c.direct && !c.relay {
            return Err(StudioError::misuse("[DESIGN] a session is reached directly, through a relay, or both"));
        }
        if c.advertise.len() > MAX_ADVERTISED || c.advertise.iter().any(|a| a.parse::<std::net::IpAddr>().is_err()) {
            return Err(StudioError::misuse("[DESIGN] at most 8 addresses are advertised, each an IP address"));
        }
        if c.relay && (!fits(&c.relay_address) || turborel_studio_live::cert::Fingerprint::parse(&c.relay_fingerprint).is_err()) {
            return Err(StudioError::misuse(
                "[DESIGN] a relay is named by its address and its certificate's fingerprint, as studio-relay prints them",
            ));
        }
        Ok(())
    }

    /// Whether `wider`'s choices for a session are no wider than these.
    pub fn allows(&self, wider: &SessionChoices) -> bool {
        !self.locked
            || (wider.row_limit <= self.row_limit
                && (!wider.copy || self.allow_copy)
                && (!wider.production_values || self.environments.production.values))
    }
}

/// What a presenter chooses of a session, within the settings where they are locked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionChoices {
    /// The most rows of a result shared.
    pub row_limit: u32,
    /// Whether viewers may copy.
    pub copy: bool,
    /// Whether production's values are shared.
    pub production_values: bool,
}

impl SessionChoices {
    /// The choices the settings give a session to begin with.
    pub fn of(settings: &LiveSettings) -> SessionChoices {
        SessionChoices {
            row_limit: settings.row_limit,
            copy: settings.allow_copy,
            production_values: settings.environments.production.values,
        }
    }
}

/// The settings, in a directory of the user's own.
#[derive(Debug, Clone)]
pub struct Settings {
    path: PathBuf,
}

impl Settings {
    /// The settings kept in `dir`.
    pub fn new(dir: &Path) -> Settings {
        Settings { path: dir.join(SETTINGS_FILE) }
    }

    /// The settings, as kept, or the defaults.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the file cannot be read.
    pub fn read(&self) -> Result<LiveSettings> {
        Ok(store::read::<LiveSettings>(&self.path, MAX_FILE_BYTES)?.unwrap_or_default())
    }

    /// Keeps `settings`.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of settings out of their bounds, or a file that cannot
    /// be written.
    pub fn keep(&self, settings: &LiveSettings) -> Result<()> {
        settings.validate()?;
        store::write(&self.path, settings)
    }
}

#[cfg(test)]
mod tests;
