import { act, fireEvent, render, screen, within as inside } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CommandContext } from "../commands/commands";
import { connectSpec, show } from "../state/actions";
import { Store, StoreContext } from "../state/store";
import { SESSION, mockBackend } from "../test/backend";
import { CommandPalette, matches } from "./CommandPalette";
import { ConnectionDialog } from "./ConnectionDialog";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { ContextMenu } from "./ContextMenu";
import { ErrorBanner } from "./ErrorBanner";
import { AboutDialog, ShortcutsDialog } from "./HelpDialogs";
import { rebound, SettingsDialog } from "./SettingsDialog";
import { StatusBar, transactionState } from "./StatusBar";
import { Toolbar } from "./Toolbar";

/** Renders `children` within `store`. */
function within(store: Store, children: ReactNode) {
  return render(<StoreContext.Provider value={store}>{children}</StoreContext.Provider>);
}

/** Lets the backend's answers settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((settled) => setTimeout(settled, 0));
  });
}

/** A context that resets no layout. */
function context(store: Store): CommandContext {
  return { store, resetLayout: () => undefined };
}

describe("the status bar", () => {
  it("shows the session, its transaction and that TLS secures it [RULE] R-SEC-3", async () => {
    mockBackend();
    const store = new Store();
    await connectSpec(store, "Orders", { user: "ann" }, { environment: "production", readOnly: true }, null);
    within(store, <StatusBar />);
    const bar = screen.getByRole("status", { name: "Status bar" }).textContent;
    expect(bar).toContain("Orders (Production)");
    expect(bar).toContain("ANN · ANN");
    expect(bar).toContain("Read-only connection");
    expect(bar).toContain("TLS");
  });

  it("shows a replica and the server's time [CLIENT What the server tells]", async () => {
    mockBackend({
      open_connection: () => ({
        connection: 1,
        session: { ...SESSION, serverReadOnly: true, schema: null },
        told: null,
      }),
    });
    const store = new Store();
    await connectSpec(store, "R", { user: "ann" }, { environment: "test", readOnly: false }, null);
    store.update((now) => ({
      ...now,
      open: now.open.map((c) => ({ ...c, serverTime: { total: 1500, queued: 0, locks: 0 } })),
    }));
    within(store, <StatusBar />);
    const bar = screen.getByRole("status", { name: "Status bar" }).textContent;
    expect(bar).toContain("Replica");
    expect(bar).toContain("1.5 ms");
    expect(bar).toContain("R (Test)");
  });

  it("says plainly that a connection over plain TCP is not secure [RULE] R-SEC-3", async () => {
    mockBackend({
      open_connection: () => ({ connection: 1, session: { ...SESSION, transport: "plain" }, told: null }),
    });
    const store = new Store();
    await connectSpec(store, "Dev", { user: "ann" }, { environment: "development", readOnly: false }, null);
    within(store, <StatusBar />);
    expect(screen.getByText("NOT SECURE")).toBeTruthy();
  });

  it("names the transaction's state [CLIENT What the server tells]", () => {
    expect(transactionState(SESSION)).toBe("No transaction");
    expect(transactionState({ ...SESSION, transaction: { active: true, autocommit: false, readOnly: true } })).toBe(
      "Transaction active, read only",
    );
    expect(transactionState({ ...SESSION, transaction: { active: false, autocommit: true, readOnly: false } })).toBe(
      "Autocommit",
    );
  });
});

