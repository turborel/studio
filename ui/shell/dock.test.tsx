import type { DockviewApi } from "dockview-react";
import { mockBackend } from "../test/backend";
import { resetLayout, restore, SAVE_AFTER_MS } from "./Dock";

/** A dock that records what is done to it. */
function dock(fails = false) {
  const done: string[] = [];
  let changed: () => void = () => undefined;
  const api = {
    addPanel: () => done.push("add"),
    fromJSON: () => {
      done.push("fromJSON");
      if (fails) {
        throw new Error("a panel this build has not");
      }
    },
    clear: () => done.push("clear"),
    toJSON: () => ({ grid: {} }),
    onDidLayoutChange: (listener: () => void) => {
      changed = listener;
    },
  } as unknown as DockviewApi;
  return {
    api,
    done,
    change: () => {
      changed();
    },
  };
}

describe("the dock's layout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is laid out afresh when none is saved, and saved as it changes [RULE] R-FMT-1", async () => {
    const asked = mockBackend();
    const { api, done, change } = dock();
    await restore(api);
    expect(done).toEqual(["add", "add", "add", "add"]);
    change();
    change();
    await vi.advanceTimersByTimeAsync(SAVE_AFTER_MS);
    expect(asked.filter((a) => a.command === "save_layout")).toHaveLength(1);
  });

  it("is restored as it was left [RULE] R-FMT-1", async () => {
    mockBackend({ load_layout: () => ({ grid: {}, panels: {} }) });
    const { api, done } = dock();
    await restore(api);
    expect(done).toEqual(["fromJSON"]);
  });

  it("is laid out afresh when the saved one cannot be [DESIGN] D14", async () => {
    mockBackend({ load_layout: () => ({ grid: {} }) });
    const { api, done } = dock(true);
    await restore(api);
    expect(done).toEqual(["fromJSON", "clear", "add", "add", "add", "add"]);
  });

  it("is reset and saved by Reset Layout [DESIGN] D14", async () => {
    const asked = mockBackend();
    const { api, done } = dock();
    resetLayout(api);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toEqual(["clear", "add", "add", "add", "add"]);
    expect(asked.map((a) => a.command)).toEqual(["save_layout"]);
  });
});
