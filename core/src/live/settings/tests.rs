//! Live Sessions' settings: their safe defaults, bounds, and locking.

use super::{Connectivity, LiveSettings, SessionChoices, Settings};
use crate::saved::Environment;

/// [DESIGN] D56: sessions start on, reached directly; production shares its
/// SQL and schema alone; no viewer copies; Suggest may be granted; ten
/// viewers; invitations of ten minutes; nothing locked.
#[test]
fn the_defaults_are_safe() {
    let first = LiveSettings::default();
    assert!(first.enabled && !first.allow_copy && first.allow_suggest && !first.locked);
    assert!(first.environments.of(Environment::Development).values);
    assert!(first.environments.of(Environment::Test).values);
    let production = first.environments.of(Environment::Production);
    assert!(production.share && !production.values);
    assert_eq!((first.row_limit, first.max_viewers, first.invite_minutes), (100, 10, 10));
    assert!(first.connectivity.direct && !first.connectivity.relay);
    first.validate().unwrap();
}

/// [DESIGN] D56: each bound is checked.
#[test]
fn the_bounds_are_checked() {
    let ok = LiveSettings::default();
    for bad in [
        LiveSettings { row_limit: 0, ..ok.clone() },
        LiveSettings { max_viewers: 65, ..ok.clone() },
        LiveSettings { invite_minutes: 61, ..ok.clone() },
        LiveSettings { masked_columns: vec![String::new()], ..ok.clone() },
        LiveSettings { name: "a\u{7}b".into(), ..ok.clone() },
        LiveSettings { connectivity: Connectivity { direct: false, ..Connectivity::default() }, ..ok.clone() },
        LiveSettings { connectivity: Connectivity { advertise: vec!["host".into()], ..Connectivity::default() }, ..ok.clone() },
        LiveSettings {
            connectivity: Connectivity { relay: true, relay_address: "relay:4433".into(), ..Connectivity::default() },
            ..ok.clone()
        },
    ] {
        assert!(bad.validate().is_err(), "{bad:?}");
    }
    let relayed =
        Connectivity { relay: true, relay_address: "relay:4433".into(), relay_fingerprint: "AB".repeat(32), ..Connectivity::default() };
    LiveSettings { connectivity: relayed, name: "Ann".into(), ..ok }.validate().unwrap();
}

/// [DESIGN] D56: locked settings let a session narrow them, never widen them.
#[test]
fn locked_settings_are_not_widened() {
    let open = LiveSettings::default();
    let wide = SessionChoices { row_limit: 5000, copy: true, production_values: true };
    assert!(open.allows(&wide));
    let locked = LiveSettings { locked: true, ..open };
    assert!(!locked.allows(&wide));
    assert!(locked.allows(&SessionChoices::of(&locked)));
    assert!(locked.allows(&SessionChoices { row_limit: 10, ..SessionChoices::of(&locked) }));
    assert!(!locked.allows(&SessionChoices { copy: true, ..SessionChoices::of(&locked) }));
    assert!(!locked.allows(&SessionChoices { production_values: true, ..SessionChoices::of(&locked) }));
}

/// [DESIGN] D56: the settings are kept and read back; out of bounds, not kept.
#[test]
fn the_settings_are_kept() {
    let dir = crate::testing::scratch("live/settings");
    let settings = Settings::new(&dir);
    assert_eq!(settings.read().unwrap(), LiveSettings::default());
    let mine = LiveSettings { name: "Ann".into(), masked_columns: vec!["SALARY".into()], ..LiveSettings::default() };
    settings.keep(&mine).unwrap();
    assert_eq!(settings.read().unwrap(), mine);
    assert!(settings.keep(&LiveSettings { row_limit: 0, ..mine }).is_err());
}

/// [STUDIO live-sessions.json]: the manual's example is read and fits its bounds.
#[test]
fn the_manuals_settings_are_read() {
    let dir = crate::testing::scratch("live/manual");
    std::fs::write(dir.join(super::SETTINGS_FILE), crate::testing::manual_json("appendix/d-files.md", "live-sessions.json")).unwrap();
    let read = Settings::new(&dir).read().unwrap();
    assert_eq!(read.name, "Ann");
    read.validate().unwrap();
}
