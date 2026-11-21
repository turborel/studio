//! The assistant's settings (RULES.md D55), in `assistant.json`, format 1:
//! whether it is on, and its model, Claude built in or the user's own; the
//! keys kept in the keychain alone, the window told only whether one is
//! saved.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::assistant::http::{Endpoint, checked};
use crate::assistant::wire::Wire;
use crate::error::{Result, StudioError};
use crate::secret::Secret;
use crate::secrets::SecretStore;
use crate::store::{self, FORMAT};

/// The settings' file.
pub const SETTINGS_FILE: &str = "assistant.json";
/// The longest the file may be, in bytes.
const MAX_FILE_BYTES: u64 = 64 * 1024;
/// Claude's endpoint.
pub const CLAUDE_URL: &str = "https://api.anthropic.com";
/// Claude's models to choose of, the first the default; its model may be any written.
pub const CLAUDE_MODELS: [&str; 3] = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
/// The longest name or URL, in characters.
const MAX_CHARS: usize = 2000;
/// The keychain's key of Claude's key.
const CLAUDE_KEY: &str = "assistant:claude";
/// The keychain's key of the user's own model's key.
const OWN_KEY: &str = "assistant:own";

/// The model the assistant asks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Provider {
    /// Claude, built in.
    Claude,
    /// The user's own model.
    Own,
}

/// The user's own model: its endpoint, model, wire format, and whether it
/// calls tools.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct OwnModel {
    /// Its base URL.
    pub base_url: String,
    /// Its model's name.
    pub model: String,
    /// Its wire format.
    pub wire: Wire,
    /// Whether it calls tools: one that calls none answers questions alone.
    pub tools: bool,
}

impl Default for OwnModel {
    fn default() -> OwnModel {
        OwnModel { base_url: "http://localhost:11434".to_owned(), model: String::new(), wire: Wire::ChatCompletions, tools: true }
    }
}

/// The assistant's settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct AssistantSettings {
    /// The file's format.
    pub format: u32,
    /// Whether the assistant is on: off until the user turns it on.
    pub enabled: bool,
    /// The model it asks.
    pub provider: Provider,
    /// Claude's model.
    pub claude_model: String,
    /// The user's own model.
    pub own: OwnModel,
}

impl Default for AssistantSettings {
    fn default() -> AssistantSettings {
        AssistantSettings {
            format: FORMAT,
            enabled: false,
            provider: Provider::Claude,
            claude_model: CLAUDE_MODELS[0].to_owned(),
            own: OwnModel::default(),
        }
    }
}

impl AssistantSettings {
    /// Checks the settings' bounds.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of a model's name empty or too long, or of an endpoint
    /// of the user's own that is not of HTTPS, or of HTTP on this machine.
    pub fn validate(&self) -> Result<()> {
        let named = |n: &str| !n.is_empty() && n.chars().count() <= MAX_CHARS && !n.chars().any(char::is_control);
        if !named(&self.claude_model) {
            return Err(StudioError::misuse("[DESIGN] Claude's model is named"));
        }
        if self.provider == Provider::Own {
            if !named(&self.own.model) {
                return Err(StudioError::misuse("[DESIGN] the model is named"));
            }
            checked(&self.own.base_url)?;
        }
        Ok(())
    }

    /// Whether the model asked calls tools.
    pub fn calls_tools(&self) -> bool {
        self.provider == Provider::Claude || self.own.tools
    }

    /// The model asked.
    pub fn model(&self) -> &str {
        match self.provider {
            Provider::Claude => &self.claude_model,
            Provider::Own => &self.own.model,
        }
    }
}

/// Whether each key is saved, as the window is told.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeysSaved {
    /// Claude's.
    pub claude: bool,
    /// The user's own model's.
    pub own: bool,
}

/// The assistant's settings and keys, of a directory and a keychain.
pub struct Assistant {
    path: PathBuf,
    secrets: Arc<dyn SecretStore>,
}

impl Assistant {
    /// The settings of `dir`, their keys in `secrets`.
    pub fn new(dir: &Path, secrets: Arc<dyn SecretStore>) -> Assistant {
        Assistant { path: dir.join(SETTINGS_FILE), secrets }
    }

    /// The settings, as kept, or the defaults.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the file cannot be read.
    pub fn settings(&self) -> Result<AssistantSettings> {
        Ok(store::read::<AssistantSettings>(&self.path, MAX_FILE_BYTES)?.unwrap_or_default())
    }

    /// Keeps `settings`.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of settings out of their bounds, or a file that cannot
    /// be written.
    pub fn keep(&self, settings: &AssistantSettings) -> Result<()> {
        settings.validate()?;
        store::write(&self.path, settings)
    }

