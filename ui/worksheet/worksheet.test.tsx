import { EMPTY_CATALOG } from "../explorer/catalogState";
import { EditorSelection } from "@codemirror/state";
import { act, fireEvent, screen, within as inside } from "@testing-library/react";
import type { Ran } from "../ipc/connections";
import type { Piece } from "../ipc/worksheet";
import { changeWorksheet, openWorksheet, worksheetOf } from "../state/worksheets";
import { SESSION } from "../test/backend";
import { catalogBackend, must, opened, refused, settle, within } from "../test/catalog";
import {
  EDITOR_ACTS,
  explainCurrent,
  favouriteCurrent,
  formatCurrent,
  goToDefinition,
  hasWorksheet,
  keepFavourite,
  onEditor,
  openFile,
  openPath,
  runCurrent,
  runScript,
  runToFile,
  saveCurrent,
  stopCurrent,
  toggleAutocommit,
} from "./commands";
import { Editor } from "./editor/Editor";
import { viewOf } from "./editor/views";
import { Worksheet } from "./Worksheet";

/** A statement read, of `text`, from `from`. */
function piece(text: string, from: number): Piece {
  return {
    from,
    to: from + text.length,
    statement: {
      text,
      class: /^(?:INSERT|UPDATE|DELETE|MERGE)\b/iu.test(text) ? "writeRows" : "read",
      destroys: null,
      floor: null,
      readWrite: false,
      connects: false,
    },
  };
}

/** The pieces a script of `;`-ended statements splits into. */
function split(text: string): Piece[] {
  const found: Piece[] = [];
  let at = 0;
  for (const part of text.split(";")) {
    const lead = part.length - part.trimStart().length;
    const sql = part.trim();
    if (sql !== "") {
      found.push(piece(sql, at + lead));
    }
    at += part.length + 1;
  }
  return found;
}

/** What a statement gave: no rows, or `rows`. */
function ran(rows: string[][] | null): Ran {
  return {
    outcome:
      rows === null
        ? { kind: "done", sqlcode: 0, sqlstate: "00000", rowsAffected: null, generated: [] }
        : {
            kind: "rows",
            result: 1,
            columns: [{ name: "PLAN", typeWritten: "VARCHAR(100)", typeName: null, notNull: false }],
            page: { from: 0, rows, rowsRead: rows.length, complete: true, lobs: [] },
          },
    warnings: [],
    serverTime: null,
    session: SESSION,
  };
}

/** A worksheet of `text` shown, its editor ready: the store and the worksheet. */
async function shown(text: string, extra: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  const asked = catalogBackend({
    split_script: (args) => split(String(args["text"])),
    run_statement: (args) => ({
      kind: "ran",
      answer: ran(String(args["sql"]).startsWith("EXPLAIN") ? [["-- physical:"], ["SeqScan T"]] : [["1"]]),
    }),
    ...extra,
  });
  const store = await opened();
  store.update((now) => ({ ...now, reservedWords: ["SELECT", "FROM", "VALUES"] }));
  const id = openWorksheet(store, text);
  within(store, <Worksheet id={id} />);
  await settle();
  return { asked, store, id, view: viewOf(id) };
}

