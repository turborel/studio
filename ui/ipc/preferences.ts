/**
 * The commands of Studio's settings and the dock's layout (RULES.md
 * R-FMT-1), each a file of format 1 the backend keeps.
 */
import { invoke } from "@tauri-apps/api/core";
import type { ThemeChoice } from "../theme/theme";

/** Studio's settings, each named after what it controls. */
export interface Settings {
  readonly format: 1;
  readonly theme: ThemeChoice;
  readonly zoomPercent: number;
  readonly editorFontFamily: string;
  readonly editorFontPoints: number;
  readonly keyBindings: Readonly<Record<string, string>>;
  readonly reconnectOnWake: boolean;
  readonly toolbarLabels: boolean;
  readonly historyKept: boolean;
  readonly formatKeyWords: KeyWordCase;
  readonly formatIndent: number;
  readonly formatLineWidth: number;
  readonly notifyAfterSeconds: number;
}

/** How the formatter writes key words. */
export type KeyWordCase = "upper" | "lower" | "keep";

/** The settings Studio starts with, as the backend's defaults are. */
export const DEFAULT_SETTINGS: Settings = {
  format: 1,
  theme: "system",
  zoomPercent: 100,
  editorFontFamily: "",
  editorFontPoints: 13,
  keyBindings: {},
  reconnectOnWake: true,
  toolbarLabels: false,
  historyKept: true,
  formatKeyWords: "upper",
  formatIndent: 4,
  formatLineWidth: 100,
  notifyAfterSeconds: 10,
};

/** The formatter's bounds: indentation in spaces, and line width in characters. */
export const FORMAT_BOUNDS = { indent: [1, 8], lineWidth: [40, 240] } as const;

/** How long a run lasts, in seconds, before its end is notified: least (never) and most. */
export const NOTIFY_BOUNDS = [0, 3600] as const;

/** The window's zoom, in percent: least, step and most. */
export const ZOOM = { least: 50, step: 10, most: 300 } as const;

/** Studio's settings. */
export function loadSettings(): Promise<Settings> {
  return invoke<Settings>("load_settings");
}

/** Saves Studio's settings. */
export function saveSettings(settings: Settings): Promise<null> {
  return invoke<null>("save_settings", { settings });
}

/** The dock's layout, if one is saved. */
export function loadLayout(): Promise<unknown> {
  return invoke<unknown>("load_layout");
}

/** Saves the dock's layout. */
export function saveLayout(dock: unknown): Promise<null> {
  return invoke<null>("save_layout", { dock });
}
