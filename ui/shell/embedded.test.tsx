import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { PlugIns } from "../admin/PlugIns";
import type { SessionState } from "../ipc/connections";
import type { DirectoryCheck } from "../ipc/embedded";
import type { SavedConnection } from "../ipc/saved";
import { connectSpec, disconnect, endAndClose, newInMemory, told } from "../state/actions";
import { Store, StoreContext, useStudio } from "../state/store";
import { type Asked, SESSION, mockBackend } from "../test/backend";
import { refused } from "../test/catalog";
import { ConnectionsPanel, editSaved, savedMenu } from "./ConnectionsPanel";
import { ExplorerToolbar } from "../explorer/ExplorerToolbar";
import { ContextMenu } from "./ContextMenu";
import { EmbeddedDialog } from "./EmbeddedDialog";
import {
  baseName,
  embeddedFormOf,
  embeddedSpecOf,
  invalidEmbedded,
  judge,
  savedOfEmbedded,
  serverSpec,
} from "./embeddedForm";
import { ErrorBanner, NoticeBanner } from "./ErrorBanner";
import { OpenTransactionsDialog } from "./OpenTransactionsDialog";
import { StatusBar } from "./StatusBar";

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

/** An embedded database's session. */
const EMBEDDED: SessionState = { ...SESSION, server: "turborel 0.0.0 (alpha) (embedded)", transport: "embedded" };

/** A saved embedded database. */
const ORDERS: SavedConnection = {
  id: "orders",
  name: "Orders",
  folder: ["Local"],
  spec: {},
  environment: "development",
  colour: null,
  readOnly: false,
  pinned: false,
  favourites: [],
  embedded: { directory: "/data/orders", keys: "/keys", checksumKey: "CHECKS", pluginDirectories: null, user: null },
};

/** What a folder chosen holds. */
function holding(
  holds: DirectoryCheck["holds"],
  held = false,
  server: DirectoryCheck["server"] = null,
): DirectoryCheck {
  return { holds, held, server };
}

/** The dialog shown by the store, as the window shows it. */
function DialogKind() {
  const kind = useStudio((s) => s.dialog?.kind ?? "none");
  return <output aria-label="dialog">{kind}</output>;
}

/** The commands asked named `command`. */
function calls(asked: readonly Asked[], command: string): Asked[] {
  return asked.filter((a) => a.command === command);
}

describe("the embedded database form", () => {
  it("opens only a database, makes one only in an empty or new folder, and refuses one held elsewhere [DESIGN] D59", () => {
    expect(judge("open", "/d", holding("database")).ok).toBe(true);
    expect(judge("open", "/d", holding("nothing")).message).toBe("There is no folder /d.");
    expect(judge("open", "/d", holding("empty")).message).toContain("holds no database. New Database… makes one.");
    expect(judge("open", "/d", holding("other")).ok).toBe(false);
    expect(judge("new", "/d", holding("nothing")).ok).toBe(true);
    expect(judge("new", "/d", holding("empty")).ok).toBe(true);
    expect(judge("new", "/d", holding("database")).message).toContain("holds a database already");
    expect(judge("new", "/d", holding("other")).message).toContain("is not empty");
    const port = judge("open", "/d", holding("database", true, { kind: "port", port: 7422 }));
    expect(port.message).toContain("open in another process");
    expect(port.message).toContain("port 7422");
    expect(serverSpec({ kind: "port", port: 7422 })).toEqual({
      host: "localhost",
      port: "7422",
      tlsMode: "verify-full",
    });
    const socket = judge("open", "/d", holding("database", true, { kind: "socket", path: "/d/s" }));
    expect(socket.message).toContain("socket");
    expect(serverSpec({ kind: "socket", path: "/d/s" })).toEqual({ host: "/d/s" });
    expect(judge("open", "/d", holding("database", true)).message).toContain("Connect to the server that serves it");
  });

  it("saves the folder and where the keys are, never a key, and is read back [DESIGN] D59", () => {
    const form = embeddedFormOf(ORDERS, "new", "ANN");
    expect(form.mode).toBe("open");
    expect(form.folder).toBe("Local");
    const saved = savedOfEmbedded(form);
    expect(saved.embedded).toEqual(ORDERS.embedded);
    expect(saved.spec).toEqual({});
    expect(embeddedSpecOf(form)).toMatchObject({
      create: false,
      keys: "/keys",
      place: { kind: "directory", path: "/data/orders" },
    });
    const fresh = embeddedFormOf(null, "new", "ANN");
    expect(fresh.mode).toBe("new");
    expect(fresh.user).toBe("ANN");
    expect(invalidEmbedded(fresh)).toBe("Choose the database's folder.");
    expect(invalidEmbedded({ ...fresh, directory: "/d" })).toBe("A database needs a name.");
    expect(invalidEmbedded({ ...fresh, directory: "/d", name: "D", user: "1x" })).toContain("letters, digits");
    expect(invalidEmbedded({ ...fresh, directory: "/d", name: "D" })).toBeNull();
    expect(embeddedFormOf(null, "open", "ANN").user).toBe("");
    expect(baseName("/data/orders/")).toBe("orders");
    expect(baseName("C:\\data\\sales")).toBe("sales");
  });
});

