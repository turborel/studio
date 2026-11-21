//! Studio's settings and the dock's layout (RULES.md R-FMT-1, R-SAFE-6),
//! each a file of format 1 in the application's configuration. A setting
//! is named after what it controls, and refused outside its bounds.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{Result, StudioError};
use crate::store::{self, FORMAT};

/// Studio's settings' file.
pub const SETTINGS_FILE: &str = "settings.json";
/// The dock's layout's file.
pub const LAYOUT_FILE: &str = "layout.json";
/// The longest the settings' file may be, in bytes.
pub const MAX_SETTINGS_BYTES: u64 = 256 * 1024;
/// The longest the layout's file may be, in bytes.
pub const MAX_LAYOUT_BYTES: u64 = 1024 * 1024;
/// The window's zoom, in percent: at least, by default, at most.
pub const ZOOM_PERCENT: (u16, u16, u16) = (50, 100, 300);
/// The editor's font size, in points: at least, by default, at most.
pub const FONT_POINTS: (u8, u8, u8) = (8, 13, 48);
/// The longest name of a font, in characters.
pub const MAX_FONT_CHARS: usize = 128;
/// The most key bindings changed from their defaults.
pub const MAX_KEY_BINDINGS: usize = 500;
/// The longest name of a command or a key, in characters.
pub const MAX_KEY_CHARS: usize = 64;
/// The formatter's indentation, in spaces: at least, by default, at most.
pub const FORMAT_INDENT: (u8, u8, u8) = (1, 4, 8);
/// The formatter's line width, in characters: at least, by default, at most.
pub const FORMAT_LINE_WIDTH: (u16, u16, u16) = (40, 100, 240);
/// How long a run lasts, in seconds, before its end is notified while the
/// window is in the background: at least (never), by default, at most.
pub const NOTIFY_AFTER_SECONDS: (u16, u16, u16) = (0, 10, 3600);

/// How the formatter writes key words.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyWordCase {
    /// In upper case.
    #[default]
    Upper,
    /// In lower case.
    Lower,
    /// As written.
    Keep,
}

/// How a plan is first shown.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlanView {
    /// Drawn: its summary, its flow and its tree-table.
    #[default]
    Visual,
    /// As EXPLAIN's text.
    Raw,
}

/// The keys commands take before any is bound apart (RULES.md D69).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyScheme {
    /// Studio's own keys.
    #[default]
    Default,
    /// Function keys: F5 runs the script, F9 the statement, F6 explains.
    FunctionKeys,
}

/// The theme chosen.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThemeChoice {
    /// The system's preference.
    #[default]
    System,
    /// Light.
    Light,
    /// Dark.
    Dark,
}

/// Studio's settings, each named after what it controls; one the file
/// lacks is its default.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
#[expect(clippy::struct_excessive_bools, reason = "a settings file's switches, each a choice its page shows apart")]
pub struct Settings {
    /// The file's format version.
    pub format: u32,
    /// The theme.
    pub theme: ThemeChoice,
    /// The window's zoom, in percent.
    pub zoom_percent: u16,
    /// The editor's font, by family; empty for the platform's monospace.
    pub editor_font_family: String,
    /// The editor's font size, in points.
    pub editor_font_points: u8,
    /// Each command's key, where it is not the default: the command's
    /// name, and its key as `Mod+Shift+K`, or empty for none.
    pub key_bindings: BTreeMap<String, String>,
    /// The scheme of keys commands take, a command bound apart in
    /// `key_bindings` taking its own.
    pub key_scheme: KeyScheme,
    /// Whether open connections are checked, and lost ones connected
    /// again, as the computer wakes.
    pub reconnect_on_wake: bool,
    /// Whether the toolbar's buttons show their labels beside their icons.
    pub toolbar_labels: bool,
    /// Whether what runs is kept in the history.
    pub history_kept: bool,
    /// How the formatter writes key words.
    pub format_key_words: KeyWordCase,
    /// The formatter's indentation, in spaces.
    pub format_indent: u8,
    /// The width the formatter keeps lines within, in characters.
    pub format_line_width: u16,
    /// How long a run lasts, in seconds, before its end is notified while
    /// the window is in the background; 0 for never.
    pub notify_after_seconds: u16,
    /// How a plan is first shown.
    pub plan_view: PlanView,
    /// Whether Explain Analyze of a data change keeps its changes at first,
    /// rather than rolling them back after (RULES.md D61).
    pub analyze_keeps_changes: bool,
}

impl Default for Settings {
    fn default() -> Settings {
        Settings {
            format: FORMAT,
            theme: ThemeChoice::System,
            zoom_percent: ZOOM_PERCENT.1,
            editor_font_family: String::new(),
            editor_font_points: FONT_POINTS.1,
            key_bindings: BTreeMap::new(),
            key_scheme: KeyScheme::Default,
            reconnect_on_wake: true,
            toolbar_labels: false,
            history_kept: true,
            format_key_words: KeyWordCase::Upper,
            format_indent: FORMAT_INDENT.1,
            format_line_width: FORMAT_LINE_WIDTH.1,
            notify_after_seconds: NOTIFY_AFTER_SECONDS.1,
            plan_view: PlanView::Visual,
            analyze_keeps_changes: false,
        }
    }
}

