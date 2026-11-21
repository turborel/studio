/**
 * The colours of Studio's two themes (RULES.md D20, R-UI-2), defined once
 * and applied as CSS variables. The accent is the maroon of Studio's icon,
 * `artwork/studio-icon.png`, its tile sampled from the file: #562024. It fills the
 * chrome in both themes, under white text; where the accent is drawn as
 * text or a focus ring on the dark theme's background, a tint of it is
 * used, since the maroon itself is too dark to read there.
 */

/** A theme's name. */
export type ThemeName = "light" | "dark";

/** The colours of a theme, each a CSS hex colour. */
export interface Palette {
  /** The window's background. */
  readonly background: string;
  /** Panels and the tree. */
  readonly surface: string;
  /** Headers, the toolbar and the status bar. */
  readonly surfaceRaised: string;
  /** Lines between parts. */
  readonly border: string;
  /** Text. */
  readonly text: string;
  /** Text of less weight: hints, counts, types. */
  readonly textMuted: string;
  /** The accent, as a fill: the active tab's mark, the title of a dialog. */
  readonly accent: string;
  /** Text on the accent's fill. */
  readonly onAccent: string;
  /** The accent drawn as text or a line on the background. */
  readonly accentText: string;
  /** The ring of the focused control. */
  readonly focus: string;
  /** The background of selected rows and items. */
  readonly selection: string;
  /** Text on the selection. */
  readonly onSelection: string;
  /** Errors, and production connections' mark. */
  readonly danger: string;
  /** Warnings, and test connections' mark. */
  readonly warning: string;
  /** Success, and development connections' mark. */
  readonly success: string;
  /** The fill of what must not be missed, as a connection not secure. */
  readonly alert: string;
  /** Text on the alert's fill. */
  readonly onAlert: string;
  /** The icon of running: green. */
  readonly iconRun: string;
  /** The icon of stopping and cancelling: red. */
  readonly iconStop: string;
  /** The icon of committing. */
  readonly iconCommit: string;
  /** The icon of rolling back. */
  readonly iconRollback: string;
  /** The icon of connecting. */
  readonly iconConnect: string;
  /** The icon of disconnecting. */
  readonly iconDisconnect: string;
  /**
   * The colours of a chart's series, in their fixed order: blue, orange,
   * aqua, yellow, magenta, green, violet, red, each stepped for the
   * theme's background and checked together for colour-blind separation
   * (RULES.md D52). A chart's values and labels are written in text's
   * colours, never these.
   */
  readonly series1: string;
  readonly series2: string;
  readonly series3: string;
  readonly series4: string;
  readonly series5: string;
  readonly series6: string;
  readonly series7: string;
  readonly series8: string;
}

/** Studio's icon's maroon, sampled from `artwork/studio-icon.png`. */
export const STUDIO_MAROON = "#562024";

/** The palettes of the two themes. */
export const PALETTES: Readonly<Record<ThemeName, Palette>> = {
  light: {
    background: "#FFFFFF",
    surface: "#F6F4F4",
    surfaceRaised: "#ECE8E8",
    border: "#D3CCCC",
    text: "#1B1415",
    textMuted: "#5C5254",
    accent: STUDIO_MAROON,
    onAccent: "#FFFFFF",
    accentText: STUDIO_MAROON,
    focus: STUDIO_MAROON,
    selection: "#F0DADD",
    onSelection: "#1B1415",
    danger: "#B3261E",
    warning: "#7A4F00",
    success: "#1D6531",
    alert: "#B3261E",
    onAlert: "#FFFFFF",
    iconRun: "#1D7A36",
    iconStop: "#B3261E",
    iconCommit: "#0B5CAD",
    iconRollback: "#8A4B00",
    iconConnect: "#00796B",
    iconDisconnect: "#7B3FA0",
    series1: "#2A78D6",
    series2: "#EB6834",
    series3: "#1BAF7A",
    series4: "#EDA100",
    series5: "#E87BA4",
    series6: "#008300",
    series7: "#6250D6",
    series8: "#E34948",
  },
  dark: {
    background: "#1A1617",
    surface: "#211C1D",
    surfaceRaised: "#2B2526",
    border: "#433A3B",
    text: "#EEE8E8",
    textMuted: "#B4AAAB",
    accent: STUDIO_MAROON,
    onAccent: "#FFFFFF",
    accentText: "#E8A4AC",
    focus: "#E8A4AC",
    selection: "#5A2A2F",
    onSelection: "#FFFFFF",
    danger: "#FF8A80",
    warning: "#F0C060",
    success: "#7DD192",
    alert: "#B3261E",
    onAlert: "#FFFFFF",
    iconRun: "#7DD192",
    iconStop: "#FF8A80",
    iconCommit: "#8AB4F8",
    iconRollback: "#F0C060",
    iconConnect: "#64D2C4",
    iconDisconnect: "#D0A6F0",
    series1: "#3987E5",
    series2: "#D95926",
    series3: "#199E70",
    series4: "#C98500",
    series5: "#D55181",
    series6: "#008300",
    series7: "#9085E9",
    series8: "#E66767",
  },
};

/** The relative luminance of a hex colour (WCAG 2.2, its definition). */
export function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The contrast ratio of two hex colours (WCAG 2.2), from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
