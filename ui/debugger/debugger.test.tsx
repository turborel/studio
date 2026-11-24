import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { COMMANDS, type CommandContext } from "../commands/commands";
import { objectMenu, partMenu } from "../explorer/menus";
import type { DebugEvent, FrameView, PauseView } from "../ipc/debugging";
import type { MenuItem } from "../shell/ContextMenu";
import type { Store } from "../state/store";
import { catalogBackend, must, opened, refused as rejected, settle, within } from "../test/catalog";
import { DebuggerPanel, frameName } from "./DebuggerPanel";
import {
  chooseFrame,
  type DebugRoutine,
  heard,
  interrupt,
  refusal,
  resume,
  said,
  startDebug,
  stopDebug,
  toggleBreakpoint,
} from "./debugging";
import { aligned, pausedLine } from "./lines";

/** The procedure debugged. */
const RAISE: DebugRoutine = {
  kind: "procedure",
  schema: "ANN",
  name: "RAISE_PAY_1",
  shown: "ANN.RAISE_PAY",
  table: null,
};

/** Studio's CREATE of RAISE_PAY. */
const TEXT = [
  "CREATE PROCEDURE ANN.RAISE_PAY (IN PCT INTEGER) NOT DETERMINISTIC MODIFIES SQL DATA",
  "BEGIN",
  "  DECLARE N INTEGER DEFAULT 0;",
  "  UPDATE STAFF SET SALARY = SALARY * (100 + PCT) / 100;",
  "  SET N = (SELECT COUNT(*) FROM STAFF);",
  "END",
].join("\n");

/** A frame of RAISE_PAY at line `line`, column `column`. */
function frame(line: number, column = 3): FrameView {
  return {
    kind: "procedure",
    schema: "ANN",
    specific: "RAISE_PAY_1",
    name: "RAISE_PAY",
    visible: true,
    at: 120,
    line,
    column,
    parameters: [{ name: "PCT", dataType: "INTEGER", value: "10" }],
    variables: [{ name: "N", dataType: "INTEGER", value: null }],
    cursors: [{ name: "C", open: false, query: "SELECT ID FROM STAFF" }],
  };
}

/** A pause at breakpoint 1, line 4, in a frame called by an unseen one. */
const PAUSED: DebugEvent = {
  kind: "paused",
  breakpoint: 1,
  frames: [
    frame(4),
    { ...frame(9), kind: "procedure", specific: "OUTER_1", name: "OUTER", visible: false, parameters: [] },
  ],
};

/** A backend debugging RAISE_PAY: its events `events`, given once each as waited for. */
function debugBackend(events: DebugEvent[], extra: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  return catalogBackend({
    debug_start: () => 7,
    debug_text: () => ({ text: TEXT, exact: false }),
    debug_stop: () => null,
    debug_ask: (args) => {
      const ask = args["ask"] as { ask: string; line?: number; condition?: string | null; number?: number };
      switch (ask.ask) {
        case "wait":
          return { kind: "event", event: events.shift() ?? null };
        case "break":
          return {
            kind: "breakpoint",
            number: ask.line ?? 0,
            schema: "ANN",
            name: "RAISE_PAY_1",
            line: ask.line,
            condition: ask.condition,
          };
        default:
          return { kind: "done" };
      }
    },
    ...extra,
  });
}

/** Waits until the store's debugging session says `text`. */
async function told(store: Store, text: string): Promise<void> {
  await vi.waitFor(() => {
    expect(store.current().debug?.told).toContain(text);
  });
}

afterEach(() => {
  cleanup();
});

