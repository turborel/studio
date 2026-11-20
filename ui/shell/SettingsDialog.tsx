/**
 * The settings (RULES.md R-FMT-1, R-SAFE-6): the theme, the zoom, the
 * editor's font, reconnecting on wake, and each command's key, saved as
 * they change.
 */
import { COMMANDS } from "../commands/commands";
import { normalize } from "../commands/keys";
import { type Settings, ZOOM } from "../ipc/preferences";
import { changeSettings, show } from "../state/actions";
import { useStore, useStudio } from "../state/store";
import { THEME_CHOICES, type ThemeChoice } from "../theme/theme";
import { Modal } from "./Modal";

/** The editor's font size, in points: least and most. */
const FONT_POINTS = { least: 8, most: 48 } as const;

/** The key bindings with `command` bound to `key`, empty for none, or its default when `key` is its default. */
export function rebound(
  bindings: Readonly<Record<string, string>>,
  command: string,
  key: string,
  fallback: string,
): Record<string, string> {
  const written = key.trim() === "" ? "" : normalize(key);
  const others = Object.fromEntries(Object.entries(bindings).filter(([name]) => name !== command));
  return written === fallback ? others : { ...others, [command]: written };
}

/** The key bindings' table. */
function Keys({ settings, change }: { settings: Settings; change: (s: Settings) => void }) {
  return (
    <details className="field-group">
      <summary>Keys</summary>
      {COMMANDS.map((c) => (
        <label key={c.id} className="field">
          <span>{c.title}</span>
          <input
            defaultValue={settings.keyBindings[c.id] ?? c.key ?? ""}
            placeholder="none"
            onBlur={(e) => {
              change({ ...settings, keyBindings: rebound(settings.keyBindings, c.id, e.target.value, c.key ?? "") });
            }}
          />
        </label>
      ))}
    </details>
  );
}

/** What a part of the settings is given. */
interface PartProps {
  readonly settings: Settings;
  readonly change: (next: Settings) => void;
}

/** A number between `least` and `most`. */
function clamped(value: number, least: number, most: number): number {
  return Math.min(most, Math.max(least, value));
}

/** The editor's font. */
function Font({ settings, change }: PartProps) {
  return (
    <>
      <label className="field">
        <span>Editor font</span>
        <input
          value={settings.editorFontFamily}
          placeholder="the platform's monospace"
          onChange={(e) => {
            change({ ...settings, editorFontFamily: e.target.value });
          }}
        />
      </label>
      <label className="field">
        <span>Editor font size (points)</span>
        <input
          type="number"
          min={FONT_POINTS.least}
          max={FONT_POINTS.most}
          value={settings.editorFontPoints}
          onChange={(e) => {
            change({
              ...settings,
              editorFontPoints: clamped(Number(e.target.value), FONT_POINTS.least, FONT_POINTS.most),
            });
          }}
        />
      </label>
    </>
  );
}

/** The theme, the zoom and the editor's font. */
function Appearance({ settings, change }: PartProps) {
  return (
    <>
      <label className="field">
        <span>Theme</span>
        <select
          value={settings.theme}
          onChange={(e) => {
            change({ ...settings, theme: e.target.value as ThemeChoice });
          }}
        >
          {THEME_CHOICES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Zoom (%)</span>
        <input
          type="number"
          min={ZOOM.least}
          max={ZOOM.most}
          step={ZOOM.step}
          value={settings.zoomPercent}
          onChange={(e) => {
            change({ ...settings, zoomPercent: clamped(Number(e.target.value), ZOOM.least, ZOOM.most) });
          }}
        />
      </label>
      <Font settings={settings} change={change} />
    </>
  );
}

/** The settings dialog. */
export function SettingsDialog() {
  const store = useStore();
  const settings = useStudio((s) => s.settings);
  const change = (next: Settings) => void changeSettings(store, () => next);
  const close = () => {
    show(store, null);
  };
  return (
    <Modal title="Settings" onClose={close} wide>
      <Appearance settings={settings} change={change} />
      <label className="check">
        <input
          type="checkbox"
          checked={settings.reconnectOnWake}
          onChange={(e) => {
            change({ ...settings, reconnectOnWake: e.target.checked });
          }}
        />
        <span>Check connections as the computer wakes, and connect lost ones again</span>
      </label>
      <Keys settings={settings} change={change} />
      <div className="dialog-buttons">
        <button type="button" onClick={close}>
          Close
        </button>
      </div>
    </Modal>
  );
}