describe("a worksheet's commands", () => {
  it("run the statement at the cursor, the selection's, or the whole script [DESIGN] D36", async () => {
    const { asked, store, view } = await shown("VALUES (1); VALUES (2); VALUES (3)");
    const sent = () => asked.filter((a) => a.command === "run_statement").map((a) => a.args["sql"]);
    act(() => view?.dispatch({ selection: EditorSelection.cursor(13) }));
    await act(() => runCurrent(store));
    expect(sent()).toEqual(["VALUES (2)"]);
    act(() => view?.dispatch({ selection: EditorSelection.range(12, 34) }));
    await act(() => runCurrent(store));
    expect(sent().slice(1)).toEqual(["VALUES (2)", "VALUES (3)"]);
    await act(() => runScript(store));
    expect(sent().slice(3)).toEqual(["VALUES (1)", "VALUES (2)", "VALUES (3)"]);
    act(() => view?.dispatch({ selection: EditorSelection.cursor(1) }));
    await act(() => explainCurrent(store, false));
    expect(sent().at(-1)).toBe("EXPLAIN VALUES (1)");
    act(() => view?.dispatch({ selection: EditorSelection.range(24, 34) }));
    await act(() => explainCurrent(store, true));
    expect(sent().at(-1)).toBe("EXPLAIN ANALYZE VALUES (3)");
    await act(() => stopCurrent(store));
  });

  it("explain a data change running nothing, and analyze it only as asked, rolled back after unless kept [DESIGN] D61 D70", async () => {
    const change = "UPDATE T SET A = 1 WHERE A = 2";
    const { asked, store, view } = await shown(change, {
      set_autocommit: (args) => ({
        ...SESSION,
        transaction: { ...SESSION.transaction, autocommit: args["on"] === true },
      }),
      session_state: () => SESSION,
    });
    store.update((now) => ({
      ...now,
      open: now.open.map((c) => ({
        ...c,
        session: { ...c.session, transaction: { active: false, autocommit: true, readOnly: false } },
      })),
    }));
    const sent = () =>
      asked
        .filter((a) => a.command === "run_statement" || a.command === "set_autocommit")
        .map((a) => a.args["sql"] ?? `autocommit ${String(a.args["on"])}`);
    act(() => view?.dispatch({ selection: EditorSelection.cursor(1) }));
    const choose = async (choice: "rollBack" | "keep" | "explain" | null) => {
      const running = explainCurrent(store, true);
      await settle();
      const dialog = store.current().dialog;
      expect(dialog?.kind).toBe("analyzeChange");
      if (dialog?.kind === "analyzeChange") {
        dialog.answer(choice);
      }
      await act(() => running);
    };
    await choose(null);
    expect(sent()).toEqual([]);
    await choose("rollBack");
    expect(sent()).toEqual([
      "autocommit false",
      "SAVEPOINT STUDIO_ANALYZE",
      `EXPLAIN ANALYZE ${change}`,
      "ROLLBACK TO SAVEPOINT STUDIO_ANALYZE",
      "ROLLBACK",
      "autocommit true",
    ]);
    await choose("keep");
    expect(sent().at(-1)).toBe(`EXPLAIN ANALYZE ${change}`);
    expect(store.current().dialog).toBeNull();
    // Plain EXPLAIN runs nothing: asked for, or chosen instead, it is sent alone, with no savepoint or rollback (D70).
    const before = sent().length;
    await choose("explain");
    await act(() => explainCurrent(store, false));
    expect(sent().slice(before)).toEqual([`EXPLAIN ${change}`, `EXPLAIN ${change}`]);
    expect(store.current().dialog).toBeNull();
  });

  it("format, comment, change case, bookmark, find and describe in the editor [DESIGN] D36", async () => {
    const { store, view } = await shown("select a from t");
    formatCurrent(store);
    expect(view?.state.doc.toString()).toBe("SELECT a\nFROM t\n");
    act(() => view?.dispatch({ selection: EditorSelection.cursor(0) }));
    EDITOR_ACTS.comment(store);
    expect(view?.state.doc.toString().startsWith("-- SELECT")).toBe(true);
    EDITOR_ACTS.comment(store);
    act(() => view?.dispatch({ selection: EditorSelection.range(7, 8) }));
    EDITOR_ACTS.upper(store);
    EDITOR_ACTS.lower(store);
    EDITOR_ACTS.bookmark(store);
    EDITOR_ACTS.nextBookmark(store);
    EDITOR_ACTS.previousBookmark(store);
    EDITOR_ACTS.find(store);
    expect(document.querySelector(".cm-search")).not.toBeNull();
    EDITOR_ACTS.describe(store);
    expect(view?.state.doc.toString()).toBe("SELECT a\nFROM t\n");
    store.update((now) => ({ ...now, activeWorksheet: null }));
    onEditor(store, () => {
      throw new Error("no editor is active");
    });
    expect(hasWorksheet(store)).toBe(false);
    await runCurrent(store);
    await runScript(store);
    await explainCurrent(store, false);
    formatCurrent(store);
    favouriteCurrent(store);
  });

  it("go to the definition of the table or routine at the cursor [DESIGN] D36", async () => {
    const { store, view } = await shown("SELECT * FROM STAFF; VALUES (DOUBLED(1))");
    act(() => view?.dispatch({ selection: EditorSelection.cursor(16) }));
    await act(() => goToDefinition(store));
    expect(store.current().selected?.object).toEqual({ kind: "table", schema: "ANN", name: "STAFF" });
    catalogBackend({ catalog_table: () => Promise.reject(new Error("no table")) });
    store.update((now) => ({
      ...now,
      catalogs: {
        1: {
          ...(now.catalogs[1] ?? EMPTY_CATALOG),
          tables: {},
          objects: {
            ANN: {
              tables: [],
              routines: [{ specific: "DOUBLED_1", name: "DOUBLED", kind: "FUNCTION" }],
              sequences: [],
              domains: [],
              types: [],
              truncated: false,
            },
          },
        },
      },
    }));
    act(() => view?.dispatch({ selection: EditorSelection.cursor(31) }));
    await act(() => goToDefinition(store));
    expect(store.current().selected?.object).toEqual({
      kind: "routine",
      schema: "ANN",
      specific: "DOUBLED_1",
      name: "DOUBLED",
    });
    act(() => view?.dispatch({ selection: EditorSelection.cursor(20) }));
    await act(() => goToDefinition(store));
  });

  it("save to the worksheet's file, or one the dialog chooses, and open files in worksheets of their own [DESIGN] D36", async () => {
    const opened = { path: "/p/report.sql", name: "report.sql", text: "VALUES (9)" };
    let chosen: string | null = "/p/Untitled.sql";
    const { asked, store, id } = await shown("VALUES (1)", {
      save_text_file: () => chosen,
      write_sql_file: () => null,
      open_sql_file: () => opened,
      read_sql_file: (args) => ({ ...opened, path: String(args["path"]) }),
    });
    await saveCurrent(store, false);
    expect(asked.find((a) => a.command === "save_text_file")?.args).toEqual({
      name: "Untitled.sql",
      text: "VALUES (1)",
    });
    expect(worksheetOf(store.current(), id)).toMatchObject({
      path: "/p/Untitled.sql",
      title: "Untitled.sql",
      modified: false,
    });
    await saveCurrent(store, false);
    expect(asked.find((a) => a.command === "write_sql_file")?.args).toEqual({
      path: "/p/Untitled.sql",
      text: "VALUES (1)",
    });
    chosen = null;
    await saveCurrent(store, true);
    expect(worksheetOf(store.current(), id)?.path).toBe("/p/Untitled.sql");
    await openFile(store);
    const file = store.current().worksheets.find((w) => w.path === "/p/report.sql");
    expect(file).toMatchObject({ title: "report.sql", text: "VALUES (9)", modified: false });
    await openPath(store, "/p/report.sql");
    expect(store.current().activeWorksheet).toBe(file?.id);
    await openPath(store, "/p/other.sql");
    expect(store.current().worksheets.some((w) => w.path === "/p/other.sql")).toBe(true);
    catalogBackend({
      read_sql_file: () =>
        refused({
          sqlcode: -910,
          sqlstate: "TB910",
          message: "not chosen",
          rule: null,
          position: null,
          active: false,
          diagnostics: null,
        }),
      write_sql_file: () =>
        refused({
          sqlcode: -910,
          sqlstate: "TB910",
          message: "not chosen",
          rule: null,
          position: null,
          active: false,
          diagnostics: null,
        }),
      open_sql_file: () => null,
    });
    await openPath(store, "/p/denied.sql");
    expect(store.current().error?.message).toBe("not chosen");
    await saveCurrent(store, false);
    await openFile(store);
    store.update((now) => ({ ...now, activeWorksheet: null }));
    await saveCurrent(store, false);
  });

  it("keep a favourite query, and make each statement its own transaction, or not [DESIGN] D36", async () => {
    const { asked, store, view } = await shown("VALUES (1); VALUES (2)", {
      keep_query: (args) => [args["query"]],
      set_autocommit: (args) => ({
        ...SESSION,
        transaction: { ...SESSION.transaction, autocommit: args["on"] === true },
      }),
    });
    act(() => view?.dispatch({ selection: EditorSelection.range(0, 10) }));
    favouriteCurrent(store);
    expect(store.current().dialog).toEqual({ kind: "favourite", sql: "VALUES (1)" });
    await keepFavourite(store, "One", "VALUES (1)");
    expect(store.current().queries.map((q) => q.name)).toEqual(["One"]);
    expect(store.current().dialog).toBeNull();
    await toggleAutocommit(store);
    expect(store.current().open[0]?.session.transaction.autocommit).toBe(true);
    expect(asked.find((a) => a.command === "set_autocommit")?.args).toEqual({ connection: 1, on: true });
    catalogBackend({
      keep_query: () =>
        refused({
          sqlcode: -910,
          sqlstate: "TB910",
          message: "full",
          rule: null,
          position: null,
          active: false,
          diagnostics: null,
        }),
    });
    await keepFavourite(store, "Two", "VALUES (2)");
    expect(store.current().error?.message).toBe("full");
  });
});

