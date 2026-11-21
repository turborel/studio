import { act, fireEvent, render, screen } from "@testing-library/react";
import type { IDockviewPanelHeaderProps } from "dockview-react";
import type { Ran } from "../ipc/connections";
import type { Piece } from "../ipc/worksheet";
import { Tab } from "../shell/Dock";
import { runOnConnections, stopRun } from "../state/running";
import { show } from "../state/actions";
import { StoreContext } from "../state/store";
import { openWorksheet, worksheetOf } from "../state/worksheets";
import { SESSION } from "../test/backend";
import { catalogBackend, must, opened, SAVED, settle, within } from "../test/catalog";
import { savedFolders } from "./commands";
import { FoldersDialog } from "./dialogs";
import { Editor } from "./editor/Editor";
import { resultName } from "./Panes";

/** What a query gave on connection `n`: one row of it. */
function rowsOf(n: number): { kind: "ran"; answer: Ran } {
  return {
    kind: "ran",
    answer: {
      outcome: {
        kind: "rows",
        result: n,
        columns: [{ name: "N", typeWritten: "INTEGER", typeName: null, notNull: false }],
        page: { from: 0, rows: [[String(n)]], rowsRead: 1, complete: true, lobs: [] },
      },
      warnings: [],
      serverTime: null,
      session: SESSION,
    },
  };
}

const EU = { ...SAVED, id: "eu", name: "EU", folder: ["Team", "EU"] };
const US = { ...SAVED, id: "us", name: "US", folder: ["Team"] };

describe("a script on several connections", () => {
  it("runs on each in turn, its results each its own, a failure on one ending the run on it alone [DESIGN] D36", async () => {
    let opens = 1;
    const asked = catalogBackend({
      list_saved_connections: () => ({
        connections: [
          { connection: SAVED, passwordSaved: false },
          { connection: EU, passwordSaved: true },
          { connection: US, passwordSaved: true },
        ],
        recent: [],
      }),
      open_saved_connection: () => ({ connection: (opens += 1), session: SESSION }),
      split_script: () => [
        {
          from: 0,
          to: 10,
          statement: {
            text: "VALUES (1)",
            class: "read",
            destroys: null,
            floor: null,
            readWrite: false,
            connects: false,
          },
        } satisfies Piece,
      ],
      run_statement: (args) =>
        args["connection"] === 3 ? Promise.reject(new Error("down")) : rowsOf(Number(args["connection"])),
    });
    const store = await opened();
    expect(savedFolders(store)).toEqual([["Team"], ["Team", "EU"]]);
    const id = openWorksheet(store, "VALUES (1)");
    within(store, <Editor id={id} />);
    show(store, { kind: "folders" });
    within(store, <FoldersDialog />);
    expect(screen.getByText("Team / EU (1)")).toBeTruthy();
    fireEvent.click(screen.getByText("Team (2)"));
    await act(async () => {
      await new Promise((done) => setTimeout(done, 50));
    });
    await settle();
    const runs = worksheetOf(store.current(), id)?.runs ?? [];
    expect(runs.map((r) => [r.connection, r.error === null])).toEqual([
      [3, false],
      [4, true],
    ]);
    expect(asked.filter((a) => a.command === "open_saved_connection").map((a) => a.args["id"])).toEqual([
      "ab",
      "eu",
      "us",
    ]);
    const open = store.current().open;
    const us = must(runs[1]);
    expect(resultName(us, 0, runs, open)).toBe("US: Result 1");
    expect(resultName(us, 0, [us], open)).toBe("Result 1");
    expect(resultName({ ...us, connection: 99 }, 1, runs, open)).toBe("Connection 99: Result 2");
    expect(worksheetOf(store.current(), id)?.messages.map((m) => m.text)).toContain("On EU:");
  });

  it("asks for its script variables once, and runs nothing of none given, of no statements or no connections [DESIGN] D36", async () => {
    catalogBackend();
    const store = await opened();
    const id = openWorksheet(store, "");
    await runOnConnections(store, id, [], [1]);
    await runOnConnections(store, id, [{ sql: "VALUES (1)", from: 0, to: 10 }], []);
    const run = runOnConnections(store, id, [{ sql: "SELECT ${a}", from: 0, to: 11 }], [1]);
    await act(async () => {
      await Promise.resolve();
    });
    const dialog = store.current().dialog;
    if (dialog?.kind === "values") {
      dialog.answer(null);
    }
    await run;
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe("Not run: no values were given.");
    await stopRun(store, id);
  });

  it("shows no folder where no connection is in one [DESIGN] D36", async () => {
    catalogBackend();
    const store = await opened();
    within(store, <FoldersDialog />);
    expect(screen.getByText("No saved connection is in a folder.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(store.current().dialog).toBeNull();
  });
});

describe("a worksheet's tab", () => {
  it("takes the colour of the connection the worksheet runs on [DESIGN] D32", async () => {
    catalogBackend();
    const store = await opened({ ...SAVED, environment: "production" });
    const id = openWorksheet(store, "");
    const api = new Proxy(
      { component: "worksheet", title: "Untitled", isPinned: false },
      { get: (t, k: string) => (k in t ? t[k as keyof typeof t] : () => ({ dispose: () => undefined })) },
    );
    const props = { api, containerApi: {}, params: { id } } as unknown as IDockviewPanelHeaderProps;
    const { container } = render(
      <StoreContext.Provider value={store}>
        <Tab {...props} />
      </StoreContext.Provider>,
    );
    expect(container.querySelector<HTMLElement>(".dock-tab")?.style.boxShadow).toContain("inset");
  });
});