describe("the embedded database dialog", () => {
  it("opens a folder chosen that holds a database, saved nowhere [DESIGN] D59", async () => {
    const asked = mockBackend({
      choose_database_directory: () => ({ path: "/data/orders", check: holding("database") }),
      open_embedded: () => ({ connection: 4, session: EMBEDDED, told: null }),
    });
    const store = new Store();
    within(store, <EmbeddedDialog mode="open" editing={null} />);
    expect(screen.getByRole("button", { name: "Open without Saving" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Choose the database folder" }));
    await settle();
    expect(screen.getByDisplayValue("orders")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Open without Saving" }));
    await settle();
    const spec = calls(asked, "open_embedded")[0]?.args["spec"];
    expect(spec).toEqual({
      place: { kind: "directory", path: "/data/orders" },
      create: false,
      keys: null,
      checksumKey: null,
      pluginDirectories: null,
      user: null,
    });
    expect(store.current().open[0]?.session.transport).toBe("embedded");
  });

  it("refuses a folder another process holds, and offers its server [DESIGN] D59", async () => {
    mockBackend({
      choose_database_directory: () => ({
        path: "/data/held",
        check: holding("database", true, { kind: "port", port: 7422 }),
      }),
    });
    const store = new Store();
    within(
      store,
      <>
        <EmbeddedDialog mode="open" editing={null} />
        <DialogKind />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose the database folder" }));
    await settle();
    expect(screen.getByRole("alert").textContent).toContain("open in another process");
    expect(screen.getByRole("button", { name: "Save and Open" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Connect to Its Server…" }));
    expect(store.current().dialog).toEqual({
      kind: "connection",
      editing: null,
      spec: serverSpec({ kind: "port", port: 7422 }),
    });
  });

  it("makes a database owned by the user offered, then saves it to be opened, never made [DESIGN] D59", async () => {
    const asked = mockBackend({
      default_owner: () => "ANN",
      choose_database_directory: () => ({ path: "/data/new", check: holding("empty") }),
      choose_keys_directory: () => "/keys",
      open_embedded: () => ({ connection: 5, session: EMBEDDED, told: null }),
      save_connection: (args) => ({ ...(args["connection"] as SavedConnection), id: "new-id" }),
    });
    const store = new Store();
    within(store, <EmbeddedDialog mode="new" editing={null} />);
    await settle();
    expect(screen.getByDisplayValue("ANN")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Choose the database folder" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Choose the keys directory" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Clear the keys directory" }));
    fireEvent.click(screen.getByRole("button", { name: "Create and Save" }));
    await settle();
    expect(calls(asked, "open_embedded")[0]?.args["spec"]).toMatchObject({ create: true, user: "ANN", keys: null });
    const saved = calls(asked, "save_connection")[0]?.args["connection"] as SavedConnection;
    expect(saved.embedded?.directory).toBe("/data/new");
    expect(store.current().open[0]?.savedId).toBe("new-id");
  });

  it("edits a saved database, and opens it as saved [DESIGN] D59", async () => {
    const asked = mockBackend({
      save_connection: (args) => args["connection"],
      open_saved_connection: () => ({ connection: 6, session: EMBEDDED, told: null }),
    });
    const store = new Store();
    within(store, <EmbeddedDialog mode="open" editing={ORDERS} />);
    expect(screen.queryByRole("button", { name: "Open without Saving" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save and Open" }));
    await settle();
    expect(calls(asked, "open_saved_connection")[0]?.args["id"]).toBe("orders");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await settle();
    expect(calls(asked, "save_connection")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });
});

describe("embedded databases among the connections", () => {
  it("shows a saved database's folder, edits it in its own dialog, and marks one in memory as not saved [DESIGN] D59", async () => {
    mockBackend({
      list_saved_connections: () => ({ connections: [{ connection: ORDERS, passwordSaved: false }], recent: [] }),
      open_embedded: () => ({ connection: 7, session: { ...EMBEDDED, transport: "inMemory" }, told: "not saved" }),
    });
    const store = new Store();
    store.update((now) => ({
      ...now,
      saved: { connections: [{ connection: ORDERS, passwordSaved: false }], recent: [] },
    }));
    within(
      store,
      <>
        <ExplorerToolbar />
        <ConnectionsPanel />
        <StatusBar />
        <NoticeBanner />
        <ContextMenu />
      </>,
    );
    expect(screen.getByText("/data/orders", { exact: false })).toBeDefined();
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: ORDERS.name }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit Connection…" }));
    expect(store.current().dialog).toEqual({ kind: "embedded", mode: "open", editing: ORDERS });
    fireEvent.click(screen.getByRole("button", { name: "Open Database" }));
    expect(store.current().dialog).toMatchObject({ kind: "embedded", mode: "open", editing: null });
    fireEvent.click(screen.getByRole("button", { name: "New Database" }));
    expect(store.current().dialog).toMatchObject({ kind: "embedded", mode: "new" });
    fireEvent.click(screen.getByRole("button", { name: "New In-Memory Database" }));
    await settle();
    expect(screen.getByText("not saved")).toBeDefined();
    expect(screen.getByRole("status", { name: "Status bar" }).textContent).toContain("In-memory, not saved");
    expect(store.current().notices).toEqual([]);
    await act(() => newInMemory(store));
    expect(store.current().open.map((c) => c.name)).toEqual(["In-memory", "In-memory 2"]);
    editSaved(store, { ...ORDERS, embedded: null });
    expect(store.current().dialog).toMatchObject({ kind: "connection" });
  });

  it("tells a database recovered as it opened [DESIGN] D59", async () => {
    mockBackend({ open_connection: () => ({ connection: 1, session: EMBEDDED, told: "It was recovered." }) });
    const store = new Store();
    await connectSpec(store, "Kept", { user: "ann" }, { environment: "development", readOnly: false }, null);
    within(
      store,
      <>
        <NoticeBanner />
        <StatusBar />
        <ErrorBanner />
      </>,
    );
    expect(screen.getByText("Kept: It was recovered.")).toBeDefined();
    expect(screen.getByRole("status", { name: "Status bar" }).textContent).toContain("Embedded");
  });
});

/** A store with connection 1 open, its transaction active or not. */
async function withTransaction(active: boolean): Promise<Store> {
  const store = new Store();
  await connectSpec(store, "Orders", { user: "ann" }, { environment: "development", readOnly: false }, null);
  store.update((now) => ({
    ...now,
    open: now.open.map((c) => ({ ...c, session: { ...c.session, transaction: { ...c.session.transaction, active } } })),
  }));
  return store;
}

describe("an open transaction as a connection closes or Studio quits", () => {
  it("is asked about before disconnecting, then committed and the connection closed [DESIGN] D59", async () => {
    const asked = mockBackend({
      run_statement: () => ({
        kind: "ran",
        answer: { outcome: null, warnings: [], serverTime: null, session: SESSION },
      }),
    });
    const store = await withTransaction(true);
    await disconnect(store, 1);
    expect(store.current().dialog).toEqual({ kind: "openTransactions", connections: [1], quitting: false });
    within(store, <OpenTransactionsDialog connections={[1]} quitting={false} />);
    expect(screen.getByText(/Orders has a transaction open/u)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    await settle();
    expect(calls(asked, "run_statement")[0]?.args["sql"]).toBe("COMMIT");
    expect(calls(asked, "close_connection")).toHaveLength(1);
    expect(store.current().open).toEqual([]);
  });

  it("quits at once with none open, else asks, and ends them as answered [DESIGN] D59", async () => {
    const asked = mockBackend();
    const idle = await withTransaction(false);
    told(idle, { kind: "quitAsked" });
    await settle();
    expect(calls(asked, "quit_studio")[0]?.args).toEqual({ ending: "rollback" });
    const busy = await withTransaction(true);
    told(busy, { kind: "quitAsked" });
    await settle();
    expect(busy.current().dialog).toEqual({ kind: "openTransactions", connections: [1], quitting: true });
    within(busy, <OpenTransactionsDialog connections={[1, 2]} quitting />);
    expect(screen.getByText(/Before Studio quits/u)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Roll Back" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    await settle();
    expect(calls(asked, "quit_studio").map((a) => a.args["ending"])).toEqual(["rollback", "rollback", "commit"]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(busy.current().dialog).toBeNull();
  });
});

describe("the monitor's plug-ins", () => {
  it("lists an embedded database's plug-ins, and says a server's are its own [DESIGN] D59", async () => {
    mockBackend({
      embedded_info: (args) =>
        args["connection"] === 1
          ? {
              place: { kind: "memory" },
              user: "ANN",
              plugIns: [{ name: "LZ4", kind: "encoding", loaded: true, note: "compression" }],
            }
          : args["connection"] === 2
            ? null
            : Promise.reject(new Error("gone")),
    });
    const store = new Store();
    const { unmount } = within(store, <PlugIns connection={1}>extensions</PlugIns>);
    expect(screen.getByText("Reading…")).toBeDefined();
    await settle();
    expect(screen.getByRole("table", { name: "Plug-ins" }).textContent).toContain("LZ4");
    unmount();
    const server = within(store, <PlugIns connection={2}>extensions</PlugIns>);
    await settle();
    expect(screen.getByText(/A server registers its own plug-ins/u)).toBeDefined();
    server.unmount();
    within(store, <PlugIns connection={3}>extensions</PlugIns>);
    await settle();
    expect(screen.getByText(/gone/u)).toBeDefined();
  });
});

describe("the embedded database dialog at its edges", () => {
  it("takes every field, keeps a folder cancelled, and saves a database opened [DESIGN] D59", async () => {
    let chosen = 0;
    const asked = mockBackend({
      choose_database_directory: () => {
        chosen += 1;
        return chosen === 1 ? null : { path: "/data/orders", check: holding("database") };
      },
      choose_keys_directory: () => null,
      save_connection: (args) => args["connection"],
      open_embedded: () =>
        refused({
          sqlcode: -910,
          sqlstate: "TB910",
          message: "refused",
          rule: null,
          position: null,
          active: false,
          diagnostics: null,
        }),
    });
    const store = new Store();
    within(store, <EmbeddedDialog mode="open" editing={null} />);
    const choose = screen.getByRole("button", { name: "Choose the database folder" });
    fireEvent.click(choose);
    await settle();
    expect(screen.getAllByText("None chosen")).toHaveLength(2);
    fireEvent.click(choose);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Choose the keys directory" }));
    await settle();
    const typed: [string, string][] = [
      ["Folder in the explorer", "Team"],
      ["Colour", "#112233"],
      ["Act as (else its owner)", "BOB"],
      ["Checksum key, by its name in the keys directory", "CHECKS"],
      ["Plug-in directories, separated by ;", "/plug-ins"],
    ];
    for (const [label, value] of typed) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.change(screen.getByLabelText("Environment"), { target: { value: "production" } });
    fireEvent.click(screen.getByLabelText("Read-only: begin each transaction READ ONLY"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await settle();
    const saved = calls(asked, "save_connection")[0]?.args["connection"] as SavedConnection;
    expect(saved).toMatchObject({ folder: ["Team"], colour: "#112233", environment: "production", readOnly: true });
    expect(saved.embedded).toMatchObject({
      user: "BOB",
      checksumKey: "CHECKS",
      pluginDirectories: "/plug-ins",
      keys: null,
    });
    expect(store.current().dialog).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open without Saving" }));
    await settle();
    expect(store.current().error?.message).toBe("refused");
    expect(store.current().open).toEqual([]);
  });

  it("rolls back a transaction as it disconnects, and keeps one that would not end [DESIGN] D59", async () => {
    let ends = 0;
    const asked = mockBackend({
      run_statement: () => {
        ends += 1;
        const active = ends > 1;
        return {
          kind: "ran",
          answer: {
            outcome: null,
            warnings: [],
            serverTime: null,
            session: { ...SESSION, transaction: { ...SESSION.transaction, active } },
          },
        };
      },
    });
    const store = await withTransaction(true);
    await endAndClose(store, { connections: [1], quitting: false }, "rollback");
    expect(calls(asked, "run_statement")[0]?.args["sql"]).toBe("ROLLBACK");
    expect(store.current().open).toEqual([]);
    const kept = await withTransaction(true);
    await endAndClose(kept, { connections: [1], quitting: false }, "commit");
    expect(kept.current().open).toHaveLength(1);
    const idle = await withTransaction(false);
    await disconnect(idle, 1);
    expect(idle.current().open).toEqual([]);
  });
});

describe("an embedded database's saving that fails", () => {
  it("keeps the dialog open, a name typed kept, and its menu copies its folder [DESIGN] D59", async () => {
    const no = () =>
      refused({
        sqlcode: -910,
        sqlstate: "TB910",
        message: "no",
        rule: null,
        position: null,
        active: false,
        diagnostics: null,
      });
    const asked = mockBackend({
      choose_database_directory: () => ({ path: "/data/fresh", check: holding("empty") }),
      default_owner: () => "ANN",
      save_connection: no,
      open_embedded: () => ({ connection: 9, session: EMBEDDED, told: null }),
    });
    const store = new Store();
    const { unmount } = within(store, <EmbeddedDialog mode="new" editing={null} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Choose the database folder" }));
    await settle();
    expect(screen.getByDisplayValue("Mine")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Create and Save" }));
    await settle();
    expect(store.current().open[0]?.savedId).toBeNull();
    unmount();
    const editing = {
      ...ORDERS,
      embedded: { directory: "/data/orders", keys: null, checksumKey: null, user: "BOB", pluginDirectories: "/p" },
    };
    expect(embeddedFormOf(editing, "open", "")).toMatchObject({ user: "BOB", pluginDirectories: "/p" });
    within(store, <EmbeddedDialog mode="open" editing={editing} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Save and Open" }));
    await settle();
    expect(calls(asked, "open_saved_connection")).toEqual([]);
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: (t: string) => Promise.resolve(copied.push(t)) },
      configurable: true,
    });
    const item = savedMenu(store, ORDERS).find((i) => i !== "separator" && i.label === "Copy Folder Path");
    if (item === undefined || item === "separator") {
      throw new Error("no Copy Folder Path");
    }
    await act(async () => {
      await item.run?.();
    });
    expect(copied).toEqual(["/data/orders"]);
  });
});
