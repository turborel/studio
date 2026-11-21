import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ColumnInfo } from "../ipc/connections";
import type { Store } from "../state/store";
import { changeWorksheet, openWorksheet, type RunResult, type Timing, worksheetOf } from "../state/worksheets";
import { SESSION } from "../test/backend";
import { catalogBackend, opened, refused, settle, within } from "../test/catalog";
import { closeRun, copyCells, exportResult, pinResult, requery, requeryable, showSummary } from "./actions";
import { CompareView, PlaneOfResult, RecordView, spatialColumns } from "./ResultParts";
import { viewedAt } from "./ResultView";
import { Timings } from "./Timings";
import { ValueViewer } from "./viewers/ValueViewer";

/** A column. */
function col(name: string | null, typeWritten = "VARCHAR(30)"): ColumnInfo {
  return { name, typeWritten, typeName: null, notNull: false };
}

/** A run of `rows`, its result 4. */
function run(rows: (string | null)[][], extra: Partial<RunResult> = {}): RunResult {
  return {
    id: 1,
    sql: "SELECT * FROM T",
    from: 0,
    to: 15,
    connection: 1,
    started: 0,
    millis: null,
    outcome: {
      kind: "rows",
      result: 4,
      columns: [col("A")],
      page: { from: 0, rows, rowsRead: rows.length, complete: true, lobs: [] },
    },
    columns: [col("A"), col(null, "INTEGER")],
    rows,
    complete: true,
    warnings: [],
    error: null,
    serverTime: null,
    plan: null,
    values: [],
    lobs: [],
    pinned: false,
    query: null,
    editing: null,
    ...extra,
  };
}

/** A worksheet of the run given: the store and the worksheet. */
async function holding(r: RunResult): Promise<{ store: Store; id: string }> {
  const store = await opened();
  const id = openWorksheet(store, r.sql);
  changeWorksheet(store, id, (w) => ({ ...w, runs: [r] }));
  return { store, id };
}

describe("the results' actions at their edges", () => {
  it("leave a run alone that is gone, running, or no query's, and say what the status bar has [DESIGN] D39", async () => {
    const asked = catalogBackend({ session_state: () => ({ ...SESSION, authorization: "BOB" }) });
    const { store, id } = await holding(run([["x", "1"]], { sql: "CALL P()" }));
    expect(requeryable(run([]))).toBe(true);
    expect(
      requeryable(
        run([], {
          plan: { stages: [], counted: [], rules: [], ran: null, ranMillis: null, joinOrder: null, lines: [] },
        }),
      ),
    ).toBe(false);
    expect(requeryable(run([], { outcome: null }))).toBe(false);
    await requery(store, id, 1, (q) => q);
    await requery(store, id, 9, (q) => q);
    changeWorksheet(store, id, (w) => ({ ...w, runs: [run([])], running: true }));
    await requery(store, id, 1, (q) => q);
    await requery(store, "nope", 1, (q) => q);
    changeWorksheet(store, id, (w) => ({ ...w, running: false }));
    await copyCells(store, id, 9, { format: "csv", headers: true }, { rows: [], columns: [] });
    await exportResult(store, id, 9, "csv");
    await closeRun(store, id, 9);
    pinResult(store, id, 9, true);
    expect(asked.filter((a) => a.command === "run_statement" || a.command === "export_query")).toEqual([]);
    showSummary(store, "x");
    showSummary(store, "x");
    expect(store.current().cellSummary).toBe("x");
    changeWorksheet(store, id, (w) => ({
      ...w,
      runs: [run([], { outcome: { kind: "done", sqlcode: 0, sqlstate: "00000", rowsAffected: 1, generated: [] } })],
    }));
    await closeRun(store, id, 1);
    expect(worksheetOf(store.current(), id)?.runs).toEqual([]);
    changeWorksheet(store, id, (w) => ({ ...w, runs: [run([])] }));
    await closeRun(store, id, 1);
    expect(store.current().open[0]?.session.authorization).toBe("BOB");
  });

  it("keep the rows when the query run again gives none, and copy none of a cell past the result [DESIGN] D39", async () => {
    catalogBackend({
      run_statement: () => ({
        kind: "ran",
        answer: {
          outcome: { kind: "done", sqlcode: 0, sqlstate: "00000", rowsAffected: null, generated: [] },
          warnings: [],
          serverTime: null,
          session: { authorization: "ANN" },
        },
      }),
    });
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: (t: string) => Promise.resolve(written.push(t)) },
      configurable: true,
    });
    const { store, id } = await holding(run([["x", "1"]]));
    await requery(store, id, 1, (q) => ({ ...q, filter: "A = 'x'" }));
    expect(worksheetOf(store.current(), id)?.runs[0]?.query).toBeNull();
    await copyCells(store, id, 1, { format: "tsv", headers: false }, { rows: [0, 7], columns: [1, 9] });
    expect(written).toEqual(["1\r\n"]);
    catalogBackend({ export_query: () => refused(new Error("the disk is full")) });
    await exportResult(store, id, 1, "csv");
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toContain("the disk is full");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("denied")) },
      configurable: true,
    });
    await copyCells(store, id, 1, { format: "csv", headers: true }, { rows: [0], columns: [0] });
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe("denied");
  });
});

