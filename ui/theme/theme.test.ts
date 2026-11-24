import { applyTheme, cssVariable, resolveTheme } from "./theme";
import iconSvg from "../../artwork/studio-icon.svg?raw";
import { COPPER_DEEP, COPPER_LIGHT, PALETTES, STUDIO_COPPER, contrast, luminance, type ThemeName } from "./tokens";

/** WCAG 2.2 AA: text of normal size. */
const TEXT = 4.5;
/** WCAG 2.2 AA: user interface components and focus rings (1.4.11). */
const COMPONENT = 3;
const THEMES: ThemeName[] = ["light", "dark"];

describe("themes", () => {
  it("resolves the system choice by the system's preference [DESIGN] D20", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("names CSS variables after the palette's keys [DESIGN] D20", () => {
    expect(cssVariable("textMuted")).toBe("--text-muted");
    expect(cssVariable("onAccent")).toBe("--on-accent");
  });

  it("writes a palette to the root's variables [DESIGN] D20", () => {
    const root = document.createElement("div");
    applyTheme(root, "dark");
    expect(root.style.getPropertyValue("--accent-text")).toBe(PALETTES.dark.accentText);
    expect(root.dataset["theme"]).toBe("dark");
  });

  it("measures contrast as WCAG defines it [RULE] R-UI-2", () => {
    expect(luminance("#FFFFFF")).toBeCloseTo(1);
    expect(luminance("#000000")).toBe(0);
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21);
    expect(contrast("#FFFFFF", "#FFFFFF")).toBe(1);
  });

  it("takes the accent from the icon's copper in both themes [DESIGN] D20", () => {
    for (const step of [STUDIO_COPPER, COPPER_DEEP, COPPER_LIGHT]) {
      expect(iconSvg).toContain(`fill="${step}"`);
    }
    for (const theme of THEMES) {
      expect(PALETTES[theme].accent).toBe(COPPER_DEEP);
    }
    expect(PALETTES.dark.accentText).toBe(COPPER_LIGHT);
  });

  it.each(THEMES)("keeps the %s theme's text readable [RULE] R-UI-2", (theme) => {
    const p = PALETTES[theme];
    for (const ground of [p.background, p.surface, p.surfaceRaised]) {
      expect(contrast(p.text, ground)).toBeGreaterThanOrEqual(TEXT);
      expect(contrast(p.textMuted, ground)).toBeGreaterThanOrEqual(TEXT);
      expect(contrast(p.accentText, ground)).toBeGreaterThanOrEqual(TEXT);
      expect(contrast(p.danger, ground)).toBeGreaterThanOrEqual(TEXT);
      expect(contrast(p.warning, ground)).toBeGreaterThanOrEqual(TEXT);
      expect(contrast(p.success, ground)).toBeGreaterThanOrEqual(TEXT);
    }
    expect(contrast(p.onAccent, p.accent)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(p.onSelection, p.selection)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(p.onAlert, p.alert)).toBeGreaterThanOrEqual(TEXT);
  });

  it.each(THEMES)("keeps the %s theme's coloured icons visible, each of its own colour [RULE] R-UI-2", (theme) => {
    const p = PALETTES[theme];
    const icons = [p.iconRun, p.iconStop, p.iconCommit, p.iconRollback, p.iconConnect, p.iconDisconnect];
    for (const icon of icons) {
      for (const ground of [p.background, p.surface, p.surfaceRaised]) {
        expect(contrast(icon, ground)).toBeGreaterThanOrEqual(COMPONENT);
      }
    }
    expect(new Set(icons).size).toBe(icons.length);
  });

  it.each(THEMES)("keeps the %s theme's focus ring and borders visible [RULE] R-UI-2", (theme) => {
    const p = PALETTES[theme];
    expect(contrast(p.focus, p.background)).toBeGreaterThanOrEqual(COMPONENT);
    expect(contrast(p.focus, p.surface)).toBeGreaterThanOrEqual(COMPONENT);
  });

  it.each(THEMES)("keeps the %s theme's editor tokens readable, its active line's too [RULE] R-UI-2", (theme) => {
    const p = PALETTES[theme];
    const tokens = [
      p.synKeyword,
      p.synFunction,
      p.synString,
      p.synNumber,
      p.synComment,
      p.synOperator,
      p.synIdentifier,
      p.synType,
      p.synAtom,
      p.synVariable,
      p.synInvalid,
    ];
    for (const colour of tokens) {
      expect(contrast(colour, p.background)).toBeGreaterThanOrEqual(TEXT);
      expect(contrast(colour, p.editorActiveLine)).toBeGreaterThanOrEqual(TEXT);
    }
    expect(contrast(p.gutterText, p.gutterBackground)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(p.gutterActiveText, p.editorActiveLine)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(p.gutterBorder, p.gutterBackground)).toBeGreaterThan(1);
  });

  it.each(THEMES)("keeps the %s theme's completion, hints and lints readable [RULE] R-UI-2", (theme) => {
    const p = PALETTES[theme];
    expect(contrast(p.popupText, p.popupBackground)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(p.popupMuted, p.popupBackground)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(p.onPopupSelected, p.popupSelected)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(p.popupBorder, p.popupBackground)).toBeGreaterThan(1);
  });

  it.each(THEMES)("keeps the %s theme's fields readable, their edges and ring visible [RULE] R-UI-2", (theme) => {
    const p = PALETTES[theme];
    expect(contrast(p.text, p.inputBackground)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(p.placeholder, p.inputBackground)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(p.disabledText, p.disabledBackground)).toBeGreaterThanOrEqual(TEXT);
    for (const ground of [p.background, p.surface, p.surfaceRaised]) {
      expect(contrast(p.inputBorder, ground)).toBeGreaterThanOrEqual(COMPONENT);
      expect(contrast(p.focus, ground)).toBeGreaterThanOrEqual(COMPONENT);
    }
    expect(contrast(p.focus, p.inputBackground)).toBeGreaterThanOrEqual(COMPONENT);
  });
});
