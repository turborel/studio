import { act, fireEvent, screen, within as inside } from "@testing-library/react";
import type { Ran } from "../ipc/connections";
import { runStatements } from "../state/running";
import type { Store } from "../state/store";
import { changeWorksheet, openWorksheet, worksheetOf } from "../state/worksheets";
import { SESSION } from "../test/backend";
import { catalogBackend, must, opened, refused, settle, within } from "../test/catalog";
import { Panes } from "../worksheet/Panes";
import { StatusBar } from "../shell/StatusBar";

/** The columns of the result the tests run. */
const COLUMNS = [
  ["ID", "INTEGER"],
  ["NAME", "VARCHAR(20)"],
  ["DOC", "JSON"],
  ["BODY", "CLOB(1M)"],
  ["PIC", "BLOB(1M)"],
  ["BIN", "VARBINARY(4)"],
  ["AT", "GEOMETRY(0)"],
  ["V", "VECTOR(3)"],
].map(([name, typeWritten]) => ({
  name: name ?? null,
  typeWritten: typeWritten ?? "",
  typeName: null,
  notNull: false,
}));

/** Its rows. */
const ROWS = [
  [
    "1",
    "Ada",
    '{"a":[1,true,null]}',
    "<CHARACTER LARGE OBJECT of 9 characters>",
    "<BINARY LARGE OBJECT of 8 octets>",
    "DEADBEEF",
    "POINT (1 2)",
    "[1,2,3]",
  ],
  ["2", "Bob", null, "short", null, null, "LINESTRING (0 0, 5 5)", "[0,1,0]"],
  ["3", null, "<a><b>x</b></a>", null, null, "00", null, null],
];

/** A PNG's first octets, in Base64. */
const PNG = "iVBORw0KGgoAAAA=";

/** What a run of `sql` gives: the rows above, a result of its own each time. */
function ranRows(result: number): Ran {
  return {
    outcome: {
      kind: "rows",
      result,
      columns: COLUMNS,
      page: {
        from: 0,
        rows: ROWS,
        rowsRead: 3,
        complete: true,
        lobs: [
          [0, 3],
          [0, 4],
        ],
      },
    },
    warnings: [],
    serverTime: { total: 1500, queued: 0, locks: 0 },
    session: SESSION,
  };
}

/** A worksheet that has run `sql`, its panes shown with the status bar: the store, the worksheet, and the calls made. */
async function ranResult(
  sql = "SELECT * FROM ANN.ITEMS",
  extra: Record<string, (args: Record<string, unknown>) => unknown> = {},
) {
  let result = 0;
  const asked = catalogBackend({
    run_statement: () => {
      result += 1;
      return { kind: "ran", answer: ranRows(result) };
    },
    result_value: (args) =>
      args["column"] === 3
        ? { kind: "text", text: "long text", octets: 9, cut: false }
        : { kind: "binary", base64: PNG, octets: 11, cut: true },
    ...extra,
  });
  const store = await opened();
  const id = openWorksheet(store, sql);
  within(
    store,
    <>
      <Panes id={id} />
      <StatusBar />
    </>,
  );
  await act(() => runStatements(store, id, [{ sql, from: 0, to: sql.length }]));
  await settle();
  return { store, id, asked };
}

/** The statements sent to be run. */
function sent(asked: { command: string; args: Record<string, unknown> }[]): unknown[] {
  return asked.filter((a) => a.command === "run_statement").map((a) => a.args["sql"]);
}

/** The cell at `col`, `row` of the grid. */
function cell(col: number, row: number): HTMLElement {
  return screen.getByRole("button", { name: `Cell ${String(col)},${String(row)}` });
}

/** Clicks the button named `name`. */
async function click(name: string | RegExp): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name }));
  await settle();
}

/** Chooses the item named `name` of the menu open. */
async function choose(name: string): Promise<void> {
  fireEvent.click(screen.getByRole("menuitem", { name }));
  await settle();
}

/** The run worksheet `id` shows last. */
function lastRun(store: Store, id: string) {
  return must(worksheetOf(store.current(), id)?.runs.at(-1));
}

