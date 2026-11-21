import { EMPTY_CATALOG } from "../../explorer/catalogState";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, render } from "@testing-library/react";
import { vi } from "vitest";
import type { Piece } from "../../ipc/worksheet";
import { StoreContext } from "../../state/store";
import { changeWorksheet, openWorksheet, worksheetOf } from "../../state/worksheets";
import { catalogBackend, opened, STAFF } from "../../test/catalog";
import { formatWords } from "../dialect";
import {
  changeCase,
  formatScript,
  goToBookmark,
  insertText,
  pieceAt,
  selected,
  selectStatement,
  showFailure,
  statementAtCursor,
  toggleBookmark,
} from "./actions";
import { connectionOf, defaultSchema, tableDetail, tableNamed, unquoted } from "./catalog";
import { completionSource, iconElement, toCompletion } from "../complete/source";
import { Editor, SPLIT_AFTER_MS } from "./Editor";
import { describeSource, describeTable, editorExtensions, TABLE_DRAG, writtenFor } from "./extensions";
import { bookmarks, failureField, piecesField, setPieces } from "./fields";
import { callAt, signature } from "./hints";
import { viewOf } from "./views";

/** A piece of `from` to `to`, a statement read. */
function piece(from: number, to: number, text = ""): Piece {
  return {
    from,
    to,
    statement: { text, class: "read", destroys: null, floor: null, readWrite: false, connects: false },
  };
}

/** An editor of `doc`, its worksheet `id` of `store`. */
function editor(
  doc: string,
  store: Parameters<typeof editorExtensions>[0]["store"],
  id: string,
  changed = vi.fn(),
): EditorView {
  return new EditorView({
    state: EditorState.create({ doc, extensions: editorExtensions({ store, worksheet: id }, changed) }),
  });
}

describe("the editor's fields and actions", () => {
  it("find the statement at the cursor, its pieces following the text's changes [DESIGN] D36", async () => {
    catalogBackend();
    const store = await opened();
    const id = openWorksheet(store, "VALUES (1);\nVALUES (2);");
    const view = editor("VALUES (1);\nVALUES (2);", store, id);
    view.dispatch({ effects: setPieces.of([piece(0, 10, "VALUES (1)"), piece(12, 22, "VALUES (2)")]) });
    view.dispatch({ selection: EditorSelection.cursor(14) });
    expect(statementAtCursor(view)?.from).toBe(12);
    view.dispatch({ changes: { from: 0, insert: "  " } });
    expect(view.state.field(piecesField).map((p) => p.from)).toEqual([2, 14]);
    expect(pieceAt([piece(0, 3), piece(5, 8)], 4)?.from).toBe(0);
    expect(pieceAt([piece(5, 8)], 1)?.from).toBe(5);
    expect(pieceAt([], 1)).toBeUndefined();
    expect(selected(view)).toBeNull();
    selectStatement(view, 2, 12);
    expect(selected(view)).toEqual({ text: "VALUES (1)", from: 2 });
    view.destroy();
  });

  it("bookmark lines, move between them round the end, and keep them as the text changes [DESIGN] D36", async () => {
    catalogBackend();
    const store = await opened();
    const view = editor("a\nb\nc\nd", store, openWorksheet(store));
    goToBookmark(view, false);
    view.dispatch({ selection: EditorSelection.cursor(2) });
    toggleBookmark(view);
    view.dispatch({ selection: EditorSelection.cursor(6) });
    toggleBookmark(view);
    expect(bookmarks(view.state)).toEqual([2, 6]);
    goToBookmark(view, false);
    expect(view.state.selection.main.head).toBe(2);
    goToBookmark(view, true);
    expect(view.state.selection.main.head).toBe(6);
    goToBookmark(view, true);
    expect(view.state.selection.main.head).toBe(2);
    toggleBookmark(view);
    expect(bookmarks(view.state)).toEqual([6]);
    view.dispatch({ changes: { from: 0, insert: "x\n" } });
    expect(bookmarks(view.state)).toEqual([8]);
    view.destroy();
  });

  it("change a selection's case, or the word at the cursor's, format, mark a failure and insert [DESIGN] D36", async () => {
    catalogBackend();
    const store = await opened();
    const view = editor("select a from t", store, openWorksheet(store));
    view.dispatch({ selection: EditorSelection.cursor(2) });
    changeCase(view, true);
    expect(view.state.doc.toString()).toBe("SELECT a from t");
    view.dispatch({ selection: EditorSelection.range(9, 13) });
    changeCase(view, true);
    changeCase(view, false);
    expect(view.state.doc.toString()).toBe("SELECT a from t");
    const options = { keyWords: "upper", indent: 2, lineWidth: 80, words: formatWords(["SELECT", "FROM"]) } as const;
    view.dispatch({ selection: EditorSelection.cursor(0) });
    formatScript(view, options);
    expect(view.state.doc.toString()).toBe("SELECT a\nFROM t\n");
    view.dispatch({ selection: EditorSelection.range(0, 8) });
    formatScript(view, { ...options, keyWords: "lower" });
    expect(view.state.doc.toString()).toBe("select a\nFROM t\n");
    showFailure(view, 7);
    expect(view.state.field(failureField).size).toBe(1);
    showFailure(view, 9);
    showFailure(view, 999);
    insertText(view, "-- end");
    expect(view.state.field(failureField).size).toBe(0);
    expect(view.state.doc.toString().endsWith("-- end")).toBe(true);
    view.destroy();
  });
});

