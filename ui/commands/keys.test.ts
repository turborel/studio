import { defaultKeys } from "./commands";
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

  it("give the function keys' scheme F5 to run the script, F9 the statement and F6 to explain, a key bound apart on top [DESIGN] D69", () => {
    const studio = bindings(defaultKeys("default"), {});
    expect(studio.get("Mod+Enter")).toBe("worksheet.run");
    expect(studio.get("F5")).toBeUndefined();
    const keys = bindings(defaultKeys("functionKeys"), { "worksheet.run": "F4" });
    expect([keys.get("F5"), keys.get("F6"), keys.get("F9"), keys.get("F4")]).toEqual([
      "worksheet.runScript",
      "worksheet.explain",
      undefined,
      "worksheet.run",
    ]);
    expect(keys.get("Mod+Enter")).toBeUndefined();
    expect(keys.get("Mod+Shift+P")).toBe("palette.open");
  });

  it("give the debugger's commands the usual debuggers' keys, and the function keys' scheme its own [DESIGN] D73", () => {
    const studio = bindings(defaultKeys("default"), {});
    expect(["F8", "F11", "F10", "Shift+F11", "Shift+F8", "Shift+F5"].map((k) => studio.get(k))).toEqual([
      "debug.continue",
      "debug.stepInto",
      "debug.stepOver",
      "debug.stepOut",
      "debug.interrupt",
      "debug.stop",
    ]);
    const keys = bindings(defaultKeys("functionKeys"), {});
    expect(["F7", "F8", "Shift+F7", "Shift+F8", "Mod+Shift+F8", "Mod+F2"].map((k) => keys.get(k))).toEqual([
      "debug.stepInto",
      "debug.stepOver",
      "debug.stepOut",
      "debug.continue",
      "debug.interrupt",
      "debug.stop",
    ]);
  });
});