describe("a result's grid", () => {
  it("shows each column's name and type, sorts on the server by a header's click, by several with Shift [DESIGN] D39", async () => {
    const { store, id, asked } = await ranResult();
    expect(screen.getByRole("button", { name: "ID" })).toBeTruthy();
    expect(cell(0, 0).textContent).toBe("1");
    expect(cell(1, 2).textContent).toBe("NULL");
    fireEvent.click(screen.getByRole("button", { name: "NAME" }));
    await settle();
    expect(sent(asked).at(-1)).toBe(
      'SELECT * FROM (\nSELECT * FROM ANN.ITEMS\n) AS "Q" ("ID", "NAME", "DOC", "BODY", "PIC", "BIN", "AT", "V")\nORDER BY "NAME"',
    );
    expect(asked.some((a) => a.command === "close_result" && a.args["result"] === 1)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "ID" }), { shiftKey: true });
    await settle();
    expect(sent(asked).at(-1)).toContain('ORDER BY "NAME", "ID"');
    expect(screen.getByRole("button", { name: "NAME ▲1" })).toBeTruthy();
    expect(screen.getByText(/sorted or filtered/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Widen ID ▲2" }));
    await click("Clear Filter and Sort");
    expect(sent(asked).at(-1)).toBe("SELECT * FROM ANN.ITEMS");
    expect(lastRun(store, id).query).toBeNull();
  });

  it("filters on the server by a condition written, or by a cell's value from its menu [DESIGN] D39", async () => {
    const { asked } = await ranResult();
    fireEvent.change(screen.getByRole("textbox", { name: "Filter" }), { target: { value: "ID > 1" } });
    fireEvent.submit(screen.getByRole("textbox", { name: "Filter" }));
    await settle();
    expect(sent(asked).at(-1)).toContain("\nWHERE ID > 1");
    fireEvent.contextMenu(cell(1, 0));
    await choose("Filter to This Value");
    expect(sent(asked).at(-1)).toContain(`WHERE (ID > 1) AND "NAME" = 'Ada'`);
    fireEvent.contextMenu(cell(2, 1));
    await choose("Filter Out This Value");
    expect(sent(asked).at(-1)).toContain('"DOC" IS NOT NULL');
    fireEvent.contextMenu(cell(3, 0));
    expect(screen.getByRole("menuitem", { name: "Filter to This Value" })).toHaveProperty("disabled", true);
    fireEvent.click(must(document.querySelector(".menu-backdrop")));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("has a header's menu and a cell's of the keys: sort, hide and show, copy as each format, and export the selection [DESIGN] D53", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: (t: string) => Promise.resolve(copied.push(t)) },
      configurable: true,
    });
    const { asked } = await ranResult("SELECT * FROM ANN.ITEMS", { save_text_file: () => "/tmp/selection.csv" });
    fireEvent.contextMenu(screen.getByRole("button", { name: "NAME" }));
    await choose("Sort Descending");
    expect(sent(asked).at(-1)).toContain('ORDER BY "NAME" DESC');
    fireEvent.contextMenu(screen.getByRole("button", { name: "ID" }));
    await choose("Hide Column");
    expect(document.querySelector("th")?.getAttribute("data-width")).toBe("0");
    fireEvent.contextMenu(screen.getByRole("button", { name: "ID" }));
    await choose("Show Hidden Columns");
    expect(document.querySelector("th")?.getAttribute("data-width")).not.toBe("0");
    fireEvent.contextMenu(screen.getByRole("button", { name: "ID" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy As" }));
    await choose("JSON");
    expect(copied.at(-1)).toContain('"ID"');
    fireEvent.click(cell(1, 0));
    fireEvent.keyDown(must(document.querySelector(".result-grid")), { key: "F10", shiftKey: true });
    await choose("Copy with Headers");
    expect(copied.at(-1)).toBe("NAME\r\nAda\r\n");
    fireEvent.contextMenu(cell(1, 0));
    await choose("Sort Ascending");
    fireEvent.contextMenu(cell(1, 0));
    await choose("Export Selection…");
    expect(asked.find((a) => a.command === "save_text_file")?.args["text"]).toBe("NAME\r\nAda\r\n");
    fireEvent.contextMenu(cell(2, 0));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Copy(?! with| As)/u }));
    await settle();
    expect(copied.at(-1)).toContain("{");
    fireEvent.contextMenu(cell(1, 0));
    await choose("Edit Rows");
  });

  it("keeps the rows it has when a sort fails, and tells why; runs again once the guards are answered [DESIGN] D39", async () => {
    let asks = 0;
    const { store, id, asked } = await ranResult("SELECT * FROM ANN.ITEMS", {
      run_statement: (args) => {
        asks += 1;
        if (asks === 2) {
          return refused({
            sqlcode: -103,
            sqlstate: "2A000",
            message: "no such column",
            rule: null,
            position: null,
            active: false,
            diagnostics: null,
          });
        }
        if (asks === 3 && args["confirmed"] !== true) {
          return { kind: "confirm", answer: { classes: ["read"], destroys: [], reasons: ["production"], unknown: [] } };
        }
        return { kind: "ran", answer: ranRows(asks) };
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "ID" }));
    await settle();
    expect(lastRun(store, id).rows).toHaveLength(3);
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toContain("no such column");
    fireEvent.click(screen.getByRole("button", { name: "ID" }));
    await settle();
    const dialog = store.current().dialog;
    expect(dialog?.kind).toBe("guard");
    await act(async () => {
      if (dialog?.kind === "guard") {
        dialog.answer(true);
      }
      await settle();
    });
    expect(asked.filter((a) => a.command === "run_statement").at(-1)?.args["confirmed"]).toBe(true);
    expect(lastRun(store, id).query?.sort).toEqual([{ column: 0, descending: false }]);
    fireEvent.click(screen.getByRole("button", { name: "ID ▲" }));
    await settle();
    await act(async () => {
      const again = store.current().dialog;
      if (again?.kind === "guard") {
        again.answer(false);
      }
      await settle();
    });
  });

  it("freezes columns, shows a row as a form, and tells the status bar of the cells selected [DESIGN] D39", async () => {
    const { store, id } = await ranResult();
    fireEvent.contextMenu(cell(1, 1));
    await choose("Freeze Up to This Column");
    expect(screen.getByRole("table", { name: "Result grid" }).dataset["frozen"]).toBe("2");
    expect(screen.getByText(/2 columns frozen/u)).toBeTruthy();
    fireEvent.contextMenu(cell(0, 0));
    await choose("Unfreeze Columns");
    expect(screen.getByRole("table", { name: "Result grid" }).dataset["frozen"]).toBe("0");
    fireEvent.click(cell(0, 1));
    expect(store.current().cellSummary).toBe("Count 1 of 1 · Sum 2 · Average 2 · Min 2 · Max 2");
    expect(screen.getByText("Count 1 of 1 · Sum 2 · Average 2 · Min 2 · Max 2")).toBeTruthy();
    fireEvent.contextMenu(cell(0, 1));
    await choose("Show in Record View");
    const form = screen.getByRole("table", { name: "Row 2" });
    expect(inside(form).getByText("Bob")).toBeTruthy();
    await click("Next Row");
    expect(screen.getByText("Row 3 of 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next Row" })).toHaveProperty("disabled", true);
    await click("Previous Row");
    await click("Text View");
    expect(screen.getByLabelText("Result as text").textContent).toContain(" ID | NAME");
    await click("Grid View");
    act(() => {
      changeWorksheet(store, id, (w) => ({ ...w, runs: [] }));
    });
    expect(store.current().cellSummary).toBeNull();
  });
});

