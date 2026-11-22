import { emit } from "@tauri-apps/api/event";
import { act, fireEvent, render, screen, within as inside } from "@testing-library/react";
import { App, MENU_EVENT } from "./App";
import { connectSpec } from "./state/actions";
import { type Dialog, Store } from "./state/store";
import { mockBackend } from "./test/backend";

/** Renders the window over a store of its own, and waits for it to load. */
async function renderWindow(): Promise<Store> {
  const store = new Store();
  render(<App store={store} />);
  await act(async () => {
    await Promise.resolve();
  });
  return store;
}

describe("the window", () => {
  it("opens with the dock and a status bar saying no connection is open [DESIGN] D14", async () => {
    mockBackend();
    await renderWindow();
    expect(screen.getByRole("status", { name: "Status bar" }).textContent).toBe("Not connected");
    expect(document.querySelector(".dockview-theme-studio")).not.toBeNull();
  });

  it("applies the system's theme to the page [DESIGN] D20", async () => {
    mockBackend();
    await renderWindow();
    expect(document.documentElement.dataset["theme"]).toBe("light");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#A74C2E");
  });

  it("applies the theme the settings choose [DESIGN] D20", async () => {
    mockBackend({
      load_settings: () => ({
        format: 1,
        theme: "dark",
        zoomPercent: 120,
        editorFontFamily: "",
        editorFontPoints: 13,
        keyBindings: {},
        reconnectOnWake: true,
      }),
    });
    await renderWindow();
    expect(document.documentElement.dataset["theme"]).toBe("dark");
  });

  it("opens the command palette by its key [DESIGN] D30", async () => {
    mockBackend();
    await renderWindow();
    fireEvent.keyDown(window, { key: "p", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("dialog", { name: "Command Palette" })).toBeTruthy();
  });

  it("runs the command a menu item names [DESIGN] D30", async () => {
    mockBackend();
    await renderWindow();
    await act(async () => {
      await emit(MENU_EVENT, "help.about");
    });
    expect(screen.getByRole("dialog", { name: "About Turborel Studio" })).toBeTruthy();
  });
});

describe("the window's parts", () => {
  it("tints its frame by a production connection's colour [DESIGN] D32", async () => {
    mockBackend();
    const store = await renderWindow();
    await act(async () => {
      await connectSpec(store, "Prod", { user: "ann" }, { environment: "production", readOnly: false }, null);
    });
    const app = document.querySelector<HTMLElement>(".app");
    expect(app?.classList.contains("app-tinted")).toBe(true);
    expect(app?.style.getPropertyValue("--env-colour")).toBe("#B3261E");
  });

  it("shows each dialog the state names [DESIGN] D31", async () => {
    mockBackend();
    const store = await renderWindow();
    const names: Record<string, string> = {
      connection: "New Connection",
      settings: "Settings",
      shortcuts: "Keyboard Shortcuts",
    };
    for (const [kind, name] of Object.entries(names)) {
      act(() => {
        store.update((now) => ({
          ...now,
          dialog: kind === "connection" ? { kind, editing: null } : ({ kind } as never),
        }));
      });
      expect(screen.getByRole("dialog", { name })).toBeTruthy();
    }
  });

  it("shows the dialogs of the tasks, and keeps the webview's own menu to fields of text [DESIGN] D53", async () => {
    mockBackend({ catalog_analysis: () => ({ indexes: [], findings: [], settings: [] }) });
    const store = await renderWindow();
    const statement = { sql: "SELECT 1", from: 0, to: 8 };
    const dialogs: [Dialog, string][] = [
      [{ kind: "analyzer", connection: 1, schema: "ANN" }, "Analyze Schema ANN"],
      [{ kind: "analyzer", connection: 1, schema: "ANN", table: "T", tab: "settings" }, "Analyze Table ANN.T"],
      [
        {
          kind: "whatIf",
          whatIf: { worksheet: "w", statement, index: "I", create: "CREATE INDEX I ON T (A)", drop: "DROP INDEX I" },
        },
        "What If",
      ],
      [{ kind: "report", sql: "SELECT 1", chart: null }, "Save as Report"],
      [{ kind: "prompt", title: "Rename T", label: "New name", initial: "T", answer: () => undefined }, "Rename T"],
      [{ kind: "assistantSettings" }, "Assistant Settings"],
      [{ kind: "liveSettings" }, "Live Sessions Settings"],
      [{ kind: "liveJoin" }, "Join a Live Session"],
      [{ kind: "security", connection: 1, form: { kind: "createRole" } }, "New Role"],
    ];
    for (const [dialog, name] of dialogs) {
      act(() => {
        store.update((now) => ({ ...now, dialog }));
      });
      expect(screen.getByRole("dialog", { name })).toBeTruthy();
    }
    act(() => {
      store.update((now) => ({ ...now, dialog: null }));
    });
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    screen.getByRole("toolbar", { name: "Toolbar" }).dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    const field = document.createElement("input");
    screen.getByRole("toolbar", { name: "Toolbar" }).append(field);
    const inField = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    field.dispatchEvent(inField);
    expect(inField.defaultPrevented).toBe(false);
  });

  it("runs a toolbar button's command, and ignores keys bound to nothing [DESIGN] D30", async () => {
    mockBackend();
    const store = await renderWindow();
    fireEvent.keyDown(window, { key: "q", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    expect(store.current().dialog).toBeNull();
    const toolbar = screen.getByRole("toolbar", { name: "Toolbar" });
    fireEvent.click(inside(toolbar).getByRole("button", { name: "New Connection" }));
    expect(store.current().dialog).toEqual({ kind: "connection", editing: null });
  });

  it("shows the explorer's search by Find pressed within the explorer, and leaves Find to the worksheet elsewhere [DESIGN] D33", async () => {
    mockBackend();
    const store = await renderWindow();
    await act(async () => {
      await connectSpec(store, "X", { user: "ann" }, { environment: "development", readOnly: false }, null);
    });
    const explorer = document.createElement("div");
    explorer.setAttribute("role", "region");
    explorer.setAttribute("aria-label", "Object Explorer");
    const row = document.createElement("button");
    explorer.append(row);
    document.body.append(explorer);
    fireEvent.keyDown(document.body, { key: "f", ctrlKey: true });
    expect(store.current().explorerSearch).toBe(false);
    fireEvent.keyDown(row, { key: "f", ctrlKey: true });
    expect(store.current().explorerSearch).toBe(true);
    explorer.remove();
  });

  it("checks connections as the window is shown again [DESIGN] D24", async () => {
    const asked = mockBackend();
    const store = await renderWindow();
    await act(async () => {
      await connectSpec(store, "X", { user: "ann" }, { environment: "development", readOnly: false }, null);
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(asked.map((a) => a.command)).toContain("ping_connection");
  });
});
