//! Secrets kept in the operating system's keychain (RULES.md R-SEC-1, D16):
//! the macOS Keychain, the Windows Credential Manager, or the Secret
//! Service on Linux and the other Unix systems, each through keyring-core
//! and the platform's own store, passed explicitly so no global store is
//! set (R-SAFE-4). The backend alone reads a secret; the front end is told
//! only whether one is kept.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use crate::error::{Result, StudioError};
use crate::secret::Secret;

/// The service every secret of Studio's is kept under.
pub const SERVICE: &str = "com.turborel.studio";

/// Where secrets are kept.
pub trait SecretStore: Send + Sync {
    /// Keeps `secret` as `key`, replacing any kept.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the store refuses it.
    fn set(&self, key: &str, secret: &Secret) -> Result<()>;
    /// The secret kept as `key`, if one is.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the store cannot be read.
    fn get(&self, key: &str) -> Result<Option<Secret>>;
    /// Forgets the secret kept as `key`, if one is.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the store refuses it.
    fn delete(&self, key: &str) -> Result<()>;
}

/// A keychain's failure, as Studio's error, never holding the secret.
fn failed(what: &str, e: &keyring_core::Error) -> StudioError {
    StudioError::misuse(format!("[DESIGN] the keychain cannot {what}: {e}"))
}

/// The operating system's keychain.
pub struct Keychain {
    store: Arc<keyring_core::CredentialStore>,
}

impl std::fmt::Debug for Keychain {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Keychain").finish_non_exhaustive()
    }
}

impl Keychain {
    /// The platform's keychain.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the platform has none, or it cannot be opened: on
    /// Linux, no Secret Service is running.
    pub fn open() -> Result<Keychain> {
        Ok(Keychain { store: platform_store()? })
    }

    /// The entry of `key`.
    fn entry(&self, key: &str) -> Result<keyring_core::Entry> {
        keyring_core::Entry::new_in_store(&self.store, SERVICE, key).map_err(|e| failed("name an entry", &e))
    }
}

/// The macOS Keychain.
#[cfg(target_os = "macos")]
fn platform_store() -> Result<Arc<keyring_core::CredentialStore>> {
    let store = apple_native_keyring_store::keychain::Store::new().map_err(|e| failed("open", &e))?;
    Ok(store)
}

/// The Windows Credential Manager.
#[cfg(target_os = "windows")]
fn platform_store() -> Result<Arc<keyring_core::CredentialStore>> {
    let store = windows_native_keyring_store::Store::new().map_err(|e| failed("open", &e))?;
    Ok(store)
}

/// The Secret Service.
#[cfg(all(unix, not(target_os = "macos")))]
fn platform_store() -> Result<Arc<keyring_core::CredentialStore>> {
    let store = zbus_secret_service_keyring_store::Store::new().map_err(|e| failed("open", &e))?;
    Ok(store)
}

/// None: refused, as this platform has no keychain Studio knows (R-PLAT-2).
#[cfg(not(any(unix, windows)))]
fn platform_store() -> Result<Arc<keyring_core::CredentialStore>> {
    Err(StudioError::misuse("[DESIGN] this platform has no keychain Studio can keep a secret in"))
}

impl SecretStore for Keychain {
    fn set(&self, key: &str, secret: &Secret) -> Result<()> {
        self.entry(key)?.set_password(secret.expose()).map_err(|e| failed("keep a secret", &e))
    }

    fn get(&self, key: &str) -> Result<Option<Secret>> {
        match self.entry(key)?.get_password() {
            Ok(text) => Ok(Some(Secret::new(text))),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(e) => Err(failed("read a secret", &e)),
        }
    }

    fn delete(&self, key: &str) -> Result<()> {
        match self.entry(key)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(e) => Err(failed("forget a secret", &e)),
        }
    }
}

/// Secrets kept in memory, for tests, and where the platform has no
/// keychain open: none outlives the process.
#[derive(Debug, Default)]
pub struct MemorySecrets(Mutex<BTreeMap<String, Secret>>);

impl SecretStore for MemorySecrets {
    fn set(&self, key: &str, secret: &Secret) -> Result<()> {
        self.0.lock().map_err(|_| StudioError::misuse("[DESIGN] the secrets are poisoned"))?.insert(key.to_owned(), secret.clone());
        Ok(())
    }

    fn get(&self, key: &str) -> Result<Option<Secret>> {
        Ok(self.0.lock().map_err(|_| StudioError::misuse("[DESIGN] the secrets are poisoned"))?.get(key).cloned())
    }

    fn delete(&self, key: &str) -> Result<()> {
        self.0.lock().map_err(|_| StudioError::misuse("[DESIGN] the secrets are poisoned"))?.remove(key);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{MemorySecrets, SecretStore};
    use crate::secret::Secret;

    /// [RULE] R-SEC-1: a secret kept is read back, replaced, and forgotten.
    #[test]
    fn secrets_are_kept_and_forgotten() {
        let secrets = MemorySecrets::default();
        assert_eq!(secrets.get("connection:1").unwrap(), None);
        secrets.set("connection:1", &Secret::new("first")).unwrap();
        secrets.set("connection:1", &Secret::new("second")).unwrap();
        assert_eq!(secrets.get("connection:1").unwrap().unwrap().expose(), "second");
        secrets.delete("connection:1").unwrap();
        secrets.delete("connection:1").unwrap();
        assert_eq!(secrets.get("connection:1").unwrap(), None);
    }
}

/// The variable that runs the test of the platform's own keychain, set and
/// not empty: it writes to the user's keychain, so it runs only where a
/// person, or CI, asks.
#[cfg(test)]
const KEYCHAIN_VARIABLE: &str = "STUDIO_TEST_KEYCHAIN";

/// [RULE] R-SEC-1 [DESIGN] D16: the platform's keychain keeps, gives back and
/// forgets a secret. Run where `STUDIO_TEST_KEYCHAIN` is set, as it
/// touches the user's own keychain; skipped otherwise.
#[cfg(test)]
#[test]
fn the_platforms_keychain_keeps_a_secret() {
    if std::env::var(KEYCHAIN_VARIABLE).map_or(true, |set| set.is_empty()) {
        return;
    }
    let keychain = Keychain::open().unwrap();
    let key = "test:studio-keychain";
    keychain.set(key, &Secret::new("kept")).unwrap();
    assert_eq!(keychain.get(key).unwrap().unwrap().expose(), "kept");
    keychain.delete(key).unwrap();
    assert_eq!(keychain.get(key).unwrap(), None);
}
