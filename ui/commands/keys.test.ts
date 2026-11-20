import { bindings, isMac, keyOf, normalize, shown } from "./keys";

/** A key event of `key`, with `mods`. */
function press(key: string, mods: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, ...mods });
}

describe("keys", () => {
  it("read Cmd as Mod on macOS and Ctrl elsewhere [DESIGN] D30", () => {
    expect(keyOf(press("p", { metaKey: true, shiftKey: true }), true)).toBe("Mod+Shift+P");
    expect(keyOf(press("p", { ctrlKey: true, shiftKey: true }), false)).toBe("Mod+Shift+P");
    expect(keyOf(press("p", { ctrlKey: true }), true)).toBe("P");
    expect(keyOf(press("Enter", { ctrlKey: true, altKey: true }), false)).toBe("Mod+Alt+Enter");
    expect(keyOf(press("Shift", { shiftKey: true }), false)).toBeNull();
  });

  it("write a key one way however it is typed [DESIGN] D30", () => {
    expect(normalize("shift+mod+p")).toBe("Mod+Shift+P");
    expect(normalize("Alt + F4")).toBe("Alt+F4");
  });

  it("show Mod as the platform names it [RULE] R-UI-1", () => {
    expect(shown("Mod+Shift+P", true)).toBe("Cmd+Shift+P");
    expect(shown("Mod+Shift+P", false)).toBe("Ctrl+Shift+P");
    expect(isMac("MacIntel")).toBe(true);
    expect(isMac("Win32")).toBe(false);
  });

  it("bind each command to its default unless the settings rebind or unbind it [DESIGN] D30", () => {
    const keys = bindings({ "palette.open": "Mod+Shift+P", "zoom.in": "Mod+=" }, { "zoom.in": "", "help.about": "f1" });
    expect(keys.get("Mod+Shift+P")).toBe("palette.open");
    expect(keys.get("Mod+=")).toBeUndefined();
    expect(keys.get("F1")).toBe("help.about");
  });
});
