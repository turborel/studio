//! A connection's settings resolved as turborel-client lays them, with
//! Studio's defaults below.

use turborel_client::settings::{Host, TlsMode};

use super::{APPLICATION, ConnectionSpec, MAX_SETTING_BYTES};
use crate::error::MISUSE_SQLSTATE;
use crate::secret::Secret;

/// No environment at all.
fn none(_: &str) -> Option<String> {
    None
}

/// [CLIENT The connection URI] The URI's hosts, user and settings are read
/// as turborel-client reads them, and the dialog's fields override them.
#[test]
fn fields_override_the_uri() {
    let spec = ConnectionSpec {
        uri: Some("turborel://ann@db1.example:7000,db2.example/?tls_mode=require".into()),
        user: Some("bob".into()),
        ..ConnectionSpec::default()
    };
    let settings = spec.resolve(None, none).unwrap();
    assert_eq!(settings.hosts, [Host::Tcp("db1.example".into(), 7000), Host::Tcp("db2.example".into(), 7422)]);
    assert_eq!(settings.user, "bob");
    assert_eq!(settings.tls_mode, TlsMode::Require);
}

/// [DESIGN] D26 [RULE] R-SEC-3: with no layer naming a mode, TLS is
/// verify-full, trusting the platform's authorities.
#[test]
fn tls_is_verified_by_default() {
    let spec = ConnectionSpec { host: Some("db.example".into()), user: Some("ann".into()), ..ConnectionSpec::default() };
    let settings = spec.resolve(None, none).unwrap();
    assert_eq!(settings.tls_mode, TlsMode::VerifyFull);
    assert!(settings.tls.system_roots);
}

/// [CLIENT Where settings come from] The environment's mode is a layer
/// above Studio's default, and the program's own above both.
#[test]
fn the_environment_and_the_program_name_their_mode_over_the_default() {
    let spec = ConnectionSpec { user: Some("ann".into()), ..ConnectionSpec::default() };
    let env = |name: &str| (name == "TURBOREL_TLS_MODE").then(|| "disable".to_owned());
    assert_eq!(spec.resolve(None, env).unwrap().tls_mode, TlsMode::Disable);
    let explicit = ConnectionSpec { tls_mode: Some("require".into()), ..spec };
    assert_eq!(explicit.resolve(None, env).unwrap().tls_mode, TlsMode::Require);
}

/// [CLIENT TLS by mode] Authorities named are trusted alone: the
/// platform's are added only where none are named.
#[test]
fn named_authorities_are_trusted_alone() {
    let spec = ConnectionSpec { user: Some("ann".into()), tls_roots: Some("/etc/turborel/ca.pem".into()), ..ConnectionSpec::default() };
    let settings = spec.resolve(None, none).unwrap();
    assert!(!settings.tls.system_roots);
    assert_eq!(settings.tls.roots.as_deref(), Some(std::path::Path::new("/etc/turborel/ca.pem")));
}

/// [DESIGN] D26: the server is told Studio's name, unless the settings
/// name one.
#[test]
fn the_application_is_named_studio() {
    let spec = ConnectionSpec { user: Some("ann".into()), ..ConnectionSpec::default() };
    assert_eq!(spec.resolve(None, none).unwrap().application_name.as_deref(), Some(APPLICATION));
    let named = ConnectionSpec { uri: Some("turborel://ann@db/?application_name=etl".into()), ..ConnectionSpec::default() };
    assert_eq!(named.resolve(None, none).unwrap().application_name.as_deref(), Some("etl"));
}

/// [RULE] R-SEC-1: the password is the settings', and neither the
/// specification nor the settings show it.
#[test]
fn the_password_is_used_and_never_shown() {
    let spec = ConnectionSpec { user: Some("ann".into()), ..ConnectionSpec::default() };
    let settings = spec.resolve(Some(&Secret::new("ann's secret")), none).unwrap();
    assert_eq!(settings.password.as_deref(), Some("ann's secret"));
    assert!(!format!("{settings:?}{spec:?}").contains("ann's secret"));
}

/// [RULE] R-SEC-6: a field longer than its bound, or holding a NUL, is
/// refused before anything reads it.
#[test]
fn fields_out_of_bounds_are_refused() {
    let long = ConnectionSpec { host: Some("h".repeat(MAX_SETTING_BYTES + 1)), ..ConnectionSpec::default() };
    assert_eq!(long.validate().unwrap_err().sqlstate, MISUSE_SQLSTATE);
    let nul = ConnectionSpec { user: Some("a\0b".into()), ..ConnectionSpec::default() };
    assert_eq!(nul.validate().unwrap_err().sqlstate, MISUSE_SQLSTATE);
}

/// [CLIENT Where settings come from] Settings that name no user, and a
/// URI of another scheme, are refused with SQLSTATE 08001.
#[test]
fn settings_no_connection_can_be_made_by_are_refused() {
    let no_user = ConnectionSpec { host: Some("db".into()), ..ConnectionSpec::default() };
    assert_eq!(no_user.resolve(None, none).unwrap_err().sqlstate, "08001");
    let scheme = ConnectionSpec { uri: Some("http://ann@db".into()), ..ConnectionSpec::default() };
    assert_eq!(scheme.resolve(None, none).unwrap_err().sqlstate, "08001");
}

/// [RULE] R-SEC-6: the dialog's fields are taken by their names alone.
#[test]
fn unknown_fields_are_refused() {
    let json = r#"{"user": "ann", "password": "x"}"#;
    assert!(serde_json::from_str::<ConnectionSpec>(json).is_err());
}
