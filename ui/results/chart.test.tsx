import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { Chart } from "../ipc/analyzer";
import type { ColumnInfo, Ran } from "../ipc/connections";
import { runStatements } from "../state/running";
import { changeWorksheet, openWorksheet } from "../state/worksheets";
import { SESSION } from "../test/backend";
import { catalogBackend, must, opened, settle, within } from "../test/catalog";
import { ChartView } from "./ChartView";
import { Panes } from "../worksheet/Panes";
import { chartData, compact, defaultChart, MAX_CHART_ROWS, ticks } from "./chart";

/** A column of `name` and `type`. */
function column(name: string | null, typeWritten: string): ColumnInfo {
  return { name, typeWritten, typeName: null, notNull: false };
}

const COLUMNS = [
  column("KIND", "VARCHAR(10)"),
  column("READS", "BIGINT"),
  column("WRITES", "DECIMAL(10,2)"),
  column(null, "REAL"),
];

describe("a chart of a result", () => {
  it("names its rows by the first column not of numbers, and draws the others of numbers [DESIGN] D52", () => {
    expect(defaultChart(COLUMNS)).toEqual({ kind: "bar", label: "KIND", values: ["READS", "WRITES", "(4)"] });
    expect(defaultChart([column("N", "INTEGER")])).toBeNull();
    expect(defaultChart([column("N", "INTEGER"), column("M", "double precision")])).toEqual({
      kind: "bar",
      label: "N",
      values: ["M"],
    });
  });

  it("reads the rows' numbers, none where a cell is not one, and says why it cannot draw [DESIGN] D52", () => {
    const chart: Chart = { kind: "bar", label: "KIND", values: ["READS", "WRITES"] };
    const data = chartData(
      COLUMNS,
      [
        ["LOG", "5", "-2.5", null],
        [null, null, "x", null],
      ],
      chart,
    );
    expect(data).toEqual({
      labels: ["LOG", "NULL"],
      series: [
        { name: "READS", values: [5, null] },
        { name: "WRITES", values: [-2.5, null] },
      ],
      low: -2.5,
      high: 5,
    });
    expect(chartData(COLUMNS, [], { ...chart, label: "NO" })).toBe("The result has no column NO.");
    expect(chartData(COLUMNS, [], { ...chart, values: ["NO"] })).toBe("The result has no column NO.");
    expect(chartData(COLUMNS, [["A", null, null, null]], chart)).toBe("No row holds a number of the columns chosen.");
  });

  it("scales by round ticks, written compactly [DESIGN] D52", () => {
    expect(ticks(0, 100)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(ticks(-3, 7)).toEqual([-4, -2, 0, 2, 4, 6, 8]);
    expect(ticks(0, 0.3)).toEqual([0, 0.1, 0.2, 0.3]);
    expect(ticks(5, 5)).toEqual([5]);
    expect(ticks(0, 9000)).toEqual([0, 2000, 4000, 6000, 8000, 10000]);
    expect([compact(950), compact(1234), compact(-3400000), compact(5.6e9), compact(0.125)]).toEqual([
      "950",
      "1.23K",
      "-3.4M",
      "5.6B",
      "0.125",
    ]);
  });
});

/** What the report's query gives: `rows` of `columns`. */
function ranRows(columns: readonly ColumnInfo[], rows: string[][]): Ran {
  return {
    outcome: {
      kind: "rows",
      result: 7,
      columns,
      page: { from: 0, rows, rowsRead: rows.length, complete: true, lobs: [] },
    },
    warnings: [],
    serverTime: null,
    session: SESSION,
  };
}

/** A worksheet of a result of `rows` shown, its chart `chart`: the store. */
async function charted(rows: string[][], chart: Chart | null) {
  catalogBackend({ run_statement: () => ({ kind: "ran", answer: ranRows(COLUMNS, rows) }) });
  const store = await opened();
  const id = openWorksheet(store, "SELECT * FROM FILES");
  changeWorksheet(store, id, (w) => ({ ...w, chart }));
  await runStatements(store, id, [{ sql: "SELECT * FROM FILES", from: 0, to: 19 }]);
  within(store, <Panes id={id} />);
  await settle();
  return store;
}

describe("the chart view", () => {
  it("shows a report's chart first, as lines, a legend of its series, and changes as chosen [DESIGN] D52", async () => {
    const store = await charted(
      [
        ["LOG", "21", "9086", "1"],
        ["DATA", "2", "0", "0"],
      ],
      { kind: "line", label: "KIND", values: ["READS", "WRITES"] },
    );
    expect(screen.getByRole("img", { name: "Chart" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Legend" }).textContent).toBe("READSWRITES");
    expect(document.querySelectorAll("circle")).toHaveLength(4);
    expect(document.querySelector("circle title")?.textContent).toBe("LOG · READS: 21");
    fireEvent.change(screen.getByRole("combobox", { name: "Chart kind" }), { target: { value: "bar" } });
    expect(document.querySelectorAll("path title")).toHaveLength(4);
    fireEvent.click(screen.getByRole("checkbox", { name: "WRITES" }));
    expect(screen.queryByRole("list", { name: "Legend" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "(4)" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Rows named by" }), { target: { value: "READS" } });
    expect(screen.getAllByText("21").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Save as Report…" }));
    expect(store.current().dialog).toEqual({
      kind: "report",
      sql: "SELECT * FROM FILES",
      chart: { kind: "bar", label: "READS", values: ["READS", "(4)"] },
    });
  });

  it("is offered of a result of numbers, says what it cannot draw, and draws the first rows alone [DESIGN] D52", async () => {
    const many = Array.from({ length: MAX_CHART_ROWS + 1 }, (_, i) => [`K${String(i)}`, String(i), "0", "0"]);
    const store = await charted(many, null);
    fireEvent.click(screen.getByRole("button", { name: "Save as Report…" }));
    expect(store.current().dialog).toMatchObject({ kind: "report", chart: null });
    fireEvent.click(screen.getByRole("button", { name: "Chart View" }));
    expect(screen.getByText(/The first 200 rows are drawn/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "READS" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "WRITES" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "(4)" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "(4)" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Chart kind" }), { target: { value: "line" } });
    expect(document.querySelectorAll("circle")[0]?.getAttribute("r")).toBe("2");
    cleanup();
    await charted([["A", "x", "y", "z"]], { kind: "bar", label: "KIND", values: ["READS"] });
    expect(screen.getByText("No row holds a number of the columns chosen.")).toBeTruthy();
  });

  it("draws a negative value down from the baseline, skips a row of none, and shortens a long label [DESIGN] D52", async () => {
    const store = await charted(
      [
        ["A KIND OF LONG NAME", "-5", "1", "1"],
        ["B", "x", "2", "2"],
        ["C", "3", "3", "3"],
      ],
      { kind: "line", label: "KIND", values: ["READS"] },
    );
    expect(screen.getByText("A KIND OF L…")).toBeTruthy();
    expect(document.querySelectorAll("circle")).toHaveLength(2);
    fireEvent.change(screen.getByRole("combobox", { name: "Chart kind" }), { target: { value: "bar" } });
    expect(document.querySelectorAll("path title")).toHaveLength(2);
    const run = must(store.current().worksheets.at(-1)?.runs.at(-1));
    cleanup();
    within(store, <ChartView run={run} chart={null} onChart={() => undefined} />);
    expect(screen.getByText("No column of the result holds numbers to draw.")).toBeTruthy();
  });
});