/// `value` of `name`, refused outside `low..=high`.
fn within<T: PartialOrd + std::fmt::Display + Copy>(name: &str, value: T, (low, high): (T, T)) -> Result<()> {
    if value < low || value > high {
        return Err(StudioError::misuse(format!("[DESIGN] {name} is from {low} to {high}")));
    }
    Ok(())
}

/// `text` of `name`, refused if longer than `max` characters or holding a
/// control character.
fn text(name: &str, value: &str, max: usize) -> Result<()> {
    if value.chars().count() > max || value.chars().any(char::is_control) {
        return Err(StudioError::misuse(format!("[DESIGN] {name} is at most {max} characters, none a control")));
    }
    Ok(())
}

impl Settings {
    /// Checks every setting is within its bounds (R-SEC-6).
    ///
    /// # Errors
    ///
    /// SQLCODE -910, naming the setting.
    pub fn validate(&self) -> Result<()> {
        within("zoomPercent", self.zoom_percent, (ZOOM_PERCENT.0, ZOOM_PERCENT.2))?;
        within("editorFontPoints", self.editor_font_points, (FONT_POINTS.0, FONT_POINTS.2))?;
        text("editorFontFamily", &self.editor_font_family, MAX_FONT_CHARS)?;
        within("formatIndent", self.format_indent, (FORMAT_INDENT.0, FORMAT_INDENT.2))?;
        within("formatLineWidth", self.format_line_width, (FORMAT_LINE_WIDTH.0, FORMAT_LINE_WIDTH.2))?;
        within("notifyAfterSeconds", self.notify_after_seconds, (NOTIFY_AFTER_SECONDS.0, NOTIFY_AFTER_SECONDS.2))?;
        if self.key_bindings.len() > MAX_KEY_BINDINGS {
            return Err(StudioError::misuse(format!("[DESIGN] at most {MAX_KEY_BINDINGS} keys are bound")));
        }
        for (command, key) in &self.key_bindings {
            text("a command", command, MAX_KEY_CHARS)?;
            text("a key", key, MAX_KEY_CHARS)?;
        }
        Ok(())
    }

    /// The settings of `dir`'s file, the defaults if there is none.
    ///
    /// # Errors
    ///
    /// The file's, or a setting out of its bounds.
    pub fn load(dir: &Path) -> Result<Settings> {
        let path = dir.join(SETTINGS_FILE);
        let settings: Settings = store::read(&path, MAX_SETTINGS_BYTES)?.unwrap_or_default();
        match Settings::validate(&settings) {
            Ok(()) => Ok(settings),
            // A setting out of its bounds, as an earlier build's, sets the file aside (D49).
            Err(e) => store::set_aside(&path, &e.message).map(|()| Settings::default()),
        }
    }

    /// Writes the settings to `dir`'s file.
    ///
    /// # Errors
    ///
    /// A setting out of its bounds; the file's.
    pub fn save(&self, dir: &Path) -> Result<()> {
        self.validate()?;
        store::write(&dir.join(SETTINGS_FILE), self)
    }
}

/// The dock's layout, as dockview gives it, kept as it is.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layout {
    /// The file's format version.
    pub format: u32,
    /// The dock's own description of its panels and groups.
    pub dock: serde_json::Value,
}

impl Layout {
    /// The layout of `dir`'s file, if there is one.
    ///
    /// # Errors
    ///
    /// The file's.
    pub fn load(dir: &Path) -> Result<Option<Layout>> {
        store::read(&dir.join(LAYOUT_FILE), MAX_LAYOUT_BYTES)
    }

    /// Forgets `dir`'s layout, so the dock is laid out afresh.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if the file is there and cannot be removed.
    pub fn forget(dir: &Path) -> Result<()> {
        match std::fs::remove_file(dir.join(LAYOUT_FILE)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(StudioError::misuse(format!("[DESIGN] the layout: {e}"))),
            Ok(()) | Err(_) => Ok(()),
        }
    }

    /// Writes `dock` as `dir`'s layout.
    ///
    /// # Errors
    ///
    /// SQLCODE -910 if it is longer than the file may be; the file's.
    pub fn save(dir: &Path, dock: serde_json::Value) -> Result<()> {
        let layout = Layout { format: FORMAT, dock };
        let length = serde_json::to_vec(&layout).map_or(usize::MAX, |b| b.len());
        if u64::try_from(length).unwrap_or(u64::MAX) > MAX_LAYOUT_BYTES {
            return Err(StudioError::misuse(format!("[DESIGN] a layout is at most {MAX_LAYOUT_BYTES} bytes")));
        }
        store::write(&dir.join(LAYOUT_FILE), &layout)
    }
}

#[cfg(test)]
mod tests {
    use super::{KeyScheme, Layout, Settings, ThemeChoice};

