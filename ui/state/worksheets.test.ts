import { vi } from "vitest";
import type { KeptWorksheet } from "../ipc/worksheet";
import { catalogBackend, opened, SAVED } from "../test/catalog";
import { TAB_ACTS } from "../worksheet/commands";
import { connectSaved, disconnect, refreshSaved } from "./actions";
import { Store } from "./store";
import {
  activateWorksheet,
  bindOpened,
  closeWorksheet,
  KEEP_AFTER_MS,
  keepAsChanged,
  kept,
  openWorksheet,
  restoreWorksheets,
  setConnection,
  setText,
  UNTITLED,
  worksheetOf,
} from "./worksheets";

const KEPT: KeptWorksheet = {
  id: "k1",
  title: "Report",
  text: "VALUES (1)",
  connection: "ab",
  pinned: true,
  path: "/r.sql",
  modified: false,
};

describe("the worksheets", () => {
  it("are opened on the active connection, changed, closed and opened again [DESIGN] D36", async () => {
    catalogBackend();
    const store = await opened();
    const id = openWorksheet(store);
    const w = worksheetOf(store.current(), id);
    expect([w?.title, w?.connection, w?.savedConnection, w?.modified]).toEqual([UNTITLED, 1, "ab", false]);
    setText(store, id, "SELECT 1");
    setText(store, id, "SELECT 1");
    expect(worksheetOf(store.current(), id)?.modified).toBe(true);
    setConnection(store, id, null);
    expect(worksheetOf(store.current(), id)?.savedConnection).toBeNull();
    const second = openWorksheet(store, "VALUES (2)", "Two");
    activateWorksheet(store, id);
    closeWorksheet(store, id);
    closeWorksheet(store, "missing");
    expect(store.current().activeWorksheet).toBe(second);
    TAB_ACTS.reopen(store);
    expect(store.current().activeWorksheet).toBe(id);
    expect(worksheetOf(store.current(), id)?.text).toBe("SELECT 1");
    store.update((now) => ({ ...now, closedWorksheets: [] }));
    TAB_ACTS.reopen(store);
    expect(store.current().worksheets).toHaveLength(2);
  });

  it("close the others but those pinned, and are pinned, split and outlined by their commands [DESIGN] D36", () => {
    const store = new Store();
    const a = openWorksheet(store);
    const b = openWorksheet(store);
    const c = openWorksheet(store);
    activateWorksheet(store, b);
    TAB_ACTS.pin(store);
    activateWorksheet(store, c);
    TAB_ACTS.split(store);
    TAB_ACTS.outline(store);
    TAB_ACTS.closeOthers(store);
    expect(store.current().worksheets.map((w) => w.id)).toEqual([b, c]);
    expect(worksheetOf(store.current(), c)).toMatchObject({ split: true, outline: true });
    expect(worksheetOf(store.current(), b)?.pinned).toBe(true);
    TAB_ACTS.close(store);
    expect(store.current().worksheets.map((w) => w.id)).toEqual([b]);
    expect(a).not.toBe(b);
    const none = new Store();
    for (const act of Object.values(TAB_ACTS)) {
      act(none);
    }
    expect(none.current().worksheets).toEqual([]);
  });

  it("come back as kept, each on its saved connection as it opens, and on none as it ends [RULE] R-FMT-1", async () => {
    catalogBackend({ load_worksheets: () => [KEPT] });
    const store = new Store();
    await restoreWorksheets(store);
    const restored = worksheetOf(store.current(), "k1");
    expect(restored).toMatchObject({ title: "Report", pinned: true, path: "/r.sql", connection: null });
    expect(restored === undefined ? null : kept(restored)).toEqual(KEPT);
    bindOpened(store, null, 9);
    expect(worksheetOf(store.current(), "k1")?.connection).toBeNull();
    bindOpened(store, "ab", 9);
    expect(worksheetOf(store.current(), "k1")?.connection).toBe(9);
    const reopened = new Store();
    await restoreWorksheets(reopened);
    await refreshSaved(reopened);
    await connectSaved(reopened, SAVED, null);
    expect(worksheetOf(reopened.current(), "k1")?.connection).toBe(1);
    await disconnect(reopened, 1);
    expect(worksheetOf(reopened.current(), "k1")?.connection).toBeNull();
  });

  it("are kept a moment after they last change, and not when nothing kept changed [RULE] R-FMT-1", async () => {
    vi.useFakeTimers();
    try {
      const asked = catalogBackend({ keep_worksheets: () => null });
      const store = new Store();
      const stop = keepAsChanged(store);
      const id = openWorksheet(store, "VALUES (1)");
      setText(store, id, "VALUES (2)");
      store.update((now) => ({ ...now, error: null }));
      await vi.advanceTimersByTimeAsync(KEEP_AFTER_MS + 1);
      const keeps = asked.filter((a) => a.command === "keep_worksheets");
      expect(keeps).toHaveLength(1);
      expect((keeps[0]?.args["worksheets"] as KeptWorksheet[])[0]?.text).toBe("VALUES (2)");
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("restore none if none can be read [RULE] R-FMT-1", async () => {
    catalogBackend({ load_worksheets: () => Promise.reject(new Error("unreadable")) });
    const store = new Store();
    await restoreWorksheets(store);
    expect(store.current().worksheets).toEqual([]);
    expect(store.current().activeWorksheet).toBeNull();
  });
});