describe("the editor's catalog", () => {
  it("names a table by its alias, its schema if written, and reads its columns once [DESIGN] D36", async () => {
    const asked = catalogBackend();
    const store = await opened();
    const id = openWorksheet(store);
    const bridge = { store, worksheet: id };
    expect(tableNamed('SELECT * FROM ANN.STAFF AS s JOIN "lower" l ON 1 = 1', "s")).toEqual({
      schema: "ANN",
      table: "STAFF",
    });
    expect(tableNamed("SELECT * FROM STAFF s", '"l"')).toEqual({ schema: null, table: "l" });
    expect(tableNamed("SELECT 1", "staff")).toEqual({ schema: null, table: "STAFF" });
    expect(unquoted('"a""b"')).toBe('a"b');
    expect([connectionOf(bridge), defaultSchema(bridge)]).toEqual([1, "ANN"]);
    expect(await tableDetail(bridge, null, "STAFF")).toEqual(STAFF);
    expect(await tableDetail(bridge, "ANN", "STAFF")).toEqual(STAFF);
    expect(asked.filter((a) => a.command === "catalog_table")).toHaveLength(1);
    store.update((now) => ({
      ...now,
      catalogs: {
        1: {
          ...(now.catalogs[1] ?? EMPTY_CATALOG),
          objects: {
            ANN: {
              tables: [
                { name: "STAFF", kind: "BASE TABLE" },
                { name: "lower", kind: "VIEW" },
              ],
              routines: [],
              sequences: [],
              domains: [],
              types: [],
              truncated: false,
            },
          },
        },
      },
    }));
    changeWorksheet(store, id, (w) => ({ ...w, connection: null }));
    expect(await tableDetail(bridge, null, "STAFF")).toBeNull();
  });

  it("finds no table of a name the user may not see, and keeps no error of it [DESIGN] D36", async () => {
    catalogBackend({
      catalog_table: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the backend rejects with Studio's error, not an Error
        throw {
          sqlcode: -910,
          sqlstate: "TB910",
          message: "no table",
          rule: null,
          position: null,
          active: false,
          diagnostics: null,
        };
      },
    });
    const store = await opened();
    const bridge = { store, worksheet: openWorksheet(store) };
    expect(await tableDetail(bridge, null, "NOPE")).toBeNull();
    expect(store.current().error).toBeNull();
  });

  it("completes from the engine as typed, by Turborel's parser's scope or by the words, each item its icon [DESIGN] D40", async () => {
    catalogBackend({ statement_scope: () => ({ parsed: false, sources: [] }) });
    const store = await opened();
    const id = openWorksheet(store);
    const source = completionSource({ store, worksheet: id });
    const at = (doc: string, pos: number, explicit = false) =>
      source(new CompletionContext(EditorState.create({ doc }), pos, explicit));
    const columns = await at("SELECT s. FROM STAFF s", 9);
    expect(columns?.options.map((o) => o.label)).toEqual(["ID", "NAME", "DEPT"]);
    expect(columns?.options[0]?.detail).toBe("INTEGER");
    expect(await at("SELECT ", 7)).toBeNull();
    expect((await at("SELECT ", 7, true))?.options.length).toBeGreaterThan(0);
    expect(await at("SELECT 'a", 9, true)).toBeNull();
    const words = await at("sel", 3);
    expect(words?.options.some((o) => o.label === "sel" && o.type === "snippet")).toBe(true);
    catalogBackend({
      statement_scope: () => ({
        parsed: true,
        sources: [{ kind: "table", schema: "ANN", name: "STAFF", alias: "Q", columns: null, outer: true }],
      }),
    });
    expect((await at("SELECT q. FROM STAFF q", 9))?.options.map((o) => o.label)).toEqual(["ID", "NAME", "DEPT"]);
    expect(iconElement("table").querySelector("svg")).not.toBeNull();
    expect(iconElement("table").innerHTML).toBe(iconElement("table").innerHTML);
    expect((await at("SELECT q.;\nVALUES (1)", 9))?.options.length).toBeGreaterThan(0);
    expect((await at("INSERT INTO STAFF (", 19))?.options[0]?.label).toBe("NAME");
    expect((await at("SELECT * FROM STAFF WHERE", 25))?.options.length).toBeGreaterThan(0);
    changeWorksheet(store, id, (w) => ({ ...w, running: true }));
    expect((await at("SELECT *", 8))?.options.length).toBeGreaterThan(0);
  });

  it("applies an item as written, a snippet by its fields, and ranks what was chosen first after [DESIGN] D40", () => {
    const view = new EditorView({ state: EditorState.create({ doc: "SELECT x FROM T" }) });
    const item = toCompletion({
      label: "NAME",
      kind: "column",
      boost: 30,
      detail: "VARCHAR(20)",
      info: "of ANN.STAFF",
    });
    expect(item.boost).toBe(30);
    (item.apply as (v: EditorView, c: unknown, from: number, to: number) => void)(view, item, 7, 8);
    expect(view.state.doc.toString()).toBe("SELECT NAME FROM T");
    const snip = toCompletion({ label: "sel", kind: "snippet", boost: 8, apply: "SELECT #{columns}" });
    (snip.apply as (v: EditorView, c: unknown, from: number, to: number) => void)(view, snip, 0, 0);
    expect(view.state.doc.toString().startsWith("SELECT columns")).toBe(true);
    view.destroy();
  });

  it("writes a table dropped as a query of its columns, or an INSERT, and describes it [DESIGN] D36", async () => {
    catalogBackend();
    const store = await opened();
    const reserved = new Set(["VALUE"]);
    expect(writtenFor(STAFF, false, reserved, "ANN")).toBe("SELECT ID, NAME, DEPT\nFROM STAFF");
    expect(writtenFor(STAFF, true, reserved, "BOB")).toBe("INSERT INTO ANN.STAFF (ID, NAME, DEPT)\nVALUES (?, ?, ?)");
    expect(describeTable(STAFF).textContent).toContain("ANN.STAFF (BASE TABLE)ID  INTEGER NOT NULL");
    const view = editor("", store, openWorksheet(store));
    document.body.append(view.dom);
    const data = new Map<string, string>([[TABLE_DRAG, JSON.stringify({ schema: "ANN", name: "STAFF" })]]);
    const drop = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, "dataTransfer", { value: { getData: (type: string) => data.get(type) ?? "" } });
    view.contentDOM.dispatchEvent(drop);
    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toBe("SELECT ID, NAME, DEPT\nFROM STAFF");
    });
    const other = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(other, "dataTransfer", { value: { getData: () => "" } });
    view.contentDOM.dispatchEvent(other);
    view.destroy();
  });
});

