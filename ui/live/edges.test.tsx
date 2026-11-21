import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { HostedView, LiveStatus, SharedTab, SharedWorkspace } from "../ipc/live";
import type { Store } from "../state/store";
import { openWorksheet } from "../state/worksheets";
import { catalogBackend, must, opened, refused, settle, within } from "../test/catalog";
import { LivePanel } from "./LivePanel";
import { changeLive, handOver, invite, join, present, toggleShared } from "./live";
import { SharedView } from "./SharedView";
import { pointerOf, SYNC_MS, useLiveSync } from "./sync";

/** A session hosted through a relay alone, of no one yet, a guest presenting. */
const RELAYED: HostedView = {
  session: "0123456789abcdef0123456789abcdef",
  fingerprint: "AB:CD",
  direct: [],
  relay: "relay.example:4433",
  participants: [],
  presenter: 9,
  choices: { rowLimit: 100, copy: true, productionValues: false, record: false },
  record: null,
};

/** A worksheet tab of EXPLAIN ANALYZE's plan, a column of no name, a null, and no selection. */
const TAB: SharedTab = {
  id: "w1",
  kind: "worksheet",
  title: "Sheet",
  environment: null,
  values: true,
  text: "VALUES (NULL)",
  selection: null,
  results: { columns: [{ name: null, typeName: "INTEGER", masked: false }], rows: [[null]], cut: false },
  messages: [],
  plan: ["-- physical:", "Values  (est. rows=1)  (actual rows=1, time=3 ms)", "-- ran: 1 row in 3 ms"],
  document: null,
};

/** Sets the status to `status`. */
function as(store: Store, status: LiveStatus): void {
  act(() => {
    changeLive(store, (l) => ({ ...l, status }));
  });
}

/** Shows `workspace` to this Studio. */
function showing(store: Store, workspace: SharedWorkspace): void {
  act(() => {
    changeLive(store, (l) => ({ ...l, shown: { workspace, presenter: "Bob" } }));
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Live Sessions at their edges", () => {
  it("draws a result of no column name and a null, a plan's rows and time, and a cursor of no selection [DESIGN] D56", async () => {
    catalogBackend({ live_suggest: () => refused({ sqlcode: -910, sqlstate: "HY000", message: "not let you" }) });
    const store = await opened();
    showing(store, {
      tabs: [TAB, { ...TAB, id: "w2", title: "Bare", results: null, plan: [] }],
      active: "w1",
      pointer: null,
      copy: true,
    });
    within(store, <SharedView canSuggest />);
    const result = screen.getByRole("table", { name: "Result" });
    expect(result.querySelector("th")?.textContent).toContain("(1)");
    expect(result.querySelector("td")?.textContent).toBe("NULL");
    expect(screen.getByText(/1 rows in 3 ms/)).toBeTruthy();
    expect(document.querySelector(".live-cursor")).not.toBeNull();
    expect(screen.getByRole("tabpanel").className).toBe("live-content");
    fireEvent.change(screen.getByRole("textbox", { name: "SQL to suggest" }), { target: { value: "SELECT 1" } });
    fireEvent.submit(screen.getByRole("textbox", { name: "SQL to suggest" }));
    await settle();
    expect(screen.getByRole("textbox", { name: "SQL to suggest" })).toHaveProperty("value", "SELECT 1");
    expect(store.current().live.told).toBe("not let you");
    fireEvent.click(screen.getByRole("tab", { name: "Bare" }));
    expect(screen.queryByRole("table", { name: "Result" })).toBeNull();
  });

  it("shows a session reached through a relay, of no one yet, while a guest presents [DESIGN] D56", async () => {
    catalogBackend({ live_status: () => ({ hosted: { ...RELAYED, presenter: null }, joined: null }) });
    const store = await opened();
    as(store, { hosted: RELAYED, joined: null });
    showing(store, { tabs: [TAB], active: null, pointer: null, copy: true });
    act(() => {
      changeLive(store, (l) => ({ ...l, told: "something" }));
    });
    within(store, <LivePanel />);
    expect(screen.getByText(/through relay.example:4433/)).toBeTruthy();
    expect(screen.getByText("No one has joined yet.")).toBeTruthy();
    expect(screen.getByText("Open a worksheet or a model to share it.")).toBeTruthy();
    expect(screen.getByText("Presented by Bob")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("something");
    await act(async () => {
      await handOver(store, null);
    });
    expect(store.current().live.shown).toBeNull();
  });

  it("tells each failure of presenting, inviting and joining [DESIGN] D56", async () => {
    const failing = (message: string) => () => refused({ sqlcode: -910, sqlstate: "HY000", message });
    catalogBackend({
      live_present: failing("give your name"),
      live_invite: failing("no session"),
      live_join: failing("expired"),
    });
    const store = await opened();
    await present(store);
    expect(store.current().live.told).toBe("give your name");
    await invite(store);
    expect(store.current().live.told).toBe("no session");
    expect(await join(store, "x")).toBe(false);
    expect(store.current().live.told).toBe("expired");
  });

  it("tells a failure to share, sends once at a time, and tells no pointer where it does not present [DESIGN] D56", async () => {
    const held: { answer?: () => void } = {};
    let calls = 0;
    catalogBackend({
      live_publish: () => {
        calls += 1;
        return calls === 1
          ? refused({ sqlcode: -910, sqlstate: "HY000", message: "too large" })
          : new Promise<null>(
              (done) =>
                (held.answer = () => {
                  done(null);
                }),
            );
      },
    });
    const store = await opened();
    function Sync() {
      useLiveSync(store);
      return null;
    }
    vi.useFakeTimers();
    const sheet = openWorksheet(store, "SELECT 1");
    const pointer = pointerOf(store, sheet);
    const target = document.createElement("div");
    act(() => {
      pointer.onMouseMove({
        currentTarget: target,
        clientX: 0,
        clientY: 0,
        timeStamp: 1000,
      } as unknown as React.MouseEvent<HTMLElement>);
      pointer.onMouseLeave();
    });
    expect(store.current().live.pointer).toBeNull();
    toggleShared(store, sheet);
    as(store, { hosted: { ...RELAYED, presenter: null }, joined: null });
    act(() => {
      pointer.onMouseMove({
        currentTarget: target,
        clientX: 0,
        clientY: 0,
        timeStamp: 1000,
      } as unknown as React.MouseEvent<HTMLElement>);
    });
    expect(store.current().live.pointer).toEqual({ tab: 0, x: 0, y: 0 });
    within(store, <Sync />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_MS * 2);
    });
    expect(store.current().live.told).toBe("too large");
    act(() => {
      toggleShared(store, sheet);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_MS);
    });
    act(() => {
      toggleShared(store, sheet);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_MS * 3);
    });
    expect(calls).toBe(2);
    must(held.answer)();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_MS * 2);
    });
    expect(calls).toBe(3);
  });
});
