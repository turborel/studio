import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { namer } from "../data/ddl";
import type { Analysis, Report } from "../ipc/analyzer";
import type { Ran, SessionState } from "../ipc/connections";
import type { TableDetail } from "../ipc/catalog";
import type { Piece } from "../ipc/worksheet";
import { changeWorksheet, openWorksheet, worksheetOf } from "../state/worksheets";
import { SESSION } from "../test/backend";
import { catalogBackend, must, opened, refused, settle, STAFF, within } from "../test/catalog";
import { parsePlan } from "../plan/plan";
import { AnalyzerDialog, ofTable } from "./AnalyzerDialog";
import { WhatIfDialog } from "./PlanFindings";
import { PlanViewer } from "../plan/PlanViewer";
import { comparedColumn, conjuncts, scanFindings, scannedTables } from "./planRules";
import { openReport, Reports, SaveReportDialog } from "./Reports";
import { runWhatIf, type WhatIf } from "./whatIf";

/** EXPLAIN's plan of a query of PARTS by NAME, read whole (Turborel's `sql/statements/explain.md`). */
const SCANNED = parsePlan([
  "-- bound:",
  "Project PARTS.ID",
  "  Filter PARTS.NAME = 'part 7'",
  "    Scan ANN.PARTS",
  "-- physical:",
  "Project PARTS.ID",
  "  Filter PARTS.NAME = 'part 7' AND PARTS.ID > 3 AND PARTS.ID = PARTS.NAME  (est. rows=10)",
  "    SeqScan ANN.PARTS  (rows=1000, cost=1000.0)",
]);

/** PARTS, of ID and NAME, its key's index alone. */
const PARTS: TableDetail = {
  ...STAFF,
  name: "PARTS",
  columns: [
    { ...must(STAFF.columns[0]), name: "ID" },
    { ...must(STAFF.columns[0]), name: "NAME" },
  ],
  indexes: [{ name: "ANN.PARTS.UNIQUE1", method: "btree", unique: true, columns: ["ID"], implied: true, options: [] }],
};

const NAME = namer(["SELECT"]);

describe("the plan's rule, SCAN-NO-INDEX", () => {
  it("splits a filter at each AND outside parentheses and strings [DESIGN] D50", () => {
    expect(conjuncts("A.X = 1 AND (A.Y = 2 AND A.Z = 3) AND A.W = ' AND '")).toEqual([
      "A.X = 1",
      "(A.Y = 2 AND A.Z = 3)",
      "A.W = ' AND '",
    ]);
  });

  it("takes a column compared with a constant as an index answers it [DOC sql/statements/create-index.md DESCRIPTION]", () => {
    expect(comparedColumn("PARTS.NAME = 'part 7'")).toBe("NAME");
    expect(comparedColumn('P."lower" BETWEEN 1 AND 2')).toBe("lower");
    expect(comparedColumn("P.NAME LIKE 'pa%'")).toBe("NAME");
    expect(comparedColumn("P.NAME LIKE '%pa'")).toBeNull();
    expect(comparedColumn("P.ID = Q.ID")).toBeNull();
    expect(comparedColumn("P.ID = 'Q.ID'")).toBe("ID");
    expect(comparedColumn("P.ID <> 3")).toBeNull();
    expect(comparedColumn("UPPER(P.NAME) = 'X'")).toBeNull();
  });

  it("finds a column of a table read whole with no index leading it, each once, its index named anew [DESIGN] D50", () => {
    expect(scannedTables(SCANNED)).toEqual([{ schema: "ANN", table: "PARTS", columns: ["NAME", "ID"] }]);
    const taken = {
      ...PARTS,
      indexes: [...PARTS.indexes, { ...must(PARTS.indexes[0]), name: "PARTS_NAME_INDEX", method: "rtree" }],
    };
    const [found, ...more] = scanFindings(SCANNED, [taken], NAME);
    expect(more).toEqual([]);
    expect(found?.create).toBe("CREATE INDEX PARTS_NAME_INDEX2 ON ANN.PARTS (NAME)");
    expect(found?.drop).toBe("DROP INDEX PARTS_NAME_INDEX2");
    expect(found?.says).toContain("reads ANN.PARTS whole");
    const hashed = {
      ...PARTS,
      indexes: [...PARTS.indexes, { ...must(PARTS.indexes[0]), name: "H", method: "HASH", columns: ["NAME"] }],
    };
    expect(scanFindings(SCANNED, [hashed], NAME)).toEqual([]);
    expect(scanFindings(SCANNED, [], NAME)).toEqual([]);
    expect(scanFindings(parsePlan(["-- bound:", "Scan ANN.PARTS"]), [PARTS], NAME)).toEqual([]);
    expect(scannedTables(parsePlan(["-- bound:", "Filter X.A = 1", "  SeqScan ANN.PARTS"]))).toEqual([]);
    const odd = parsePlan([
      "-- physical:",
      "Filter X.A = 1",
      "  SeqScan PARTS",
      "Filter X.A = X.B",
      "  SeqScan ANN.PARTS",
    ]);
    expect(scannedTables(odd)).toEqual([]);
  });
});