describe("the results' views at their edges", () => {
  it("shows a row of a result with more to read, a null as NULL, and no cell past the result [DESIGN] D39", () => {
    render(<RecordView run={run([["x", null]], { complete: false })} row={5} onRow={() => undefined} />);
    expect(screen.getByText("Row 1 of 1+")).toBeTruthy();
    expect(screen.getByText("NULL").className).toBe("null");
    expect(screen.getByText("(2)")).toBeTruthy();
    const r = run([["x", null]], { lobs: ["0:0"] });
    expect(viewedAt(r, [0, 0])?.locator).toEqual({ connection: 1, result: 4, row: 0, column: 0 });
    expect(viewedAt(r, [1, 0])?.locator).toBeNull();
    expect(viewedAt(r, [5, 0])).toBeNull();
    expect(viewedAt(r, [0, 3])).toBeNull();
    expect(viewedAt(run([], { outcome: null }), [0, 0])).toBeNull();
  });

  it("finds a spatial column by its values' text, and says when a result has none [DESIGN] D39", () => {
    expect(
      spatialColumns(
        run([
          [null, null],
          ["POINT (1 2)", "3"],
        ]),
      ),
    ).toEqual([0]);
    expect(spatialColumns(run([["x", "1"]]))).toEqual([]);
    render(<PlaneOfResult run={run([["x", "1"]])} row={null} />);
    expect(screen.getByText("The result has no spatial column.")).toBeTruthy();
  });

  it("compares results of other columns, of the rows read where more are to read [DESIGN] D39", () => {
    render(
      <CompareView left={run([["a", null]], { complete: false })} right={run([["b", "1"]], { columns: [col("B")] })} />,
    );
    expect(
      screen.getByText(
        "0 rows in both, 1 only in this result, 1 only in the other; the columns differ, by name or type, of the rows read.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("this")).toBeTruthy();
    expect(screen.getByText("other")).toBeTruthy();
  });

  it("tells a vector it cannot read, and a failure that is no error's [DESIGN] D39", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a failure that is no error's, as a test of one
    catalogBackend({ result_value: () => Promise.reject("lost") });
    render(<ValueViewer viewed={{ cell: "[1, x]", column: col("V", "VECTOR(2)"), locator: null }} />);
    expect(screen.getByText("Not a vector Studio reads.")).toBeTruthy();
    render(
      <ValueViewer
        viewed={{ cell: "x", column: col("B", "CLOB(1M)"), locator: { connection: 1, result: 4, row: 0, column: 0 } }}
      />,
    );
    expect(screen.getByText("Reading the value…")).toBeTruthy();
    await settle();
    expect(screen.getByText("The value could not be read: lost")).toBeTruthy();
    render(<ValueViewer viewed={{ cell: "ZZ", column: col("B", "VARBINARY(1)"), locator: null }} />);
    expect(screen.getAllByText("ZZ").length).toBeGreaterThan(0);
  });

  it("times a failed run, one of no rows, and a long statement cut short [DESIGN] D39", async () => {
    catalogBackend();
    const { store, id } = await holding(run([]));
    const long = `SELECT ${"X, ".repeat(40)}1\nFROM T`;
    const timings: Timing[] = [
      { sql: long, connection: 1, at: 1, millis: 4, serverMicros: null, rows: null, failed: true },
      { sql: "COMMIT", connection: 7, at: 2, millis: 1, serverMicros: 900, rows: 0, failed: false },
    ];
    act(() => {
      changeWorksheet(store, id, (w) => ({ ...w, timings }));
    });
    within(store, <Timings id={id} />);
    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("0.9")).toBeTruthy();
    expect(screen.getByTitle((t) => t.startsWith("SELECT X")).textContent).toHaveLength(80);
    fireEvent.click(screen.getByRole("button", { name: "Clear Timings" }));
  });
});
