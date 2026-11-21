import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { vi } from "vitest";
import { catalogBackend, opened, refused, settle, within } from "../test/catalog";
import { runAct } from "./admin";
import { MonitorPanel } from "./MonitorPanel";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the monitor at its edges", () => {
  it("tells a server it cannot read, one of no row, and counters it cannot draw [DESIGN] D57", async () => {
    let reads = 0;
    catalogBackend({
      admin_view: (args) => {
        if (args["view"] !== "server") {
          return { columns: ["ID"], rows: [], absent: false };
        }
        reads += 1;
        if (reads === 1) {
          return refused({ sqlcode: -1, sqlstate: "42000", message: "unreadable" });
        }
        return reads === 2
          ? { columns: ["X"], rows: [], absent: false }
          : { columns: ["X"], rows: [["1"]], absent: false };
      },
    });
    const store = await opened();
    within(store, <MonitorPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Server" }));
    await settle();
    expect(screen.getByText("unreadable")).toBeTruthy();
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await settle();
    }
    expect(screen.getByText("The result has no column WORKERS_BUSY.")).toBeTruthy();
  });

  it("reads again on its own each interval chosen [DESIGN] D57", async () => {
    let reads = 0;
    catalogBackend({
      admin_view: () => {
        reads += 1;
        return { columns: ["ID"], rows: [], absent: false };
      },
    });
    const store = await opened();
    vi.useFakeTimers();
    within(store, <MonitorPanel />);
    fireEvent.change(screen.getByRole("combobox", { name: "Read again every" }), { target: { value: "1" } });
    const before = reads;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(reads).toBeGreaterThan(before);
  });

  it("tells a failure of any kind, and an act the guards ask about twice [DESIGN] D57", async () => {
    let calls = 0;
    catalogBackend({
      admin_act: () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("broken");
        }
        return { kind: "confirm", answer: { class: "security", destroys: [], unclassified: [], production: true } };
      },
    });
    const store = await opened();
    expect(await runAct(store, 1, { kind: "createRole", name: "R" })).toEqual({ kind: "failed", why: "Error: broken" });
    const asking = runAct(store, 1, { kind: "endConnection", id: 3 });
    await settle();
    const guard = store.current().dialog;
    if (guard?.kind === "guard") {
      act(() => {
        guard.answer(true);
      });
    }
    expect(await asking).toEqual({ kind: "done" });
  });
});
