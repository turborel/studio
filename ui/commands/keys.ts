/**
 * Keys (RULES.md D30, R-UI-1): a key written as `Mod+Shift+P`, where `Mod`
 * is Cmd on macOS and Ctrl elsewhere; a key event read the same way; and
 * each command's key, its default, the scheme's (D69), or the one the
 * settings give.
 */
import type { KeyScheme } from "../ipc/preferences";

/** The keys each scheme gives commands over their own defaults, by command (RULES.md D69). */
export const SCHEME_KEYS: Readonly<Record<KeyScheme, Readonly<Record<string, string>>>> = {
  default: {},
  functionKeys: {
    "worksheet.runScript": "F5",
    "worksheet.run": "F9",
    "worksheet.explain": "F6",
    "debug.stepInto": "F7",
    "debug.stepOver": "F8",
    "debug.stepOut": "Shift+F7",
    "debug.continue": "Shift+F8",
    "debug.interrupt": "Mod+Shift+F8",
    "debug.stop": "Mod+F2",
  },
};

/** The schemes, as the settings name them. */
export const SCHEME_NAMES: readonly (readonly [KeyScheme, string])[] = [
  ["default", "Default"],
  ["functionKeys", "Function keys"],
];

/** The modifiers, in the order a key is written. */
const MODIFIERS = ["Mod", "Alt", "Shift"] as const;

/** Whether the platform is macOS, whose `Mod` is Cmd. */
export function isMac(platform: string = navigator.platform): boolean {
  return platform.toLowerCase().startsWith("mac");
}

/** The key of a key event, written as a binding is, or null for a lone modifier. */
export function keyOf(event: KeyboardEvent, mac: boolean = isMac()): string | null {
  if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) {
    return null;
  }
  const parts: string[] = [];
  if (mac ? event.metaKey : event.ctrlKey) {
    parts.push("Mod");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return parts.join("+");
}

/** `key` written as a binding is: its modifiers in order, its key's letter upper case. */
export function normalize(key: string): string {
  const parts = key.split("+").map((p) => p.trim());
  const last = parts.pop() ?? "";
  const mods = MODIFIERS.filter((m) => parts.some((p) => p.toLowerCase() === m.toLowerCase()));
  const upper = last.length === 1 || /^f\d{1,2}$/i.test(last);
  return [...mods, upper ? last.toUpperCase() : last].join("+");
}

/** `key` as the platform shows it: Cmd or Ctrl for `Mod`. */
export function shown(key: string, mac: boolean = isMac()): string {
  return key.replace(/^Mod\b/, mac ? "Cmd" : "Ctrl");
}

/** Each command's key: its default, unless the settings bind another, or none. */
export function bindings(
  defaults: Readonly<Record<string, string>>,
  overrides: Readonly<Record<string, string>>,
): Map<string, string> {
  const keys = new Map<string, string>();
  for (const [command, key] of Object.entries({ ...defaults, ...overrides })) {
    if (key !== "") {
      keys.set(normalize(key), command);
    }
  }
  return keys;
}