describe("a result's values", () => {
  it("shows the cell selected by its viewers: JSON as a tree, XML laid out, a large object read whole [DESIGN] D39", async () => {
    const { asked } = await ranResult();
    await click("Value Viewer");
    expect(screen.getByText("Select a cell to view its value.")).toBeTruthy();
    fireEvent.click(cell(2, 0));
    await settle();
    expect(screen.getByRole("tab", { name: "JSON" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/^a:/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Text" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Wrap lines" }));
    expect(screen.getByText('{"a":[1,true,null]}', { selector: "pre" }).className).toBe("value-text");
    fireEvent.click(cell(2, 2));
    await settle();
    expect(screen.getByText(/^Not JSON:/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "XML" }));
    expect(screen.getByText("<b>x</b>", { exact: false, selector: "pre" }).textContent).toBe("<a>\n  <b>x</b>\n</a>");
    fireEvent.click(cell(3, 0));
    await settle();
    expect(screen.getByText("long text")).toBeTruthy();
    expect(asked.find((a) => a.command === "result_value")?.args).toEqual({
      connection: 1,
      result: 1,
      row: 0,
      column: 3,
    });
    fireEvent.click(cell(4, 0));
    await settle();
    expect(screen.getByRole("img", { name: "The value, as an image" }).getAttribute("src")).toBe(
      `data:image/png;base64,${PNG}`,
    );
    expect(screen.getByText("Only the first 16 MiB of the value are read.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Hex" }));
    expect(screen.getByText(/^00000000 89 50 4e 47/u)).toBeTruthy();
    fireEvent.click(cell(5, 0));
    await settle();
    expect(screen.getByText(/de ad be ef/u)).toBeTruthy();
    fireEvent.click(cell(6, 0));
    await settle();
    expect(screen.getByRole("img", { name: "1 values, 1 shapes, drawn on a plane" })).toBeTruthy();
    fireEvent.click(cell(7, 0));
    await settle();
    expect(screen.getByText(/^3 dimensions; norm 3.74166/u)).toBeTruthy();
    fireEvent.click(cell(1, 2));
    await settle();
    expect(screen.getByText("NULL", { selector: "pre" })).toBeTruthy();
  });

  it("tells why a large object could not be read, as when its transaction has ended [DESIGN] D39", async () => {
    await ranResult("SELECT * FROM ANN.ITEMS", {
      result_value: () =>
        refused({
          sqlcode: -423,
          sqlstate: "0F001",
          message: "the locator is no longer valid",
          rule: null,
          position: null,
          active: false,
          diagnostics: null,
        }),
    });
    fireEvent.contextMenu(cell(3, 0));
    await choose("View Value");
    expect(screen.getByText("The value could not be read: the locator is no longer valid")).toBeTruthy();
  });

  it("draws a result's spatial values on a plane, and its rows as a graph [DESIGN] D39", async () => {
    await ranResult();
    await click("Plane View");
    expect(screen.getByRole("img", { name: "3 values, 2 shapes, drawn on a plane" })).toBeTruthy();
    expect(screen.getByText("x 0 to 5, y 0 to 5")).toBeTruthy();
    await click("Graph View");
    expect(screen.getByRole("figure", { name: "4 nodes, 2 edges" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Label" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("combobox", { name: "To" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Read as" }), { target: { value: "paths" } });
    expect(screen.getByText("No node to draw: the columns chosen hold no values.")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Paths" }), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Read as" }), { target: { value: "pairs" } });
    fireEvent.change(screen.getByRole("combobox", { name: "From" }), { target: { value: "1" } });
    await click("Plane View");
    fireEvent.change(screen.getByRole("combobox", { name: "Column" }), { target: { value: "7" } });
    expect(screen.getByText("Nothing to draw: the values are empty.")).toBeTruthy();
  });
});