describe("a worksheet's panel", () => {
  it("runs, stops, explains and formats from its toolbar, on the connection chosen [DESIGN] D36", async () => {
    const { asked, store, id } = await shown("VALUES (1)");
    const bar = screen.getByRole("toolbar", { name: "Worksheet" });
    fireEvent.click(inside(bar).getByRole("button", { name: "Run Statement" }));
    await settle();
    fireEvent.click(inside(bar).getByRole("button", { name: "Run Script" }));
    await settle();
    fireEvent.click(inside(bar).getByRole("button", { name: "Explain" }));
    await settle();
    fireEvent.click(inside(bar).getByRole("button", { name: "Format" }));
    fireEvent.click(inside(bar).getByRole("checkbox", { name: "Autocommit" }));
    await settle();
    expect(asked.filter((a) => a.command === "run_statement").length).toBeGreaterThanOrEqual(3);
    fireEvent.change(inside(bar).getByLabelText("Connection"), { target: { value: "" } });
    expect(worksheetOf(store.current(), id)?.connection).toBeNull();
    expect(inside(bar).getByRole<HTMLButtonElement>("button", { name: "Run Statement" }).disabled).toBe(true);
    fireEvent.change(inside(bar).getByLabelText("Connection"), { target: { value: "1" } });
    expect(worksheetOf(store.current(), id)?.connection).toBe(1);
    act(() => {
      changeWorksheet(store, id, (w) => ({ ...w, running: true }));
    });
    expect(screen.getByRole("status").textContent).toBe("Running…");
    fireEvent.click(inside(bar).getByRole("button", { name: "Cancel Statement" }));
  });

  it("shows its script variables' values, its outline, and shares itself by its divider [DESIGN] D36", async () => {
    const { store, id, view } = await shown("SELECT * FROM ${s}.T; VALUES (1)");
    const variables = screen.getByLabelText("Script variables");
    fireEvent.change(inside(variables).getByPlaceholderText("no value"), { target: { value: "ANN" } });
    expect(worksheetOf(store.current(), id)?.variables).toEqual({ s: "ANN" });
    act(() => {
      changeWorksheet(store, id, (w) => ({ ...w, outline: true, pieces: split(w.text) }));
    });
    const outline = screen.getByRole("navigation", { name: "Outline" });
    fireEvent.click(inside(outline).getByText("VALUES (1)"));
    expect(view?.state.selection.main.from).toBe(22);
    const divider = screen.getByRole("separator", { name: "Editor and panes" });
    fireEvent.keyDown(divider, { key: "ArrowUp" });
    expect(divider.getAttribute("aria-valuenow")).toBe("55");
    fireEvent.keyDown(divider, { key: "ArrowDown" });
    fireEvent.keyDown(divider, { key: "x" });
    expect(divider.getAttribute("aria-valuenow")).toBe("60");
    fireEvent.pointerDown(divider);
    fireEvent.pointerMove(window, { clientY: 10 });
    fireEvent.pointerUp(window);
    act(() => {
      store.update((now) => ({ ...now, worksheets: [] }));
    });
    expect(screen.getByText("This worksheet is closed.")).toBeTruthy();
  });

  it("shows its results, more read as the grid nears the last read, its messages, a failure's place, and its plan [DESIGN] D36", async () => {
    const { store, id } = await shown("VALUES (1)", {
      run_statement: () => ({
        kind: "ran",
        answer: {
          ...ran([["1"]]),
          outcome: {
            kind: "rows",
            result: 1,
            columns: [{ name: null, typeWritten: "INTEGER", typeName: null, notNull: false }],
            page: { from: 0, rows: [["1"], [null]], rowsRead: 2, complete: false, lobs: [] },
          },
        },
      }),
      fetch_rows: () => ({ from: 2, rows: [["3"]], rowsRead: 3, complete: true, lobs: [] }),
    });
    expect(screen.getByText("No result yet: run a statement to see its rows.")).toBeTruthy();
    await act(() => runCurrent(store));
    const result = screen.getByRole("table", { name: "Result grid" });
    expect(inside(result).getByText("(1)")).toBeTruthy();
    expect(inside(result).getByRole("button", { name: "Cell 0,1" }).textContent).toBe("NULL");
    await settle();
    expect(screen.getByText(/^3 rows read;/u)).toBeTruthy();
    await act(() => runScript(store));
    act(() => {
      changeWorksheet(store, id, (w) => ({ ...w, runs: [...w.runs, { ...must(w.runs[0]), id: 2 }] }));
    });
    fireEvent.click(screen.getByRole("tab", { name: "Result 2" }));
    expect(worksheetOf(store.current(), id)?.shown).toBe(2);
    act(() => {
      changeWorksheet(store, id, (w) => ({
        ...w,
        runs: [
          {
            ...must(w.runs[0]),
            outcome: { kind: "done", sqlcode: 0, sqlstate: "00000", rowsAffected: 1, generated: [] },
          },
        ],
        shown: 1,
      }));
    });
    fireEvent.click(screen.getByRole("tab", { name: "Messages" }));
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
    act(() => {
      changeWorksheet(store, id, (w) => ({
        ...w,
        messages: [{ at: 0, kind: "error", text: "42000 (-103): no", position: 3 }],
      }));
    });
    fireEvent.click(screen.getByRole("button", { name: "42000 (-103): no" }));
    expect(viewOf(id)?.state.selection.main.head).toBe(3);
    act(() => {
      changeWorksheet(store, id, (w) => ({ ...w, messages: [] }));
    });
    expect(screen.getByText("No messages yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Plan" }));
    expect(screen.getByText(/^No plan yet: Explain shows the plan of the statement at the cursor/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Results" }));
  });
});

describe("an editor alone", () => {
  it("of no worksheet is empty [DESIGN] D36", async () => {
    catalogBackend();
    const store = await opened();
    within(store, <Editor id="none" />);
    expect(viewOf("none")?.state.doc.toString()).toBe("");
  });

  it("runs the statement at the cursor straight to a file, but one of parameters or of variables with no value [DESIGN] D39", async () => {
    const { asked, store, id, view } = await shown("VALUES (1); VALUES (?); VALUES (${n})", {
      export_query: () => ({ path: "/tmp/one.rows", rows: 1 }),
    });
    const exported = () =>
      asked
        .filter((a) => a.command === "export_query")
        .map((a) => {
          const request = a.args["request"] as Record<string, unknown>;
          return [request["sql"], request["kind"]];
        });
    act(() => view?.dispatch({ selection: EditorSelection.cursor(1) }));
    await act(() => runToFile(store, "native"));
    expect(exported()).toEqual([["VALUES (1)", "native"]]);
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe("Exported 1 rows to /tmp/one.rows.");
    act(() => view?.dispatch({ selection: EditorSelection.range(12, 22) }));
    await act(() => runToFile(store, "csv"));
    act(() => view?.dispatch({ selection: EditorSelection.cursor(25) }));
    await act(() => runToFile(store, "csv"));
    expect(exported()).toHaveLength(1);
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe(
      "A statement of parameters, or of script variables with no value, is not run to a file.",
    );
    act(() => {
      changeWorksheet(store, id, (w) => ({ ...w, variables: { n: "7" } }));
    });
    await act(() => runToFile(store, "csv"));
    expect(exported().at(-1)).toEqual(["VALUES (7)", "csv"]);
    act(() => {
      changeWorksheet(store, id, (w) => ({ ...w, connection: null }));
    });
    await act(() => runToFile(store, "csv"));
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe(
      "The worksheet has no open connection: choose one.",
    );
  });
});
