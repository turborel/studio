import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SESSION } from "../test/backend";
import type { ViewRows } from "../ipc/admin";
import { Waits, waitsOf } from "../admin/Waits";
import { catalogBackend, opened, refused, settle, within } from "../test/catalog";
import { MAX_STATEMENTS, TopStatements, Usage } from "./Usage";

afterEach(cleanup);

/** STATEMENT_STATISTICS's rows: a query, a change, and another user's hidden text. */
const STATEMENTS: ViewRows = {
  columns: [
    "STATEMENT_TEXT",
    "USER_NAME",
    "CALLS",
    "TOTAL_MICROS",
    "MEAN_MICROS",
    "MAX_MICROS",
    "ROW_COUNT",
    "ROWS_READ",
    "BYTES_SPILLED",
    "LAST_RUN",
    "STATEMENT_ID",
  ],
  rows: [
    ["SELECT K FROM T", "ANN", "3", "900", "300", "500", "3", "6", "0", "2026-11-21 10:00:00", "a1"],
    ["INSERT INTO T VALUES (?)", "ANN", "2", "100", "50", "60", "2", "0", "0", "2026-11-21 10:00:00", "b2"],
    [null, "BOB", "1", "10", "10", "10", "0", "0", "0", "2026-11-21 10:00:00", "c3"],
  ],
  absent: false,
};

/** INDEX_STATISTICS's rows: one searched, one not, and another schema's. */
const INDEXES: ViewRows = {
  columns: [
    "TABLE_SCHEMA",
    "TABLE_NAME",
    "INDEX_NAME",
    "METHOD_NAME",
    "SEARCHES",
    "ENTRIES_READ",
    "ENTRY_COUNT",
    "HEIGHT",
    "BYTES",
  ],
  rows: [
    ["ANN", "T", "T_K", "btree", "4", "9", "8", "1", "8192"],
    ["ANN", "T", "T_IDLE", "btree", "0", "0", "8", "1", "8192"],
    ["BOB", "U", "U_K", "btree", "0", "0", "1", "1", "4096"],
  ],
  absent: false,
};

/** TABLE_STATISTICS's rows. */
const TABLES: ViewRows = {
  columns: [
    "TABLE_SCHEMA",
    "TABLE_NAME",
    "ENGINE_NAME",
    "ROW_COUNT",
    "BYTES",
    "BYTES_ESTIMATED",
    "LAST_CHANGED",
    "LAST_COMPACTED",
  ],
  rows: [["ANN", "T", "rowstore", "8", "16384", "YES", "2026-11-21 10:00:00", null]],
  absent: false,
};

describe("the analyzer's statistics", () => {
  it("lists the costliest statements, each query's plan a click away [DESIGN] D57", async () => {
    const asked = catalogBackend({
      admin_view: () => STATEMENTS,
      split_script: (args) => [
        {
          from: 0,
          to: String(args["text"]).length,
          statement: {
            text: args["text"],
            class: "read",
            destroys: null,
            floor: null,
            readWrite: false,
            connects: false,
          },
        },
      ],
      run_statement: () => ({
        kind: "ran",
        answer: {
          outcome: { kind: "done", sqlcode: 0, sqlstate: "00000", rowsAffected: null, generated: [] },
          warnings: [],
          serverTime: null,
          session: SESSION,
        },
      }),
    });
    const store = await opened();
    within(store, <TopStatements connection={1} />);
    expect(screen.getByText("Reading…")).toBeTruthy();
    await settle();
    const table = screen.getByRole("table", { name: "Top statements by total time" });
    expect(table.textContent).toContain("SELECT K FROM T");
    expect(screen.getAllByRole("button", { name: "Explain" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Explain" }));
    await settle();
    expect(store.current().worksheets.some((w) => w.title === "Plan of a statement")).toBe(true);
    expect(asked.some((a) => a.command === "run_statement" && a.args["sql"] === "EXPLAIN SELECT K FROM T")).toBe(true);
    expect(MAX_STATEMENTS).toBeGreaterThan(2);
  });

  it("shows a schema's unused indexes with their caveat, and its sizes [DESIGN] D57", async () => {
    catalogBackend({ admin_view: (args) => (args["view"] === "indexStatistics" ? INDEXES : TABLES) });
    const store = await opened();
    within(store, <Usage connection={1} schema="ANN" />);
    await settle();
    expect(screen.getByRole("table", { name: "Indexes unused" }).textContent).toContain("T_IDLE");
    expect(screen.getByRole("table", { name: "Indexes unused" }).textContent).not.toContain("U_K");
    expect(screen.getByText(/judge one of a whole workload/u)).toBeTruthy();
    expect(screen.getByRole("table", { name: "Table sizes" }).textContent).toContain("16384");
    expect(screen.getByRole("table", { name: "Index sizes" }).textContent).toContain("T_K");
    cleanup();
    within(store, <Usage connection={1} schema="BOB" />);
    await settle();
    expect(screen.getByRole("table", { name: "Indexes unused" }).textContent).toContain("U_K");
  });

  it("tells every index searched, and a view it cannot read [DESIGN] D57", async () => {
    catalogBackend({
      admin_view: (args) =>
        args["view"] === "indexStatistics"
          ? { ...INDEXES, rows: [INDEXES.rows[0]] }
          : args["view"] === "tableStatistics"
            ? TABLES
            : refused({ sqlcode: -551, sqlstate: "42501", message: "not yours" }),
    });
    const store = await opened();
    within(store, <Usage connection={1} schema="ANN" />);
    await settle();
    expect(screen.getByText("Every index of ANN was searched.")).toBeTruthy();
    cleanup();
    within(store, <TopStatements connection={1} />);
    await settle();
    expect(screen.getByText("not yours")).toBeTruthy();
  });
});

describe("the monitor's waits", () => {
  it("names each session that waits and its holder, which End Connection ends [DESIGN] D57", () => {
    const row = (id: string, on: string | null, lock: string | null, holder: string | null) => [
      id,
      "ANN",
      "local",
      "YES",
      "RUNNING",
      null,
      "UPDATE T SET K = 1",
      null,
      null,
      on,
      lock,
      holder,
    ];
    const sessions: ViewRows = {
      columns: [],
      rows: [
        row("1", null, null, null),
        row("2", "LOCK", "ANN.T", "1"),
        row("3", "IO", null, null),
        row("4", "WORKER", null, null),
      ],
      absent: false,
    };
    expect(waitsOf(sessions).map((w) => w.id)).toEqual(["2", "3", "4"]);
    const ended: number[] = [];
    render(<Waits sessions={sessions} end={(id) => ended.push(id)} />);
    expect(screen.getByRole("list", { name: "Waits" }).textContent).toContain(
      "Session 2 waits on a lock of ANN.T, held by session 1",
    );
    expect(screen.getByText(/Session 3 waits on the log's sync/u)).toBeTruthy();
    expect(screen.getByText(/Session 4 waits on a worker/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "End Connection 1" }));
    expect(ended).toEqual([1]);
    cleanup();
    render(<Waits sessions={{ ...sessions, rows: [row("1", null, null, null)] }} end={() => undefined} />);
    expect(screen.getByText("No session waits.")).toBeTruthy();
  });
});
