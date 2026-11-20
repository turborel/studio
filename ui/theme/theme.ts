/**
 * Choosing and applying a theme (RULES.md D20): the user's choice, or the
 * system's preference when the choice is "system", written to the page's
 * CSS variables so every part of the UI follows it at once.
 */
import { PALETTES, type Palette, type ThemeName } from "./tokens";

/** What the user chose: a theme, or the system's. */
export type ThemeChoice = ThemeName | "system";

/** Every choice, in the order the menu lists them. */
export const THEME_CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];

/** The media query of the system's dark preference. */
export const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The theme a choice gives, with the system preferring dark or not. */
export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): ThemeName {
  if (choice === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return choice;
}

/** A palette key as a CSS variable's name: `textMuted` is `--text-muted`. */
export function cssVariable(key: string): string {
  return `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/** Writes `theme`'s palette to `root`'s CSS variables, and its name. */
export function applyTheme(root: HTMLElement, theme: ThemeName): void {
  const palette: Palette = PALETTES[theme];
  for (const [key, value] of Object.entries(palette)) {
    root.style.setProperty(cssVariable(key), value as string);
  }
  root.dataset["theme"] = theme;
  root.style.colorScheme = theme;
}