describe("a result's copies, exports, pins and comparisons", () => {
  it("copies the cells selected, or every row read, in the format chosen [DESIGN] D39", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: (t: string) => Promise.resolve(written.push(t)) },
      configurable: true,
    });
    const { store, id } = await ranResult();
    fireEvent.click(cell(1, 0));
    fireEvent.change(screen.getByRole("combobox", { name: "Copy as" }), { target: { value: "csv" } });
    await click("Copy");
    expect(written.at(-1)).toBe("NAME\r\nAda\r\n");
    fireEvent.click(screen.getByRole("checkbox", { name: "Headers" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Copy as" }), { target: { value: "insert" } });
    fireEvent.click(cell(0, 1));
    await click("Copy");
    expect(written.at(-1)).toBe('INSERT INTO "ANN"."ITEMS" ("ID") VALUES (2);\n');
    act(() => {
      changeWorksheet(store, id, (w) => ({ ...w, runs: w.runs.map((r) => ({ ...r })) }));
    });
    fireEvent.contextMenu(cell(4, 0));
    await choose("View Value");
    await click("Copy");
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe(
      "A large object is not copied as a value: view it to read it whole.",
    );
  });

  it("exports the result's query, as it is sorted and filtered, to a file the dialog chooses [DESIGN] D39", async () => {
    let answer: unknown = { path: "/tmp/items.csv", rows: 3 };
    const { store, id, asked } = await ranResult("SELECT * FROM ANN.ITEMS", { export_query: () => answer });
    await click("Export as CSV…");
    expect(asked.find((a) => a.command === "export_query")?.args).toEqual({
      request: { connection: 1, sql: "SELECT * FROM ANN.ITEMS", kind: "csv", name: "Untitled" },
    });
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe("Exported 3 rows to /tmp/items.csv.");
    answer = null;
    await click("Export as Native Rows…");
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe("Exported 3 rows to /tmp/items.csv.");
    answer = refused({
      sqlcode: -910,
      sqlstate: "TB910",
      message: "an export runs a query, which reads alone",
      rule: null,
      position: null,
      active: false,
      diagnostics: null,
    });
    await click("Export as CSV…");
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toContain("an export runs a query");
    expect(worksheetOf(store.current(), id)?.pane).toBe("messages");
    fireEvent.click(screen.getByRole("tab", { name: "Results" }));
    act(() => {
      changeWorksheet(store, id, (w) => ({ ...w, runs: w.runs.map((r) => ({ ...r, values: ["1"] })) }));
    });
    await click("Export as CSV…");
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe(
      "A statement of parameters is not exported: write its values in it.",
    );
  });

  it("keeps a pinned result open as the worksheet runs again, closed by its tab; compares two results [DESIGN] D39", async () => {
    const { store, id, asked } = await ranResult();
    await click("Pin Result");
    expect(lastRun(store, id).pinned).toBe(true);
    await act(() => runStatements(store, id, [{ sql: "SELECT * FROM ANN.ITEMS", from: 0, to: 23 }]));
    await settle();
    const runs = worksheetOf(store.current(), id)?.runs ?? [];
    expect(runs.map((r) => [r.id, r.pinned])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(asked.some((a) => a.command === "close_result" && a.args["result"] === 1)).toBe(false);
    fireEvent.change(screen.getByRole("combobox", { name: "Compare with" }), { target: { value: "1" } });
    expect(screen.getByText(/^3 rows in both, 0 only in this result, 0 only in the other\./u)).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Compare with" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("tab", { name: /Result 1/u }));
    await click("Unpin Result");
    await click("Pin Result");
    await click("Close Result 1");
    expect(worksheetOf(store.current(), id)?.runs.map((r) => r.id)).toEqual([2]);
    expect(asked.some((a) => a.command === "close_result" && a.args["result"] === 1)).toBe(true);
  });

  it("times each run, and compares it with the run of the statement before [DESIGN] D39", async () => {
    const { store, id } = await ranResult();
    await act(() => runStatements(store, id, [{ sql: "SELECT * FROM ANN.ITEMS", from: 0, to: 23 }]));
    fireEvent.click(screen.getByRole("tab", { name: "Timings" }));
    const table = screen.getByRole("table", { name: "Timings" });
    expect(inside(table).getAllByText("1.5")).toHaveLength(2);
    expect(inside(table).getByText("the same")).toBeTruthy();
    await click("Clear Timings");
    expect(screen.getByText("No run yet: each statement run is timed here.")).toBeTruthy();
  });
});
