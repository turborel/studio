/**
 * The colours of Studio's two themes (RULES.md D20, R-UI-2), defined once
 * and applied as CSS variables. The accent is the copper of Studio's icon,
 * its ribbon spiral, sampled from the fills of `artwork/studio-icon.svg`:
 * its main tone #C26B47. White on that is too faint for text, so the
 * chrome is filled, under white text, by the ribbon's deeper step, which
 * also draws accent text and focus rings on the light background; on the
 * dark background a lighter step of the ribbon draws them. The editor's
 * tokens, gutter and popups, and the fields, have colours of each theme's
 * own, each readable on what it is drawn on (RULES.md D74); the dark
 * theme's key words in the ribbon's copper, lightened.
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
  /** The editor's active line, and its number's place in the gutter. */
  readonly editorActiveLine: string;
  /** The editor's gutter of line numbers: its ground, its numbers, the active line's number, and its edge. */
  readonly gutterBackground: string;
  readonly gutterText: string;
  readonly gutterActiveText: string;
  readonly gutterBorder: string;
  /**
   * The editor's tokens, each at least 4.5:1 against the editor's ground
   * and its active line: key words, functions, strings, numbers,
   * comments, operators and punctuation, names, types, atoms such as
   * NULL and TRUE, script variables, and what is invalid.
   */
  readonly synKeyword: string;
  readonly synFunction: string;
  readonly synString: string;
  readonly synNumber: string;
  readonly synComment: string;
  readonly synOperator: string;
  readonly synIdentifier: string;
  readonly synType: string;
  readonly synAtom: string;
  readonly synVariable: string;
  readonly synInvalid: string;
  /** The editor's popups, completion, hints and lints: their ground, text, lesser text, the chosen row and its text, and edge. */
  readonly popupBackground: string;
  readonly popupText: string;
  readonly popupMuted: string;
  readonly popupSelected: string;
  readonly onPopupSelected: string;
  readonly popupBorder: string;
  /** A field's ground, its resting edge, at least 3:1 against the ground (WCAG 1.4.11), and its placeholder. */
  readonly inputBackground: string;
  readonly inputBorder: string;
  readonly placeholder: string;
  /** A disabled field's ground and text. */
  readonly disabledBackground: string;
  readonly disabledText: string;
}

/** The main tone of Studio's icon's copper ribbon, sampled from `artwork/studio-icon.svg`. */
export const STUDIO_COPPER = "#C26B47";
/** The ribbon's deeper step, a fill of the same file: the accent's fill, and its text on the light background. */
export const COPPER_DEEP = "#A74C2E";
/** The ribbon's lighter step, a fill of the same file: the accent's text and ring on the dark background. */
export const COPPER_LIGHT = "#DE9776";

/** The palettes of the two themes. */
export const PALETTES: Readonly<Record<ThemeName, Palette>> = {
  light: {
    background: "#FFFFFF",
    surface: "#F6F4F4",
    surfaceRaised: "#ECE8E8",
    border: "#D3CCCC",
    text: "#1B1415",
    textMuted: "#5C5254",
    accent: COPPER_DEEP,
    onAccent: "#FFFFFF",
    accentText: COPPER_DEEP,
    focus: COPPER_DEEP,
    selection: "#F6DDD2",
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
    editorActiveLine: "#EDF6FB",
    gutterBackground: "#F6F4F4",
    gutterText: "#6A6062",
    gutterActiveText: "#1B1415",
    gutterBorder: "#E3DEDE",
    synKeyword: "#770088",
    synFunction: "#1A1AA6",
    synString: "#AA1111",
    synNumber: "#116644",
    synComment: "#8A4400",
    synOperator: "#4A4244",
    synIdentifier: "#1B1415",
    synType: "#007750",
    synAtom: "#221199",
    synVariable: "#5D3C9E",
    synInvalid: "#C4221B",
    popupBackground: "#FFFFFF",
    popupText: "#1B1415",
    popupMuted: "#5C5254",
    popupSelected: "#F6DDD2",
    onPopupSelected: "#1B1415",
    popupBorder: "#D3CCCC",
    inputBackground: "#FFFFFF",
    inputBorder: "#8A8082",
    placeholder: "#6E6466",
    disabledBackground: "#ECE8E8",
    disabledText: "#5C5254",
  },
  dark: {
    background: "#1A1617",
    surface: "#211C1D",
    surfaceRaised: "#2B2526",
    border: "#433A3B",
    text: "#EEE8E8",
    textMuted: "#B4AAAB",
    accent: COPPER_DEEP,
    onAccent: "#FFFFFF",
    accentText: COPPER_LIGHT,
    focus: COPPER_LIGHT,
    selection: "#5E3324",
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
    editorActiveLine: "#2C2526",
    gutterBackground: "#1F1A1B",
    gutterText: "#9D9294",
    gutterActiveText: "#EEE8E8",
    gutterBorder: "#332C2D",
    synKeyword: "#E8A07C",
    synFunction: "#8AB4F8",
    synString: "#A6D89A",
    synNumber: "#F0C060",
    synComment: "#A79C9D",
    synOperator: "#D3CACB",
    synIdentifier: "#EEE8E8",
    synType: "#D0A6F0",
    synAtom: "#7FD3C8",
    synVariable: "#C9B6F2",
    synInvalid: "#FF8A80",
    popupBackground: "#2B2526",
    popupText: "#EEE8E8",
    popupMuted: "#B4AAAB",
    popupSelected: "#5E3324",
    onPopupSelected: "#FFFFFF",
    popupBorder: "#4A4041",
    inputBackground: "#141011",
    inputBorder: "#7A6E70",
    placeholder: "#9D9294",
    disabledBackground: "#211C1D",
    disabledText: "#B4AAAB",
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
