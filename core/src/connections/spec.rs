//! A connection's settings, as the connection dialog gives them, and the
//! turborel-client `Settings` they resolve to (`[CLIENT Connecting by
//! settings]`): a URI, the dialog's fields over it, then a service, the
//! environment, Studio's defaults and the client's.
//!
//! Studio's defaults (CONFORMANCE.md S-IMPL-6, S-IMPL-7; RULES.md R-SEC-3):
//! TLS `verify-full`, below every layer that names a mode, trusting the
//! platform's authorities where the settings trust none; and the
//! application's name, Turborel Studio.

use serde::{Deserialize, Serialize};
use turborel_client::settings::{
    APPLICATION_NAME, CHANNEL_BINDING, CONNECT_TIMEOUT, HOST, LOAD_BALANCE, Options, PASSFILE, PASSWORD, PORT, SERVER_NAME, SERVICE,
    SERVICE_FILE, Settings, TARGET, TLS_CERTIFICATE, TLS_KEY, TLS_MODE, TLS_ROOTS, TLS_SYSTEM_ROOTS, USER,
};

use crate::error::{Result, StudioError};
use crate::secret::Secret;

/// The longest text of a setting Studio takes, in bytes: the longest a
/// server takes of its own settings' texts.
pub const MAX_SETTING_BYTES: usize = 1024;
/// The longest connection URI Studio takes, in bytes: room for several
/// hosts and every setting.
pub const MAX_URI_BYTES: usize = 8192;
/// The longest password Studio takes, in bytes.
pub const MAX_PASSWORD_BYTES: usize = 1024;
/// The name Studio tells the server it has (S-IMPL-7).
pub const APPLICATION: &str = "Turborel Studio";
/// The environment's variable of the TLS mode
/// (`[CLIENT Where settings come from]`).
pub const TLS_MODE_VARIABLE: &str = "TURBOREL_TLS_MODE";
/// Studio's TLS mode where no layer names one (S-IMPL-6).
pub const DEFAULT_TLS_MODE: &str = "verify-full";

/// A connection's settings, as the dialog fills them: a URI, or fields,
/// or both, the fields over the URI. Each field is a setting of
/// turborel-client's, by its name. It holds no password (R-SEC-1).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionSpec {
    /// A connection URI, `turborel://…`.
    pub uri: Option<String>,
    /// `host`: the servers, comma-separated.
    pub host: Option<String>,
    /// `port`.
    pub port: Option<String>,
    /// `user`.
    pub user: Option<String>,
    /// `tls_mode`.
    pub tls_mode: Option<String>,
    /// `channel_binding`.
    pub channel_binding: Option<String>,
    /// `connect_timeout`, in whole seconds.
    pub connect_timeout: Option<String>,
    /// `service`.
    pub service: Option<String>,
    /// `service_file`.
    pub service_file: Option<String>,
    /// `passfile`.
    pub passfile: Option<String>,
    /// `target`.
    pub target: Option<String>,
    /// `load_balance`.
    pub load_balance: Option<String>,
    /// `tls_roots`.
    pub tls_roots: Option<String>,
    /// `tls_system_roots`.
    pub tls_system_roots: Option<String>,
    /// `tls_certificate`.
    pub tls_certificate: Option<String>,
    /// `tls_key`.
    pub tls_key: Option<String>,
    /// `server_name`.
    pub server_name: Option<String>,
}

impl ConnectionSpec {
    /// Each field with the setting it is, in the order of turborel-client's
    /// table.
    fn fields(&self) -> [(&'static str, Option<&String>); 16] {
        [
            (HOST, self.host.as_ref()),
            (PORT, self.port.as_ref()),
            (USER, self.user.as_ref()),
            (TLS_MODE, self.tls_mode.as_ref()),
            (CHANNEL_BINDING, self.channel_binding.as_ref()),
            (CONNECT_TIMEOUT, self.connect_timeout.as_ref()),
            (SERVICE, self.service.as_ref()),
            (SERVICE_FILE, self.service_file.as_ref()),
            (PASSFILE, self.passfile.as_ref()),
            (TARGET, self.target.as_ref()),
            (LOAD_BALANCE, self.load_balance.as_ref()),
            (TLS_ROOTS, self.tls_roots.as_ref()),
            (TLS_SYSTEM_ROOTS, self.tls_system_roots.as_ref()),
            (TLS_CERTIFICATE, self.tls_certificate.as_ref()),
            (TLS_KEY, self.tls_key.as_ref()),
            (SERVER_NAME, self.server_name.as_ref()),
        ]
    }

    /// Checks every field is within its bounds (R-SEC-6): no NUL, no field
    /// longer than `MAX_SETTING_BYTES`, no URI longer than `MAX_URI_BYTES`.
    ///
    /// # Errors
    ///
    /// SQLCODE -910, SQLSTATE TB910, naming the field.
    pub fn validate(&self) -> Result<()> {
        if let Some(uri) = &self.uri {
            bounded("uri", uri, MAX_URI_BYTES)?;
        }
        for (name, value) in self.fields() {
            if let Some(value) = value {
                bounded(name, value, MAX_SETTING_BYTES)?;
            }
        }
        Ok(())
    }

    /// The client's options of these settings, the URI's first, each field
    /// over it, and the password given, if any; and the application's
    /// name unless a layer names one.
    ///
    /// # Errors
    ///
    /// A field out of its bounds (`validate`); SQLSTATE 08001 for a URI or
    /// a setting turborel-client cannot read.
    pub fn options(&self, password: Option<&Secret>) -> Result<Options> {
        self.validate()?;
        let mut options = match &self.uri {
            Some(uri) => Options::from_uri(uri)?,
            None => Options::new(),
        };
        for (name, value) in self.fields() {
            if let Some(value) = value.filter(|v| !v.is_empty()) {
                options.set(name, value)?;
            }
        }
        if let Some(password) = password {
            bounded(PASSWORD, password.expose(), MAX_PASSWORD_BYTES)?;
            options.set(PASSWORD, password.expose())?;
        }
        if options.get(APPLICATION_NAME).is_none() {
            options.set(APPLICATION_NAME, APPLICATION)?;
        }
        Ok(options)
    }

    /// The settings these resolve to, the environment read by `variable`,
    /// with Studio's defaults below every layer that names its own.
    ///
    /// # Errors
    ///
    /// As `options`; SQLSTATE 08001 for settings that name no user, or a
    /// service that cannot be read.
    pub fn resolve(&self, password: Option<&Secret>, variable: impl Fn(&str) -> Option<String>) -> Result<Settings> {
        let options = self.options(password)?;
        let mut settings = Settings::resolve_in(&options, |name| {
            variable(name).or_else(|| (name == TLS_MODE_VARIABLE).then(|| DEFAULT_TLS_MODE.to_owned()))
        })?;
        if settings.tls_mode.verifies() && settings.tls.roots.is_none() {
            settings.tls.system_roots = true;
        }
        Ok(settings)
    }
}

/// `value` of the setting `name`, refused if longer than `max` bytes or
/// holding a NUL.
fn bounded(name: &str, value: &str, max: usize) -> Result<()> {
    if value.len() > max {
        return Err(StudioError::misuse(format!("[DESIGN] {name} is longer than {max} bytes")));
    }
    if value.contains('\0') {
        return Err(StudioError::misuse(format!("[DESIGN] {name} holds a NUL character")));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
