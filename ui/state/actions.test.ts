import type { SavedConnection } from "../ipc/saved";
import { SESSION, mockBackend } from "../test/backend";
import {
  activate,
  changeSettings,
  checkAfterWake,
  connectSaved,
  connectSpec,
  disconnect,
  dismissError,
  endTransaction,
  forget,
  loadAll,
  reconnectOpen,
  save,
  told,
} from "./actions";
import { Store } from "./store";

const SAVED: SavedConnection = {
  id: "ab",
  name: "Orders",
  folder: [],
  spec: { host: "db.example", user: "ann" },
  environment: "production",
  colour: null,
  readOnly: true,
  pinned: false,
  favourites: [],
};

describe("the actions", () => {
  it("load the settings, the saved connections and the keychain's status [DESIGN] D31", async () => {
    mockBackend({ keychain_status: () => ({ available: false, reason: "no Secret Service" }) });
    const store = new Store();
    await loadAll(store);
    expect(store.current().keychain).toEqual({ available: false, reason: "no Secret Service" });
  });

  it("open a saved connection with its guards, and keep no password [RULE] R-SEC-1", async () => {
    const asked = mockBackend();
    const store = new Store();
    await connectSaved(store, SAVED, null);
    expect(asked.find((a) => a.command === "open_saved_connection")?.args).toEqual({ id: "ab", password: null });
    expect(store.current().open[0]).toMatchObject({
      id: 1,
      name: "Orders",
      guards: { environment: "production", readOnly: true },
    });
    expect(JSON.stringify(store.current())).not.toContain("secret");
  });

  it("keep a failure as the error shown, until dismissed [RULE] R-ERR-2", async () => {
    const failure = { sqlcode: -919, sqlstate: "28000", message: "the user or the password is wrong" };
    mockBackend({
      open_connection: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the backend rejects with Studio's error, not an Error
        throw failure;
      },
    });
    const store = new Store();
    await connectSpec(store, "X", { user: "ann" }, { environment: "development", readOnly: false }, "wrong");
    expect(store.current().error).toEqual(failure);
    expect(store.current().open).toEqual([]);
    dismissError(store);
    expect(store.current().error).toBeNull();
  });

  it("end a transaction and show the session after it [CLIENT Running statements]", async () => {
    const after = { ...SESSION, transaction: { ...SESSION.transaction, active: false } };
    const asked = mockBackend({
      run_statement: () => ({
        kind: "ran",
        answer: { session: after, serverTime: { total: 250, queued: 1, locks: 0 } },
      }),
    });
    const store = new Store();
    await connectSpec(store, "X", { user: "ann" }, { environment: "development", readOnly: false }, null);
    await endTransaction(store, 1, "COMMIT");
    expect(asked.at(-1)).toEqual({
      command: "run_statement",
      args: { connection: 1, sql: "COMMIT", confirmed: false, values: [] },
    });
  });

  it("mark a lost connection, and connect it again as the computer wakes [DESIGN] D24", async () => {
    const asked = mockBackend({ reconnect: () => SESSION });
    const store = new Store();
    await connectSpec(store, "X", { user: "ann" }, { environment: "development", readOnly: false }, null);
    told(store, {
      kind: "lost",
      connection: 1,
      error: {
        sqlcode: -919,
        sqlstate: "08006",
        message: "lost",
        rule: null,
        position: null,
        active: false,
        diagnostics: null,
      },
    });
    expect(store.current().open[0]?.session.lost).toBe(true);
    await checkAfterWake(store);
    expect(asked.map((a) => a.command)).toContain("reconnect");
    expect(store.current().open[0]?.session.lost).toBe(false);
  });

  it("do not reconnect on waking when the settings say not to [DESIGN] D24", async () => {
    const asked = mockBackend();
    const store = new Store();
    await changeSettings(store, (s) => ({ ...s, reconnectOnWake: false }));
    await connectSpec(store, "X", { user: "ann" }, { environment: "development", readOnly: false }, null);
    await checkAfterWake(store);
    expect(asked.map((a) => a.command)).not.toContain("ping_connection");
  });

  it("disconnect, making another connection active [DESIGN] D24", async () => {
    let next = 0;
    mockBackend({ open_connection: () => ({ connection: ++next, session: SESSION }) });
    const store = new Store();
    await connectSpec(store, "A", { user: "ann" }, { environment: "development", readOnly: false }, null);
    await connectSpec(store, "B", { user: "ann" }, { environment: "development", readOnly: false }, null);
    activate(store, 1);
    await disconnect(store, 1);
    expect(store.current().active).toBe(2);
    await reconnectOpen(store, 2);
  });

  it("save and forget a connection, reloading the list [DESIGN] D28", async () => {
    const asked = mockBackend({ save_connection: () => SAVED });
    const store = new Store();
    expect(await save(store, SAVED, { kind: "save", password: "x" })).toEqual(SAVED);
    await forget(store, "ab");
    expect(asked.map((a) => a.command)).toEqual([
      "save_connection",
      "list_saved_connections",
      "delete_saved_connection",
      "list_saved_connections",
    ]);
  });
});