    /// [RULE] R-FMT-1: settings saved are read back, and none saved are the
    /// defaults, as is one a file lacks.
    #[test]
    fn settings_are_read_back() {
        let dir = crate::testing::scratch("preferences/settings");
        assert_eq!(Settings::load(&dir).unwrap(), Settings::default());
        std::fs::write(dir.join(super::SETTINGS_FILE), br#"{"format":1,"theme":"dark"}"#).unwrap();
        assert_eq!(Settings::load(&dir).unwrap(), Settings { theme: ThemeChoice::Dark, ..Settings::default() });
        let mut settings = Settings { theme: ThemeChoice::Dark, zoom_percent: 125, ..Settings::default() };
        settings.key_bindings.insert("worksheet.run".into(), "Mod+Enter".into());
        settings.save(&dir).unwrap();
        assert_eq!(Settings::load(&dir).unwrap(), settings);
    }

    /// [DESIGN] D69: the scheme of keys is Studio's own at first, and the
    /// function keys' is kept and read back by its generic name.
    #[test]
    fn the_key_scheme_is_kept() {
        let dir = crate::testing::scratch("preferences/scheme");
        assert_eq!(Settings::default().key_scheme, KeyScheme::Default);
        Settings { key_scheme: KeyScheme::FunctionKeys, ..Settings::default() }.save(&dir).unwrap();
        assert!(std::fs::read_to_string(dir.join(super::SETTINGS_FILE)).unwrap().contains(r#""keyScheme": "functionKeys""#));
        assert_eq!(Settings::load(&dir).unwrap().key_scheme, KeyScheme::FunctionKeys);
    }

    /// [RULE] R-SEC-6 [DESIGN] D49: a setting outside its bounds is refused
    /// as it is saved; read, its file is set aside, and the defaults read.
    #[test]
    fn settings_out_of_bounds_are_refused() {
        let dir = crate::testing::scratch("preferences/bounds");
        assert!(Settings { zoom_percent: 49, ..Settings::default() }.save(&dir).is_err());
        assert!(Settings { editor_font_points: 49, ..Settings::default() }.save(&dir).is_err());
        assert!(Settings { editor_font_family: "Mono\n".into(), ..Settings::default() }.save(&dir).is_err());
        assert!(Settings { format_indent: 0, ..Settings::default() }.save(&dir).is_err());
        assert!(Settings { format_line_width: 241, ..Settings::default() }.save(&dir).is_err());
        assert!(Settings { notify_after_seconds: 3601, ..Settings::default() }.save(&dir).is_err());
        std::fs::write(dir.join(super::SETTINGS_FILE), br#"{"format":1,"theme":"dark","zoomPercent":400,"editorFontFamily":"","editorFontPoints":13,"keyBindings":{},"reconnectOnWake":true}"#).unwrap();
        assert_eq!(Settings::load(&dir).unwrap(), Settings::default());
        assert!(!dir.join(super::SETTINGS_FILE).exists());
        Layout::save(&dir, serde_json::json!({"grid": {}})).unwrap();
        Layout::forget(&dir).unwrap();
        Layout::forget(&dir).unwrap();
        assert!(Layout::load(&dir).unwrap().is_none());
    }

    /// [RULE] R-FMT-2 [STUDIO settings.json] [STUDIO layout.json]: the
    /// manual's examples of the files are ones Studio reads.
    #[test]
    fn the_manuals_examples_are_read() {
        let dir = crate::testing::scratch("preferences/manual");
        std::fs::write(dir.join(super::SETTINGS_FILE), crate::testing::manual_json("appendix/d-files.md", "settings.json")).unwrap();
        assert_eq!(Settings::load(&dir).unwrap().zoom_percent, 110);
        std::fs::write(dir.join(super::LAYOUT_FILE), crate::testing::manual_json("appendix/d-files.md", "layout.json")).unwrap();
        assert!(Layout::load(&dir).unwrap().is_some());
    }

    /// [RULE] R-FMT-1: the dock's layout is kept as the dock gave it.
    #[test]
    fn the_layout_is_kept_as_given() {
        let dir = crate::testing::scratch("preferences/layout");
        assert_eq!(Layout::load(&dir).unwrap(), None);
        let dock = serde_json::json!({"grid": {"root": {"type": "branch"}}, "panels": {}});
        Layout::save(&dir, dock.clone()).unwrap();
        assert_eq!(Layout::load(&dir).unwrap().unwrap().dock, dock);
        assert!(Layout::save(&dir, serde_json::json!("x".repeat(2 * 1024 * 1024))).is_err());
    }

    /// [DESIGN] D49: the settings and layout an earlier build left are read,
    /// each setting it did not know taking its default.
    #[test]
    fn an_earlier_builds_files_are_read() {
        let dir = crate::testing::earlier_app_data("preferences/earlier");
        assert_eq!(Settings::load(&dir).unwrap(), Settings::default());
        assert!(Layout::load(&dir).unwrap().is_some());
        assert!(dir.join(super::SETTINGS_FILE).exists());
    }
}