    /// The keychain's key of `provider`'s key.
    fn key_of(provider: Provider) -> &'static str {
        match provider {
            Provider::Claude => CLAUDE_KEY,
            Provider::Own => OWN_KEY,
        }
    }

    /// Keeps `key` as `provider`'s, or forgets it of none.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the keychain refuses it.
    pub fn set_key(&self, provider: Provider, key: Option<&Secret>) -> Result<()> {
        match key {
            Some(k) if !k.expose().is_empty() => self.secrets.set(Assistant::key_of(provider), k),
            _ => self.secrets.delete(Assistant::key_of(provider)),
        }
    }

    /// Whether each key is saved.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the keychain cannot be read.
    pub fn keys_saved(&self) -> Result<KeysSaved> {
        Ok(KeysSaved { claude: self.secrets.get(CLAUDE_KEY)?.is_some(), own: self.secrets.get(OWN_KEY)?.is_some() })
    }

    /// The endpoint `settings` ask, with its key.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 of Claude of no key, an endpoint refused, or a keychain
    /// that cannot be read.
    pub fn endpoint(&self, settings: &AssistantSettings) -> Result<Endpoint> {
        let key = self.secrets.get(Assistant::key_of(settings.provider))?;
        match settings.provider {
            Provider::Claude => {
                let key =
                    key.ok_or_else(|| StudioError::misuse("[DESIGN] Claude's key is not saved: save it in the assistant's settings"))?;
                Ok(Endpoint { base: CLAUDE_URL.to_owned(), wire: Wire::Anthropic, claude: true, key: Some(key) })
            }
            Provider::Own => Ok(Endpoint { base: checked(&settings.own.base_url)?, wire: settings.own.wire, claude: false, key }),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::{Assistant, AssistantSettings, OwnModel, Provider};
    use crate::assistant::wire::Wire;
    use crate::secret::Secret;
    use crate::secrets::MemorySecrets;

    /// [DESIGN] D55: the settings start off, of Claude's default model;
    /// they are kept, checked, and the keys kept in the keychain, the
    /// window told only whether each is saved.
    #[test]
    fn settings_and_keys_are_kept() {
        let dir = crate::testing::scratch("assistant/settings");
        let assistant = Assistant::new(&dir, Arc::new(MemorySecrets::default()));
        let first = assistant.settings().unwrap();
        assert!(!first.enabled);
        assert_eq!((first.model(), first.calls_tools()), ("claude-opus-5-5", true));
        assert!(assistant.endpoint(&first).unwrap_err().message.contains("key is not saved"));
        assistant.set_key(Provider::Claude, Some(&Secret::new("sk"))).unwrap();
        let claude = assistant.endpoint(&first).unwrap();
        assert_eq!((claude.wire, claude.claude, claude.base.as_str()), (Wire::Anthropic, true, "https://api.anthropic.com"));
        let own = AssistantSettings {
            enabled: true,
            provider: Provider::Own,
            own: OwnModel { model: "local-model".into(), tools: false, ..OwnModel::default() },
            ..first.clone()
        };
        assistant.keep(&own).unwrap();
        assert_eq!(assistant.settings().unwrap(), own);
        assert_eq!((own.model(), own.calls_tools()), ("local-model", false));
        let endpoint = assistant.endpoint(&own).unwrap();
        assert!(endpoint.key.is_none() && !endpoint.claude);
        assert!(assistant.keys_saved().unwrap().claude && !assistant.keys_saved().unwrap().own);
        assistant.set_key(Provider::Claude, None).unwrap();
        assistant.set_key(Provider::Own, Some(&Secret::new(""))).unwrap();
        assert!(!assistant.keys_saved().unwrap().claude);
        for bad in [
            AssistantSettings { claude_model: String::new(), ..first.clone() },
            AssistantSettings {
                own: OwnModel { model: "m".into(), base_url: "http://models.example".into(), ..OwnModel::default() },
                ..own.clone()
            },
            AssistantSettings { own: OwnModel { model: String::new(), ..OwnModel::default() }, ..own.clone() },
        ] {
            assert!(assistant.keep(&bad).is_err());
        }
    }

    /// [STUDIO assistant.json]: the manual's example is read.
    #[test]
    fn the_manuals_settings_are_read() {
        let dir = crate::testing::scratch("assistant/manual-settings");
        std::fs::write(dir.join(super::SETTINGS_FILE), crate::testing::manual_json("appendix/d-files.md", "assistant.json")).unwrap();
        let read = Assistant::new(&dir, Arc::new(MemorySecrets::default())).settings().unwrap();
        assert!(read.enabled);
        assert_eq!((read.provider, read.own.wire, read.model()), (Provider::Own, Wire::ChatCompletions, "local-model"));
        read.validate().unwrap();
    }
}