describe("a table's description", () => {
  it("is of the table named where the pointer rests, by its schema if written, and of none else [DESIGN] D36", async () => {
    catalogBackend({ catalog_table: (args) => (args["name"] === "STAFF" ? STAFF : Promise.reject(new Error("none"))) });
    const store = await opened();
    const bridge = { store, worksheet: openWorksheet(store) };
    const view = editor("SELECT * FROM ANN.STAFF, NOPE;   ", store, bridge.worksheet);
    const source = describeSource(bridge);
    const found = await source(view, 20);
    expect(found?.pos).toBe(18);
    expect(found?.create().dom.textContent).toContain("ANN.STAFF");
    expect(await source(view, 26)).toBeNull();
    expect(await source(view, 32)).toBeNull();
    const big = editor("x".repeat(1_000_001), store, bridge.worksheet);
    big.destroy();
    view.destroy();
  });
});

describe("a routine's hint", () => {
  it("is of the call the cursor is in, its signature written [DESIGN] D36", () => {
    expect(callAt("SELECT DOUBLED(1, F(2), ", 24)).toEqual({ name: "DOUBLED", open: 14 });
    expect(callAt('VALUES ("odd name"(', 19)).toEqual({ name: '"odd name"', open: 18 });
    expect(callAt("SELECT 1; F(", 8)).toBeNull();
    expect(callAt("(", 1)).toBeNull();
    expect(callAt("SELECT 1", 8)).toBeNull();
    expect(
      signature({
        schema: "ANN",
        specific: "D",
        name: "DOUBLED",
        kind: "FUNCTION",
        returns: "INTEGER",
        parameters: [
          { mode: "IN", name: "N", typeWritten: "INTEGER" },
          { mode: "IN", name: null, typeWritten: "DATE" },
        ],
        body: null,
        deterministic: true,
        dataAccess: "CONTAINS SQL",
        privileges: [],
      }),
    ).toBe("DOUBLED(IN N INTEGER, IN DATE) RETURNS INTEGER");
  });

  it("shows the routine's parameters as its arguments are written, and goes as the cursor leaves [DESIGN] D36", async () => {
    const asked = catalogBackend();
    const store = await opened();
    store.update((now) => ({
      ...now,
      catalogs: {
        1: {
          ...(now.catalogs[1] ?? EMPTY_CATALOG),
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
    const view = editor("", store, openWorksheet(store));
    document.body.append(view.dom);
    view.dispatch({ changes: { from: 0, insert: "VALUES (DOUBLED(" }, selection: EditorSelection.cursor(16) });
    await vi.waitFor(() => {
      expect(document.querySelector(".cm-hint")?.textContent).toBe("DOUBLED(IN N INTEGER) RETURNS INTEGER");
    });
    view.dispatch({ changes: { from: 16, insert: "1" }, selection: EditorSelection.cursor(17) });
    expect(asked.filter((a) => a.command === "catalog_routine")).toHaveLength(1);
    view.dispatch({ changes: { from: 17, insert: "))" }, selection: EditorSelection.cursor(19) });
    await vi.waitFor(() => {
      expect(document.querySelector(".cm-hint")).toBeNull();
    });
    view.dispatch({ changes: { from: 19, insert: "; NOPE(" }, selection: EditorSelection.cursor(26) });
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector(".cm-hint")).toBeNull();
    view.destroy();
  });
});

describe("the editor", () => {
  it("is the worksheet's text, its changes kept and its statements split a moment after, split in two views [DESIGN] D36", async () => {
    const asked = catalogBackend({ split_script: () => [piece(0, 10, "VALUES (1)")] });
    const store = await opened();
    const id = openWorksheet(store, "VALUES (1)");
    render(
      <StoreContext.Provider value={store}>
        <Editor id={id} />
      </StoreContext.Provider>,
    );
    const view = viewOf(id);
    expect(view?.state.doc.toString()).toBe("VALUES (1)");
    await vi.waitFor(
      () => {
        expect(worksheetOf(store.current(), id)?.pieces).toHaveLength(1);
      },
      { timeout: SPLIT_AFTER_MS * 5 },
    );
    act(() => {
      view?.dispatch({ changes: { from: 10, insert: ";" } });
    });
    expect(worksheetOf(store.current(), id)?.text).toBe("VALUES (1);");
    act(() => {
      changeWorksheet(store, id, (w) => ({ ...w, split: true }));
    });
    const views = document.querySelectorAll(".editor .cm-content");
    expect(views).toHaveLength(2);
    const first = viewOf(id);
    act(() => {
      first?.dispatch({ changes: { from: 0, insert: "-- a\n" } });
    });
    expect(EditorView.findFromDOM(views[1] as HTMLElement)?.state.doc.toString()).toBe("-- a\nVALUES (1);");
    act(() => {
      EditorView.findFromDOM(views[1] as HTMLElement)?.dispatch({ changes: { from: 0, insert: "x" } });
    });
    expect(viewOf(id)?.state.doc.toString()).toBe("x-- a\nVALUES (1);");
    act(() => {
      store.update((now) => ({ ...now, reservedWords: ["SELECT"] }));
    });
    expect(asked.some((a) => a.command === "split_script")).toBe(true);
  });
});