/** What a statement gave: no rows, or `rows` of one column. */
function ran(rows: string[][] | null, session: SessionState = SESSION): Ran {
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
    session,
  };
}

/** The plan EXPLAIN gives with the index. */
const INDEXED = [
  "-- physical:",
  "Project PARTS.ID",
  "  IndexScan ANN.PARTS using PARTS_NAME_INDEX [btree]: PARTS.NAME = 'part 7'",
];

/** A worksheet on connection 1, of the backend whose run of `CREATE` fails if `failing`: the store, the worksheet and what was asked. */
async function sheet(failing = false, session: SessionState = SESSION) {
  const asked = catalogBackend({
    catalog_table: () => PARTS,
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
      } satisfies Piece | object,
    ],
    run_statement: (args) => {
      const sql = String(args["sql"]);
      if (failing && sql.startsWith("CREATE")) {
        return refused({
          sqlcode: -917,
          sqlstate: "25000",
          message: "outside a transaction",
          rule: null,
          position: null,
          diagnostics: null,
        });
      }
      return { kind: "ran", answer: ran(sql.startsWith("EXPLAIN") ? INDEXED.map((l) => [l]) : null, session) };
    },
    session_state: () => session,
  });
  const store = await opened();
  store.update((now) => ({
    ...now,
    reservedWords: ["SELECT"],
    open: now.open.map((c) => ({ ...c, session })),
  }));
  const id = openWorksheet(store, "SELECT ID FROM ANN.PARTS WHERE NAME = 'part 7'");
  const statement = { sql: "SELECT ID FROM ANN.PARTS WHERE NAME = 'part 7'", from: 0, to: 46 };
  changeWorksheet(store, id, (w) => ({ ...w, plans: [SCANNED], explained: statement, pane: "plan" }));
  const whatIf: WhatIf = {
    worksheet: id,
    statement,
    index: "PARTS_NAME_INDEX",
    create: "CREATE INDEX PARTS_NAME_INDEX ON ANN.PARTS (NAME)",
    drop: "DROP INDEX PARTS_NAME_INDEX",
  };
  return {
    asked,
    store,
    id,
    whatIf,
    sent: () => asked.filter((a) => a.command === "run_statement").map((a) => a.args["sql"]),
  };
}