describe("the connection dialog", () => {
  it("saves a connection, its password in the keychain, and connects [DESIGN] D28", async () => {
    const asked = mockBackend({ save_connection: (args) => ({ ...(args["connection"] as object), id: "new" }) });
    const store = new Store();
    within(store, <ConnectionDialog editing={null} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Orders" } });
    fireEvent.change(screen.getByLabelText("User"), { target: { value: "ann" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "ann's secret" } });
    fireEvent.click(screen.getByLabelText("Save the password in the keychain"));
    fireEvent.click(screen.getByRole("button", { name: "Save and Connect" }));
    await settle();
    const saved = asked.find((a) => a.command === "save_connection");
    expect(saved?.args["password"]).toEqual({ kind: "save", password: "ann's secret" });
    expect(saved?.args["connection"]).toMatchObject({ name: "Orders", spec: { user: "ann", tlsMode: "verify-full" } });
    expect(store.current().open[0]?.name).toBe("Orders");
  });

  it("will not save a connection with no name, saying why [RULE] R-SEC-6", () => {
    mockBackend();
    within(new Store(), <ConnectionDialog editing={null} />);
    expect(screen.getByText("A connection needs a name.")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
  });

  it("closes on Escape [RULE] R-UI-1", () => {
    mockBackend();
    const store = new Store();
    show(store, { kind: "connection", editing: null });
    within(store, <ConnectionDialog editing={null} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(store.current().dialog).toBeNull();
  });
});

describe("the command palette", () => {
  it("finds commands by every word typed, in any case [DESIGN] D30", () => {
    expect(matches("View Zoom In", "zoom in")).toBe(true);
    expect(matches("View Zoom In", "zoom out")).toBe(false);
  });

  it("runs the command chosen by Enter [DESIGN] D30", () => {
    mockBackend();
    const store = new Store();
    within(store, <CommandPalette context={context(store)} />);
    const input = screen.getByRole("combobox", { name: "Command" });
    fireEvent.change(input, { target: { value: "about" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(store.current().dialog).toEqual({ kind: "about" });
  });
});

describe("the settings", () => {
  it("rebind a key, and forget a binding back at its default [DESIGN] D30", () => {
    expect(rebound({}, "zoom.in", "mod+shift+=", "Mod+=")).toEqual({ "zoom.in": "Mod+Shift+=" });
    expect(rebound({ "zoom.in": "Mod+Shift+=" }, "zoom.in", "Mod+=", "Mod+=")).toEqual({});
    expect(rebound({}, "zoom.in", "", "Mod+=")).toEqual({ "zoom.in": "" });
  });

  it("save the theme chosen [RULE] R-FMT-1", async () => {
    const asked = mockBackend();
    const store = new Store();
    within(store, <SettingsDialog />);
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "dark" } });
    await settle();
    expect(asked.find((a) => a.command === "save_settings")?.args["settings"]).toMatchObject({ theme: "dark" });
  });

  it("choose the function keys' scheme, each command showing the scheme's key, a key bound apart kept [DESIGN] D69", async () => {
    const asked = mockBackend();
    const store = new Store();
    store.update((now) => ({
      ...now,
      settings: { ...now.settings, keyBindings: { "worksheet.explain": "Mod+Alt+E" } },
    }));
    within(store, <SettingsDialog />);
    fireEvent.change(screen.getByLabelText("Scheme"), { target: { value: "functionKeys" } });
    await settle();
    expect(asked.find((a) => a.command === "save_settings")?.args["settings"]).toMatchObject({
      keyScheme: "functionKeys",
      keyBindings: { "worksheet.explain": "Mod+Alt+E" },
    });
    expect(screen.getByLabelText<HTMLInputElement>("Run Script").value).toBe("F5");
    expect(screen.getByLabelText<HTMLInputElement>("Explain").value).toBe("Mod+Alt+E");
    fireEvent.blur(screen.getByLabelText("Run Statement"), { target: { value: "F9" } });
    expect(store.current().settings.keyBindings).toEqual({ "worksheet.explain": "Mod+Alt+E" });
  });
});

describe("the explorer's connections", () => {
  it("lists the saved connections and connects one [DESIGN] D28", async () => {
    const view = {
      connection: {
        id: "ab",
        name: "Orders",
        folder: ["Team"],
        spec: { user: "ann" },
        environment: "test",
        colour: null,
        readOnly: false,
        pinned: true,
      },
      passwordSaved: true,
    };
    const asked = mockBackend({ list_saved_connections: () => ({ connections: [view], recent: ["ab"] }) });
    const store = new Store();
    store.update((now) => ({ ...now, saved: { connections: [view as never], recent: ["ab"] } }));
    within(store, <ConnectionsPanel />);
    expect(screen.getByText("Team")).toBeTruthy();
    const saved = screen.getAllByRole("treeitem", { name: "Orders" })[0] ?? document.body;
    expect(saved.querySelectorAll("button")).toHaveLength(0);
    fireEvent.doubleClick(saved);
    await settle();
    expect(asked.find((a) => a.command === "open_saved_connection")?.args).toEqual({ id: "ab", password: null });
    const open = inside(screen.getByRole("tree", { name: "Open connections" })).getByRole("treeitem", {
      name: "Orders",
    });
    expect(inside(open).getByRole("img", { name: "open" })).toBeTruthy();
    fireEvent.keyDown(screen.getAllByRole("treeitem", { name: "Orders" })[1] ?? document.body, { key: "Enter" });
    await settle();
    expect(asked.filter((a) => a.command === "open_saved_connection")).toHaveLength(2);
  });

  it("asks before deleting a saved connection [RULE] R-SEC-8", async () => {
    const view = {
      connection: {
        id: "ab",
        name: "Orders",
        folder: [],
        spec: {},
        environment: "development",
        colour: null,
        readOnly: false,
        pinned: false,
      },
      passwordSaved: false,
    };
    const asked = mockBackend();
    const store = new Store();
    store.update((now) => ({ ...now, saved: { connections: [view as never], recent: [] } }));
    within(
      store,
      <>
        <ConnectionsPanel />
        <ContextMenu />
      </>,
    );
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Orders" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    await settle();
    expect(asked.map((a) => a.command)).not.toContain("delete_saved_connection");
    const asking = store.current().dialog;
    if (asking?.kind !== "prompt") {
      throw new Error("Delete asked nothing");
    }
    asking.answer("Orders");
    await settle();
    expect(asked.map((a) => a.command)).toContain("delete_saved_connection");
  });
});

describe("the rest of the window", () => {
  it("enables the toolbar's connection commands once one is active [RULE] R-UI-3", async () => {
    mockBackend();
    const store = new Store();
    within(store, <Toolbar context={context(store)} />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Disconnect" }).disabled).toBe(true);
    await act(async () => {
      await connectSpec(store, "X", { user: "ann" }, { environment: "development", readOnly: false }, null);
    });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Disconnect" }).disabled).toBe(false);
  });

  it("shows a failure as text until dismissed [RULE] R-ERR-2", () => {
    const store = new Store();
    store.update((now) => ({
      ...now,
      error: {
        sqlcode: -103,
        sqlstate: "42000",
        message: "<b>not markup</b>",
        rule: null,
        position: null,
        active: false,
        diagnostics: null,
      },
    }));
    within(store, <ErrorBanner />);
    expect(screen.getByRole("alert").textContent).toContain("<b>not markup</b>");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(store.current().error).toBeNull();
  });

  it("shows the version and the Turborel commit, and every key [DESIGN] D5", async () => {
    mockBackend();
    const store = new Store();
    within(store, <AboutDialog />);
    await settle();
    expect(screen.getByText("32e1334d37c7b4ca489491eed7b216a2d778bff1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    within(store, <ShortcutsDialog />);
    expect(screen.getByText("View: Command Palette…")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0] ?? document.body);
    expect(store.current().dialog).toBeNull();
  });
});

describe("the dialogs' keys and fields", () => {
  it("keep Tab within a dialog [RULE] R-UI-1", () => {
    mockBackend();
    const store = new Store();
    within(store, <AboutDialog />);
    const close = screen.getByRole("button", { name: "Close" });
    close.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(close);
  });

  it("choose a command by the arrows [RULE] R-UI-1", () => {
    mockBackend();
    const store = new Store();
    within(store, <CommandPalette context={context(store)} />);
    const input = screen.getByRole("combobox", { name: "Command" });
    fireEvent.change(input, { target: { value: "theme" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[1]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getAllByRole("option")[2] ?? document.body);
    expect(store.current().settings.theme).toBe("dark");
  });

  it("connect without saving, under the guards chosen [DESIGN] D29", async () => {
    const asked = mockBackend();
    const store = new Store();
    within(store, <ConnectionDialog editing={null} />);
    fireEvent.change(screen.getByLabelText("URI"), { target: { value: "turborel://ann@db.example" } });
    fireEvent.change(screen.getByLabelText("Environment"), { target: { value: "production" } });
    fireEvent.click(screen.getByLabelText("Read-only: begin each transaction READ ONLY"));
    fireEvent.change(screen.getByLabelText("TLS mode"), { target: { value: "verify-ca" } });
    fireEvent.change(screen.getByLabelText("Authorities (PEM file)"), { target: { value: "/etc/ca.pem" } });
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "orders" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect without Saving" }));
    await settle();
    expect(asked.find((a) => a.command === "open_connection")?.args).toEqual({
      spec: { uri: "turborel://ann@db.example", tlsMode: "verify-ca", tlsRoots: "/etc/ca.pem", service: "orders" },
      guards: { environment: "production", readOnly: true },
      password: null,
    });
  });

  it("edit a saved connection, keeping its password [RULE] R-SEC-1", async () => {
    const editing = {
      id: "ab",
      name: "Orders",
      folder: [],
      spec: { user: "ann" },
      environment: "test",
      colour: null,
      readOnly: false,
      pinned: false,
      favourites: [],
    } as const;
    const asked = mockBackend({ save_connection: (args) => args["connection"] });
    const store = new Store();
    store.update((now) => ({ ...now, keychain: { available: false, reason: "no Secret Service" } }));
    within(store, <ConnectionDialog editing={editing} />);
    expect(screen.getByText("The keychain is not open: no Secret Service")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "Team" } });
    fireEvent.change(screen.getByLabelText("Colour"), { target: { value: "#00ff00" } });
    fireEvent.click(screen.getByLabelText("Pinned at the top of the explorer"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await settle();
    expect(asked.find((a) => a.command === "save_connection")?.args).toEqual({
      connection: { ...editing, folder: ["Team"], colour: "#00FF00", pinned: true },
      password: { kind: "keep" },
    });
    expect(store.current().dialog).toBeNull();
  });

  it("change the zoom, the font and a key, each within its bounds [DESIGN] D30", async () => {
    const asked = mockBackend();
    const store = new Store();
    within(store, <SettingsDialog />);
    fireEvent.change(screen.getByLabelText("Zoom (%)"), { target: { value: "999" } });
    fireEvent.change(screen.getByLabelText("Editor font"), { target: { value: "Menlo" } });
    fireEvent.change(screen.getByLabelText("Editor font size (points)"), { target: { value: "2" } });
    fireEvent.click(screen.getByLabelText("Check connections as the computer wakes, and connect lost ones again"));
    fireEvent.blur(screen.getByLabelText("Zoom In"), { target: { value: "mod+shift+=" } });
    await settle();
    expect(store.current().settings).toMatchObject({
      zoomPercent: 300,
      editorFontFamily: "Menlo",
      editorFontPoints: 8,
      reconnectOnWake: false,
      keyBindings: { "zoom.in": "Mod+Shift+=" },
    });
    expect(asked.filter((a) => a.command === "save_settings").length).toBeGreaterThan(0);
  });

  it("pin a saved connection, and show an open one lost [DESIGN] D28", async () => {
    const view = {
      connection: {
        id: "ab",
        name: "Orders",
        folder: [],
        spec: {},
        environment: "development",
        colour: null,
        readOnly: false,
        pinned: false,
      },
      passwordSaved: false,
    };
    const asked = mockBackend({
      save_connection: (args) => args["connection"],
      list_saved_connections: () => ({ connections: [view], recent: [] }),
    });
    const store = new Store();
    store.update((now) => ({ ...now, saved: { connections: [view as never], recent: [] } }));
    await connectSpec(store, "Live", { user: "ann" }, { environment: "development", readOnly: false }, null);
    store.update((now) => ({ ...now, open: now.open.map((c) => ({ ...c, session: { ...c.session, lost: true } })) }));
    within(
      store,
      <>
        <ConnectionsPanel />
        <ContextMenu />
      </>,
    );
    const live = screen.getByRole("treeitem", { name: "Live" });
    expect(inside(live).getByRole("img", { name: "lost" })).toBeTruthy();
    const orders = screen.getByRole("treeitem", { name: "Orders" });
    fireEvent.contextMenu(orders);
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin" }));
    await settle();
    expect(asked.find((a) => a.command === "save_connection")?.args["connection"]).toMatchObject({ pinned: true });
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Orders" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await settle();
    expect(asked.filter((a) => a.command === "save_connection").at(-1)?.args["connection"]).toMatchObject({
      id: "",
      name: "Orders (copy)",
    });
    fireEvent.keyDown(screen.getByRole("treeitem", { name: "Orders" }), { key: "F10", shiftKey: true });
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit Connection…" }));
    expect(store.current().dialog).toMatchObject({ kind: "connection" });
  });
});