describe("the routine debugger", () => {
  it("sets and clears breakpoints, a conditional one, is told the pause, and steps and stops [DESIGN] D73", async () => {
    const asked = debugBackend([]);
    const store = await opened();
    within(store, <DebuggerPanel />);
    await act(() => startDebug(store, 1, RAISE));
    await settle();
    expect(screen.getByRole("status").textContent).toContain("Attached to the session");
    fireEvent.click(screen.getByRole("button", { name: "Breakpoint at line 4" }));
    await told(store, "Breakpoint 4 at line 4.");
    expect(screen.getByRole("button", { name: "Breakpoint at line 4" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Breakpoint at line 5" }), { shiftKey: true });
    await settle();
    const dialog = store.current().dialog;
    if (dialog?.kind === "prompt") {
      dialog.answer("PCT > 5");
    }
    await told(store, "where PCT > 5");
    const breaks = asked.filter((a) => a.command === "debug_ask" && (a.args["ask"] as { ask: string }).ask === "break");
    expect(breaks.map((a) => a.args["ask"])).toEqual([
      { ask: "break", kind: "procedure", schema: "ANN", name: "RAISE_PAY_1", line: 4, condition: null },
      { ask: "break", kind: "procedure", schema: "ANN", name: "RAISE_PAY_1", line: 5, condition: "PCT > 5" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Breakpoint at line 4" }));
    await vi.waitFor(() => {
      expect(store.current().debug?.breakpoints.map((b) => b.line)).toEqual([5]);
    });
    act(() => {
      heard(store, 7, PAUSED);
    });
    expect(screen.getByRole("status").textContent).toContain("Paused at breakpoint 1.");
    expect(
      screen.getAllByRole("listitem").find((l) => l.getAttribute("aria-current") === "true")?.textContent,
    ).toContain("UPDATE STAFF");
    expect(screen.getByRole("list", { name: "Call stack" }).textContent).toContain(
      "#1 PROCEDURE ANN.RAISE_PAY line 4, column 3",
    );
    expect(screen.getByRole("table", { name: "Parameters" }).textContent).toBe("ParametersPCTINTEGER10");
    expect(screen.getByRole("table", { name: "Variables" }).textContent).toBe("VariablesNINTEGERNULL");
    expect(screen.getByRole("table", { name: "Cursors" }).textContent).toBe("CursorsCclosedSELECT ID FROM STAFF");
    fireEvent.click(screen.getByRole("button", { name: /^#2/u }));
    expect(screen.getByText(/Its values are not shown to you/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Step Over" }));
    await told(store, "Going on.");
    const resumed = asked.filter(
      (a) => a.command === "debug_ask" && (a.args["ask"] as { ask: string }).ask === "resume",
    );
    expect(resumed.map((a) => a.args["ask"])).toEqual([{ ask: "resume", step: "over" }]);
    fireEvent.click(screen.getByRole("button", { name: "Interrupt" }));
    await told(store, "Pausing at the next statement.");
    fireEvent.click(screen.getByRole("button", { name: "Stop Debugging" }));
    await settle();
    expect(asked.some((a) => a.command === "debug_stop" && a.args["debugger"] === 7)).toBe(true);
    expect(screen.getByText(/No routine is being debugged/u)).toBeTruthy();
  });

  it("hears the session's events as they come, and stops hearing at its end [DESIGN] D73", async () => {
    const asked = debugBackend([PAUSED, { kind: "timedOut" }, { kind: "ended" }]);
    const store = await opened();
    await act(() => startDebug(store, 1, RAISE));
    await told(store, "The session ended");
    expect(store.current().debug?.status).toBe("ended");
    const waits = asked.filter((a) => a.command === "debug_ask").length;
    await new Promise((done) => setTimeout(done, 300));
    expect(asked.filter((a) => a.command === "debug_ask").length).toBe(waits);
    await act(() => stopDebug(store));
  });

  it("tells a refusal plainly, of DEBUG how it is granted, and a failure of the wait ends it [DESIGN] D73", async () => {
    const refused = { sqlcode: -104, sqlstate: "42000", message: "ANN holds no DEBUG on ANN.RAISE_PAY_1" };
    debugBackend([], {
      debug_ask: (args) => {
        const ask = (args["ask"] as { ask: string }).ask;
        return ask === "wait"
          ? new Promise(() => undefined)
          : rejected({ ...refused, rule: null, position: null, active: false, diagnostics: null });
      },
    });
    const store = await opened();
    within(store, <DebuggerPanel />);
    await act(() => startDebug(store, 1, RAISE));
    fireEvent.click(screen.getByRole("button", { name: "Breakpoint at line 4" }));
    await told(store, "GRANT DEBUG ON PROCEDURE ANN.RAISE_PAY TO <you>.");
    expect(refusal(refused, { ...RAISE, kind: "trigger" })).toContain(
      "A trigger is debugged by the owner of its schema.",
    );
    expect(refusal({ ...refused, sqlcode: -910, sqlstate: "TBD01", message: "not paused" }, RAISE)).toBe(
      "TBD01 (-910): not paused",
    );
    expect(refusal(new Error("gone"), RAISE)).toBe("Error: gone");
    await act(() => stopDebug(store));
  });

  it("says each event plainly, names each frame, and marks no line where the pause is not where the text says [DESIGN] D73", async () => {
    expect(said({ kind: "paused", breakpoint: null, frames: [] })).toBe("Paused.");
    expect(said({ kind: "timedOut" })).toContain("DEBUGGER.PAUSE_TIMEOUT_MS");
    expect(said({ kind: "cancelled" })).toBe("The paused statement was cancelled, and the session went on.");
    expect(frameName({ ...frame(4), kind: null })).toBe("a statement run directly");
    expect(frameName({ ...frame(4), visible: false })).toContain("not shown to you");
    expect(frameName({ ...frame(4), line: null })).toBe("PROCEDURE ANN.RAISE_PAY");
    debugBackend([]);
    const store = await opened();
    within(store, <DebuggerPanel />);
    await act(() => startDebug(store, 1, RAISE));
    const pause = (f: FrameView): PauseView => ({ breakpoint: null, frames: [f] });
    const at = (f: FrameView, exact = false) => {
      const d = must(store.current().debug);
      return { ...d, pause: pause(f), text: { text: TEXT, exact } };
    };
    expect(pausedLine(at(frame(4)))).toBe(4);
    expect(aligned(at(frame(4, 1)))).toBe(false);
    expect(aligned(at(frame(4, 10)))).toBe(true);
    expect(aligned(at(frame(4, 11)))).toBe(false);
    expect(aligned(at(frame(99)))).toBe(false);
    expect(aligned(at({ ...frame(4), column: null }))).toBe(false);
    expect(aligned(at({ ...frame(2, 1), at: 84 }, true))).toBe(true);
    expect(aligned(at({ ...frame(2, 1), at: 85 }, true))).toBe(false);
    expect(aligned(at({ ...frame(2, 1), at: null }, true))).toBe(false);
    act(() => {
      heard(store, 7, { kind: "paused", breakpoint: null, frames: [frame(4, 1)] });
    });
    expect(screen.getByRole("note").textContent).toContain("no line is marked");
    expect(screen.getAllByRole("listitem").some((l) => l.getAttribute("aria-current") === "true")).toBe(false);
    await act(() => stopDebug(store));
  });

  it("is begun of a procedure's or a trigger's menu, its commands enabled as the session is [DESIGN] D73", async () => {
    const asked = debugBackend([]);
    const store = await opened();
    const run = (items: MenuItem[], label: string) => {
      const item = items.find((i) => typeof i === "object" && "label" in i && i.label === label);
      return item !== undefined && typeof item === "object" && "run" in item ? item.run() : undefined;
    };
    await act(async () => {
      await run(
        objectMenu(store, 1, { kind: "routine", schema: "ANN", name: "DOUBLED", specific: "DOUBLED_1" }),
        "Debug…",
      );
    });
    expect(store.current().debug?.routine).toEqual({
      kind: "function",
      schema: "ANN",
      name: "DOUBLED_1",
      shown: "ANN.DOUBLED",
      table: null,
    });
    await act(async () => {
      await run(partMenu(store, 1, { kind: "trigger", schema: "ANN", table: "STAFF", name: "STAFF_LOG" }), "Debug…");
    });
    expect(store.current().debug?.routine.kind).toBe("trigger");
    expect(asked.filter((a) => a.command === "debug_stop")).toHaveLength(1);
    const context: CommandContext = { store, resetLayout: () => undefined, showPanel: () => undefined };
    const command = (id: string) => must(COMMANDS.find((c) => c.id === id));
    expect(command("debug.continue").enabled(context)).toBe(false);
    expect(command("debug.interrupt").enabled(context)).toBe(true);
    act(() => {
      heard(store, 7, PAUSED);
    });
    expect(command("debug.stepInto").enabled(context)).toBe(true);
    await act(async () => {
      await command("debug.stepInto").run(context);
    });
    expect(asked.some((a) => (a.args["ask"] as { step?: string } | undefined)?.step === "into")).toBe(true);
    let shown = "";
    await command("debug.open").run({ ...context, showPanel: (id) => (shown = id) });
    expect(shown).toBe("debugger");
    await act(async () => {
      await command("debug.stop").run(context);
    });
    expect(store.current().debug).toBeNull();
  });

  it("does nothing it may not, tells a step or interrupt refused, and shows no text it may not [DESIGN] D73", async () => {
    const asked = debugBackend([], {
      debug_text: () => ({ text: null, exact: false }),
      debug_ask: (args) => {
        const ask = (args["ask"] as { ask: string }).ask;
        return ask === "wait"
          ? { kind: "event", event: null }
          : rejected({
              sqlcode: -910,
              sqlstate: "TBD01",
              message: "not paused",
              rule: null,
              position: null,
              active: false,
              diagnostics: null,
            });
      },
    });
    const store = await opened();
    await toggleBreakpoint(store, 1);
    await resume(store, "over");
    await interrupt(store);
    chooseFrame(store, 1);
    expect(asked.filter((a) => a.command === "debug_ask")).toHaveLength(0);
    within(store, <DebuggerPanel />);
    await act(() => startDebug(store, 1, RAISE));
    expect(screen.getByText(/shown to the owner of its schema alone/u)).toBeTruthy();
    expect(screen.getByText(/No call stack/u)).toBeTruthy();
    await act(() => resume(store, "over"));
    await act(() => interrupt(store));
    await told(store, "TBD01 (-910): not paused");
    act(() => {
      heard(store, 7, PAUSED);
    });
    await act(() => resume(store, "out"));
    await told(store, "TBD01 (-910): not paused");
    await act(() => stopDebug(store));
    await act(() => stopDebug(store));
    expect(asked.filter((a) => a.command === "debug_stop")).toHaveLength(1);
  });

  it("asks a condition by Shift and a click, of none or one given back empty sets none, and clears a set one so [DESIGN] D73", async () => {
    const asked = debugBackend([]);
    const store = await opened();
    within(store, <DebuggerPanel />);
    await act(() => startDebug(store, 1, RAISE));
    const shiftClick = async (line: number, condition: string | null) => {
      fireEvent.click(screen.getByRole("button", { name: `Breakpoint at line ${String(line)}` }), { shiftKey: true });
      await settle();
      const dialog = store.current().dialog;
      if (dialog?.kind === "prompt") {
        dialog.answer(condition);
      }
      await settle();
    };
    await shiftClick(3, null);
    await shiftClick(3, "  ");
    expect(store.current().debug?.breakpoints).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Breakpoint at line 3" }));
    await told(store, "Breakpoint 3 at line 3.");
    fireEvent.click(screen.getByRole("button", { name: "Breakpoint at line 3" }), { shiftKey: true });
    await vi.waitFor(() => {
      expect(store.current().debug?.breakpoints).toEqual([]);
    });
    expect(asked.some((a) => (a.args["ask"] as { ask?: string } | undefined)?.ask === "clear")).toBe(true);
    await act(() => stopDebug(store));
  });

  it("is not begun where its connection cannot be debugged [DESIGN] D73", async () => {
    debugBackend([], {
      debug_start: () =>
        rejected({
          sqlcode: -910,
          sqlstate: "08004",
          message: "no debugger",
          rule: null,
          position: null,
          active: false,
          diagnostics: null,
        }),
    });
    const store = await opened();
    await act(() => startDebug(store, 1, RAISE));
    expect(store.current().debug).toBeNull();
    expect(store.current().error?.message).toBe("no debugger");
  });
});
