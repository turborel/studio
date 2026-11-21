/**
 * The settings (RULES.md R-FMT-1, R-SAFE-6): the theme, the zoom, the
 * editor's font, the toolbar's labels, reconnecting on wake, the
 * worksheet's history, formatter and notification, and each command's
 * key, saved as they change.
 */
import { COMMANDS } from "../commands/commands";
import { normalize } from "../commands/keys";
import { FORMAT_BOUNDS, type KeyWordCase, NOTIFY_BOUNDS, type Settings, ZOOM } from "../ipc/preferences";
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
      <label className="check">
        <input
          type="checkbox"
          checked={settings.toolbarLabels}
          onChange={(e) => {
            change({ ...settings, toolbarLabels: e.target.checked });
          }}
        />
        <span>Show the toolbar's labels beside its icons</span>
      </label>
    </>
  );
}

/** A setting of a number from `least` to `most`. */
function NumberField({
  label,
  value,
  bounds,
  change,
}: {
  label: string;
  value: number;
  bounds: readonly [number, number];
  change: (n: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={bounds[0]}
        max={bounds[1]}
        value={value}
        onChange={(e) => {
          change(clamped(Number(e.target.value), ...bounds));
        }}
      />
    </label>
  );
}

/** The case the formatter writes key words in. */
function KeyWords({ settings, change }: PartProps) {
  return (
    <label className="field">
      <span>Format key words in</span>
      <select
        value={settings.formatKeyWords}
        onChange={(e) => {
          change({ ...settings, formatKeyWords: e.target.value as KeyWordCase });
        }}
      >
        <option value="upper">upper case</option>
        <option value="lower">lower case</option>
        <option value="keep">the case written</option>
      </select>
    </label>
  );
}

/** A setting of a box ticked or not. */
function Toggle(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (on: boolean) => void;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => {
          props.onChange(e.target.checked);
        }}
      />
      <span>{props.label}</span>
    </label>
  );
}

/** The worksheet's settings: its history, Explain Analyze's changes, its formatter and its notification. */
function Worksheets({ settings, change }: PartProps) {
  return (
    <>
      <Toggle
        label="Keep a history of what runs"
        checked={settings.historyKept}
        onChange={(historyKept) => {
          change({ ...settings, historyKept });
        }}
      />
      <Toggle
        label="Explain Analyze of a data change keeps its changes, rather than rolling them back"
        checked={settings.analyzeKeepsChanges}
        onChange={(analyzeKeepsChanges) => {
          change({ ...settings, analyzeKeepsChanges });
        }}
      />
      <KeyWords settings={settings} change={change} />
      <NumberField
        label="Format with an indentation of (spaces)"
        value={settings.formatIndent}
        bounds={FORMAT_BOUNDS.indent}
        change={(n) => {
          change({ ...settings, formatIndent: n });
        }}
      />
      <NumberField
        label="Format lines within (characters)"
        value={settings.formatLineWidth}
        bounds={FORMAT_BOUNDS.lineWidth}
        change={(n) => {
          change({ ...settings, formatLineWidth: n });
        }}
      />
      <NumberField
        label="Notify a run's end, in the background, after (seconds; 0 for never)"
        value={settings.notifyAfterSeconds}
        bounds={NOTIFY_BOUNDS}
        change={(n) => {
          change({ ...settings, notifyAfterSeconds: n });
        }}
      />
      <PlanViewChoice settings={settings} change={change} />
    </>
  );
}

/** How a plan is first shown. */
function PlanViewChoice({ settings, change }: PartProps) {
  return (
    <label className="field">
      <span>Open plans as</span>
      <select
        value={settings.planView}
        onChange={(e) => {
          change({ ...settings, planView: e.target.value === "raw" ? "raw" : "visual" });
        }}
      >
        <option value="visual">Visual</option>
        <option value="raw">Raw</option>
      </select>
    </label>
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
      <Worksheets settings={settings} change={change} />
      <Keys settings={settings} change={change} />
      <div className="dialog-buttons">
        <button type="button" onClick={close}>
          Close
        </button>
      </div>
    </Modal>
  );
}
