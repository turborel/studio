/**
 * The commands of Studio's settings and the dock's layout (RULES.md
 * R-FMT-1), each a file of format 1 the backend keeps.
 */
import { invoke } from "@tauri-apps/api/core";
import type { ThemeChoice } from "../theme/theme";

/** The schemes of keys: Studio's own, or the function keys'. */
export type KeyScheme = "default" | "functionKeys";

/** Studio's settings, each named after what it controls. */
export interface Settings {
  readonly format: 1;
  readonly theme: ThemeChoice;
  readonly zoomPercent: number;
  readonly editorFontFamily: string;
  readonly editorFontPoints: number;
  readonly keyBindings: Readonly<Record<string, string>>;
  /** The scheme of keys commands take, a command bound apart taking its own (RULES.md D69). */
  readonly keyScheme: KeyScheme;
  readonly reconnectOnWake: boolean;
  readonly toolbarLabels: boolean;
  readonly historyKept: boolean;
  /** Whether Explain Analyze of a data change keeps its changes at first, rather than rolling them back after. */
  readonly analyzeKeepsChanges: boolean;
  readonly formatKeyWords: KeyWordCase;
  readonly formatIndent: number;
  readonly formatLineWidth: number;
  readonly notifyAfterSeconds: number;
  /** How a plan is first shown: drawn, or as EXPLAIN's text. */
  readonly planView: PlanViewChoice;
}

/** How a plan is first shown. */
export type PlanViewChoice = "visual" | "raw";

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
  keyScheme: "default",
  reconnectOnWake: true,
  toolbarLabels: false,
  historyKept: true,
  analyzeKeepsChanges: false,
  formatKeyWords: "upper",
  formatIndent: 4,
  formatLineWidth: 100,
  notifyAfterSeconds: 10,
  planView: "visual",
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

/** Forgets the dock's layout, so the window is laid out afresh as it loads again. */
export function forgetLayout(): Promise<null> {
  return invoke<null>("forget_layout");
}

/** What was told of Studio's files set aside since last asked: each a file that did not fit, and why. */
export function setAsideNotices(): Promise<string[]> {
  return invoke<string[]>("set_aside_notices");
}

/** Keeps a failure the window did not handle in the failures' log. */
export function logFailure(text: string): Promise<null> {
  return invoke<null>("log_failure", { text });
}
