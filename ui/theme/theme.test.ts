import { applyTheme, cssVariable, resolveTheme } from "./theme";
import { PALETTES, STUDIO_MAROON, contrast, luminance, type ThemeName } from "./tokens";

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

  it("takes the accent from the icon's maroon in both themes [DESIGN] D20", () => {
    expect(STUDIO_MAROON).toBe("#562024");
    for (const theme of THEMES) {
      expect(PALETTES[theme].accent).toBe(STUDIO_MAROON);
    }
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
  });

  it.each(THEMES)("keeps the %s theme's focus ring and borders visible [RULE] R-UI-2", (theme) => {
    const p = PALETTES[theme];
    expect(contrast(p.focus, p.background)).toBeGreaterThanOrEqual(COMPONENT);
    expect(contrast(p.focus, p.surface)).toBeGreaterThanOrEqual(COMPONENT);
  });
});