describe("a what-if index", () => {
  it("is made, the statement explained, the index dropped, and the plans compared [DESIGN] D51", async () => {
    const { store, id, whatIf, sent } = await sheet(false, {
      ...SESSION,
      transaction: { ...SESSION.transaction, autocommit: true },
    });
    within(store, <PlanViewer id={id} plans={[SCANNED]} />);
    await settle();
    expect(screen.getByRole("list", { name: "Warnings" }).textContent).toContain("SCAN-NO-INDEX");
    fireEvent.click(screen.getByRole("button", { name: "What If…" }));
    expect(store.current().dialog?.kind).toBe("whatIf");
    await act(() => runWhatIf(store, whatIf));
    expect(sent()).toEqual([
      "CREATE INDEX PARTS_NAME_INDEX ON ANN.PARTS (NAME)",
      "EXPLAIN SELECT ID FROM ANN.PARTS WHERE NAME = 'part 7'",
      "DROP INDEX PARTS_NAME_INDEX",
    ]);
    const w = must(worksheetOf(store.current(), id));
    expect(w.whatIf).toBe("PARTS_NAME_INDEX");
    expect(w.plans).toHaveLength(2);
  });

  it("rolls back EXPLAIN's transaction not under autocommit, and runs nothing more if the index is not made [DESIGN] D51", async () => {
    const manual = { ...SESSION, transaction: { ...SESSION.transaction, autocommit: false } };
    const kept = await sheet(false, manual);
    await act(() => runWhatIf(kept.store, kept.whatIf));
    expect(kept.sent()).toContain("ROLLBACK");
    expect(kept.sent().at(-1)).toBe("DROP INDEX PARTS_NAME_INDEX");
    const failing = await sheet(true);
    await act(() => runWhatIf(failing.store, failing.whatIf));
    expect(failing.sent()).toEqual(["CREATE INDEX PARTS_NAME_INDEX ON ANN.PARTS (NAME)"]);
    expect(worksheetOf(failing.store.current(), failing.id)?.whatIf).toBeNull();
  });

  it("is asked first, saying the index is made for real, and opens its fix [DESIGN] D51", async () => {
    const { store, id, whatIf } = await sheet();
    within(store, <WhatIfDialog whatIf={whatIf} />);
    expect(screen.getByText(/other sessions see it/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(store.current().dialog).toBeNull();
    cleanup();
    within(store, <PlanViewer id={id} plans={[SCANNED]} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Open Fix in Worksheet" }));
    expect(store.current().worksheets.at(-1)?.text).toBe("CREATE INDEX PARTS_NAME_INDEX ON ANN.PARTS (NAME);");
  });
});

/** An analysis of one finding of each kind of fix. */
const ANALYSIS: Analysis = {
  indexes: [
    {
      table: "STAFF",
      index: { ...must(PARTS.indexes[0]), options: [["FILL", "50"]] },
      serves: "STAFF_PRIMARY1",
      counted: { name: "STAFF_PRIMARY1", method: "btree", entries: "960", distinctKeys: "240" },
    },
  ],
  findings: [
    {
      rule: "FK-NO-INDEX",
      object: "ANN.STAFF STAFF_DEPT",
      says: "No index leads DEPT.",
      fix: "CREATE INDEX X ON ANN.STAFF (DEPT);",
    },
    { rule: "INDEX-DUPLICATE", object: "Y", says: "Y is X's.", fix: "DROP INDEX Y;" },
  ],
  settings: [
    {
      name: "SERVER.TRUST_LOCAL",
      value: "ON",
      source: "DATABASE",
      default: "OFF",
      takesEffect: "START",
      description: "trust",
    },
  ],
};

describe("the analyzer of a schema", () => {
  it("of a table alone keeps its findings and those of its indexes, and its indexes [DESIGN] D50", () => {
    const of = ofTable(
      {
        ...ANALYSIS,
        findings: [
          ...ANALYSIS.findings,
          { rule: "INDEX-DUPLICATE", object: '"ANN.PARTS.UNIQUE1"', says: "", fix: "" },
          { rule: "TABLE-NO-KEY", object: "ANN.OTHER", says: "", fix: "" },
        ],
      },
      "STAFF",
      (n) => (n.includes(".") ? `"${n}"` : n),
    );
    expect(of.findings.map((f) => f.object)).toEqual(["ANN.STAFF STAFF_DEPT", '"ANN.PARTS.UNIQUE1"']);
    expect(of.indexes).toHaveLength(1);
    expect(ofTable(ANALYSIS, undefined, (n) => n)).toBe(ANALYSIS);
  });

  it("shows its findings, indexes, settings and what waits on the server, and opens the fixes chosen [DESIGN] D50", async () => {
    catalogBackend({ catalog_analysis: () => ANALYSIS });
    const store = await opened();
    within(store, <AnalyzerDialog connection={1} schema="ANN" />);
    await settle();
    expect(screen.getByText("No index leads DEPT.")).toBeTruthy();
    fireEvent.click(must(screen.getAllByRole("checkbox")[1]));
    fireEvent.click(must(screen.getAllByRole("checkbox")[1]));
    fireEvent.click(must(screen.getAllByRole("checkbox")[0]));
    fireEvent.click(screen.getByRole("button", { name: "Open Fixes in Worksheet" }));
    await settle();
    expect(store.current().worksheets.at(-1)?.text).toBe("DROP INDEX Y;");
    cleanup();
    within(store, <AnalyzerDialog connection={1} schema="ANN" />);
    await settle();
    fireEvent.click(screen.getByRole("tab", { name: "Indexes" }));
    expect(screen.getByText("STAFF_PRIMARY1")).toBeTruthy();
    expect(screen.getByText("FILL = 50")).toBeTruthy();
    expect(screen.getByText("1 in 240 (0.42%), about 4 entries a key")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByText("SERVER.TRUST_LOCAL")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(store.current().dialog).toBeNull();
  });

  it("says when nothing is found, and why it could not read the schema [DESIGN] D50", async () => {
    catalogBackend({ catalog_analysis: () => ({ indexes: [], findings: [], settings: [] }) });
    const store = await opened();
    within(store, <AnalyzerDialog connection={1} schema="ANN" />);
    expect(screen.getByText("Reading the schema…")).toBeTruthy();
    await settle();
    expect(screen.getByText("No rule finds anything to change.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Indexes" }));
    expect(screen.getByText("No table of the schema has an index.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByText("Every setting has its default.")).toBeTruthy();
    catalogBackend({ catalog_analysis: () => refused({ message: "no such schema" }) });
    cleanup();
    within(store, <AnalyzerDialog connection={1} schema="NONE" />);
    await settle();
    expect(screen.getByText("no such schema")).toBeTruthy();
  });
});

/** A report of the user's, charted. */
const MINE: Report = {
  id: "r1",
  name: "Mine",
  sql: "SELECT KIND, COUNT(*) AS N FROM T GROUP BY KIND",
  chart: { kind: "line", label: "KIND", values: ["N"] },
};

describe("reports", () => {
  it("are listed, the built-in then the user's, each opened and run in a worksheet of its chart, and forgotten [DESIGN] D52", async () => {
    const asked = catalogBackend({
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
      run_statement: () => ({ kind: "ran", answer: ran([["A"]]) }),
      forget_report: () => [],
    });
    const store = await opened();
    const builtIn: Report = { id: "built-in:files", name: "Files", sql: "SELECT 1", chart: null };
    store.update((now) => ({ ...now, reports: { builtIn: [builtIn], own: [MINE] } }));
    within(store, <Reports />);
    fireEvent.click(screen.getByRole("button", { name: "Mine" }));
    await settle();
    const w = store.current().worksheets.at(-1);
    expect(w?.title).toBe("Mine");
    expect(w?.chart).toEqual(MINE.chart);
    expect(asked.some((a) => a.command === "run_statement" && a.args["sql"] === MINE.sql)).toBe(true);
    expect(screen.queryByRole("button", { name: "Forget Files" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Forget Mine" }));
    await settle();
    expect(store.current().reports.own).toEqual([]);
    expect(screen.getByText(/None of your own yet/u)).toBeTruthy();
    await act(() => openReport(store, builtIn));
    expect(store.current().worksheets.at(-1)?.chart).toBeNull();
  });

  it("keep a result's query by a name, with its chart or as a table [DESIGN] D52", async () => {
    const asked = catalogBackend({ keep_report: (args) => [args["report"]] });
    const store = await opened();
    within(store, <SaveReportDialog sql={MINE.sql} chart={MINE.chart} />);
    expect(screen.getByText("Its rows are shown as a line chart of N by KIND.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: " Kinds " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await settle();
    const kept = asked.find((a) => a.command === "keep_report")?.args["report"] as Report;
    expect([kept.name, kept.sql, kept.chart]).toEqual(["Kinds", MINE.sql, MINE.chart]);
    expect(store.current().reports.own).toHaveLength(1);
    cleanup();
    within(store, <SaveReportDialog sql="SELECT 1" chart={null} />);
    expect(screen.getByText("Its rows are shown as a table.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    catalogBackend({
      keep_report: () =>
        refused({ sqlcode: -910, sqlstate: "TS910", message: "full", rule: null, position: null, diagnostics: null }),
    });
    cleanup();
    within(store, <SaveReportDialog sql="SELECT 1" chart={null} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await settle();
    expect(store.current().error?.message).toBe("full");
  });
});
