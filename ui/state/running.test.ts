import { act } from "@testing-library/react";
import { vi } from "vitest";
import type { Ran, StudioError } from "../ipc/connections";
import { SESSION } from "../test/backend";
import { catalogBackend, opened } from "../test/catalog";
import { told } from "./actions";
import { explain, failureText, fetchMore, FETCH_ROWS, runStatements, stopRun, type ToRun } from "./running";
import type { Store } from "./store";
import { changeWorksheet, openWorksheet, worksheetOf } from "./worksheets";

/** What running a statement gave: rows of `rows`, complete or not. */
function rowsRan(rows: (string | null)[][], complete = true): { kind: "ran"; answer: Ran } {
  return {
    kind: "ran",
    answer: {
      outcome: {
        kind: "rows",
        result: 3,
        columns: [{ name: "N", typeWritten: "INTEGER", typeName: "INTEGER", notNull: false }],
        page: { from: 0, rows, rowsRead: rows.length, complete, lobs: [] },
      },
      warnings: [],
      serverTime: { total: 2000, queued: 0, locks: 0 },
      session: SESSION,
    },
  };
}

/** What a change gave: its rows affected, and a warning. */
const DONE: { kind: "ran"; answer: Ran } = {
  kind: "ran",
  answer: {
    outcome: { kind: "done", sqlcode: 0, sqlstate: "00000", rowsAffected: 2, generated: [] },
    warnings: [
      { sqlcode: 1, sqlstate: "01004", message: "cut", rule: null, position: null, active: false, diagnostics: null },
    ],
    serverTime: null,
    session: SESSION,
  },
};

/** A failure at `position`. */
function failing(position: number | null): StudioError {
  return {
    sqlcode: -103,
    sqlstate: "2A000",
    message: "no such table",
    rule: null,
    position,
    active: true,
    diagnostics: null,
  };
}

/** The statement `sql`, the whole of a worksheet's text. */
function whole(sql: string): ToRun {
  return { sql, from: 0, to: sql.length };
}

/** A store with a worksheet of `text` open on connection 1: the store and the worksheet. */
async function sheet(text: string): Promise<[Store, string]> {
  const store = await opened();
  return [store, openWorksheet(store, text)];
}

/** Answers the dialog shown: the guards' with `run`, the values' with `given`. */
function answer(
  store: Store,
  run: boolean,
  given: Parameters<
    Extract<NonNullable<ReturnType<Store["current"]>["dialog"]>, { kind: "values" }>["answer"]
  >[0] = null,
): void {
  const dialog = store.current().dialog;
  if (dialog?.kind === "guard") {
    dialog.answer(run);
  } else if (dialog?.kind === "values") {
    dialog.answer(given);
  }
}

describe("a run", () => {
  it("keeps each statement's rows or rows affected, tells them, and keeps them in the history [DESIGN] D36", async () => {
    const asked = catalogBackend({
      run_statement: (args) => (String(args["sql"]).startsWith("SELECT") ? rowsRan([["1"], [null]]) : DONE),
    });
    const [store, id] = await sheet("");
    await runStatements(store, id, [whole("SELECT N FROM T"), { sql: "DELETE FROM T WHERE N = 1", from: 16, to: 41 }]);
    const w = worksheetOf(store.current(), id);
    expect(w?.runs.map((r) => r.outcome?.kind)).toEqual(["rows", "done"]);
    expect(w?.runs[0]?.rows).toEqual([["1"], [null]]);
    expect(w?.messages.map((m) => m.text)).toEqual([
      "2 rows, 2 ms on the server",
      expect.stringMatching(/^2 rows affected, \d+ ms$/u),
      "01004 (1): cut",
    ]);
    expect(w?.running).toBe(false);
    const recorded = asked
      .filter((a) => a.command === "record_history")
      .map((a) => (a.args["entry"] as { rows: number }).rows);
    expect(recorded).toEqual([2, 2]);
    expect(asked.find((a) => a.command === "judge_script")?.args["sql"]).toBe(
      "SELECT N FROM T;\nDELETE FROM T WHERE N = 1",
    );
  });

  it("stops at a failure, telling it at its place, and keeps none in the history the settings keep none of [RULE] R-ERR-2", async () => {
    const asked = catalogBackend({
      run_statement: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the backend rejects with Studio's error, not an Error
        throw failing(7);
      },
    });
    const [store, id] = await sheet("");
    store.update((now) => ({ ...now, settings: { ...now.settings, historyKept: false } }));
    await runStatements(store, id, [{ sql: "SELECT * FROM NOPE", from: 10, to: 28 }, whole("VALUES (2)")]);
    const w = worksheetOf(store.current(), id);
    expect(w?.runs).toHaveLength(1);
    expect(w?.runs[0]?.error?.sqlstate).toBe("2A000");
    expect(w?.messages.at(-1)).toMatchObject({ kind: "error", position: 17, text: "2A000 (-103): no such table" });
    expect(w?.pane).toBe("messages");
    expect(asked.filter((a) => a.command === "record_history")).toEqual([]);
  });

  it("asks first what the guards ask, and runs nothing unless confirmed [RULE] R-SEC-8", async () => {
    const confirm = { class: "changeSchema", destroys: ["DROP TABLE"], unclassified: [], production: false };
    const asked = catalogBackend({ judge_script: () => confirm, run_statement: () => DONE });
    const [store, id] = await sheet("");
    const refused = runStatements(store, id, [whole("DROP TABLE T CASCADE")]);
    await act(async () => {
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(store.current().dialog?.kind).toBe("guard");
    });
    answer(store, false);
    await refused;
    expect(asked.filter((a) => a.command === "run_statement")).toEqual([]);
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe("Not run: the run was not confirmed.");
    const run = runStatements(store, id, [whole("DROP TABLE T CASCADE")]);
    await vi.waitFor(() => {
      expect(store.current().dialog?.kind).toBe("guard");
    });
    answer(store, true);
    await run;
    expect(asked.find((a) => a.command === "run_statement")?.args).toMatchObject({ confirmed: true, values: [] });
  });

  it("asks the values of parameters and script variables, remembered, or runs nothing [DESIGN] D36", async () => {
    const asked = catalogBackend({
      statement_parameters: () => ["NUMERIC(10,0)", "CHARACTER VARYING(5)"],
      run_statement: () => rowsRan([]),
    });
    const [store, id] = await sheet("");
    const sql = "SELECT * FROM ${s}.T WHERE A = :a AND B = ?";
    const run = runStatements(store, id, [whole(sql)]);
    await vi.waitFor(() => {
      expect(store.current().dialog).toMatchObject({ kind: "values", variables: ["s"] });
    });
    answer(store, true, { binds: {}, variables: { s: "ANN" } });
    await vi.waitFor(() => {
      expect(store.current().dialog).toMatchObject({
        kind: "values",
        names: ["a", "?2"],
        types: ["NUMERIC(10,0)", "CHARACTER VARYING(5)"],
      });
    });
    answer(store, true, { binds: { a: "1", "?2": null }, variables: {} });
    await run;
    expect(asked.find((a) => a.command === "run_statement")?.args).toMatchObject({
      sql: "SELECT * FROM ANN.T WHERE A = ? AND B = ?",
      values: ["1", null],
    });
    expect(worksheetOf(store.current(), id)?.binds).toEqual({ a: "1", "?2": null });
    const again = runStatements(store, id, [whole(sql)]);
    await vi.waitFor(() => {
      expect(store.current().dialog).toMatchObject({ kind: "values", remembered: { a: "1", s: "ANN" } });
    });
    answer(store, true, null);
    await again;
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe("Not run: no values were given.");
    changeWorksheet(store, id, (w) => ({ ...w, variables: {} }));
    const unvalued = runStatements(store, id, [whole(sql)]);
    await vi.waitFor(() => {
      expect(store.current().dialog?.kind).toBe("values");
    });
    answer(store, true, null);
    await unvalued;
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe("Not run: no values were given.");
  });

  it("needs an open connection, and runs nothing of none [DESIGN] D36", async () => {
    const asked = catalogBackend();
    const [store, id] = await sheet("");
    changeWorksheet(store, id, (w) => ({ ...w, connection: null }));
    await runStatements(store, id, [whole("VALUES (1)")]);
    await runStatements(store, "missing", [whole("VALUES (1)")]);
    await runStatements(store, id, []);
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe(
      "The worksheet has no open connection: choose one.",
    );
    expect(asked.filter((a) => a.command === "judge_script")).toEqual([]);
  });

  it("tells a refusal of the guards, as a read-only connection's [RULE] R-SEC-8", async () => {
    catalogBackend({
      judge_script: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the backend rejects with Studio's error, not an Error
        throw { ...failing(null), sqlstate: "25006", sqlcode: -817, message: "read-only" };
      },
    });
    const [store, id] = await sheet("");
    await runStatements(store, id, [whole("DELETE FROM T WHERE 1 = 1")]);
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe("25006 (-817): read-only");
  });

  it("is stopped: the statement running cancelled, none after it run [DESIGN] D36", async () => {
    let release: (value: unknown) => void = () => undefined;
    const asked = catalogBackend({
      run_statement: () =>
        new Promise((done) => {
          release = done;
        }),
      cancel_statement: () => null,
    });
    const [store, id] = await sheet("");
    const run = runStatements(store, id, [whole("VALUES (1)"), whole("VALUES (2)")]);
    await vi.waitFor(() => {
      expect(worksheetOf(store.current(), id)?.runs).toHaveLength(1);
    });
    await stopRun(store, id);
    release(DONE);
    await run;
    expect(asked.filter((a) => a.command === "run_statement")).toHaveLength(1);
    expect(asked.some((a) => a.command === "cancel_statement")).toBe(true);
    await stopRun(store, id);
    expect(asked.filter((a) => a.command === "cancel_statement")).toHaveLength(1);
  });

  it("reads more of a result as asked, and tells a failure to [CLIENT Prepared statements]", async () => {
    let fail = false;
    const asked = catalogBackend({
      run_statement: () => rowsRan([["1"]], false),
      fetch_rows: () => {
        if (fail) {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- the backend rejects with Studio's error, not an Error
          throw failing(null);
        }
        return { from: 1, rows: [["2"]], rowsRead: 2, complete: true, lobs: [] };
      },
    });
    const [store, id] = await sheet("");
    await runStatements(store, id, [whole("VALUES (1)")]);
    await fetchMore(store, id, 1);
    expect(worksheetOf(store.current(), id)?.runs[0]).toMatchObject({ rows: [["1"], ["2"]], complete: true });
    expect(asked.find((a) => a.command === "fetch_rows")?.args).toEqual({
      connection: 1,
      result: 3,
      from: 1,
      count: FETCH_ROWS,
    });
    await fetchMore(store, id, 1);
    await fetchMore(store, id, 99);
    changeWorksheet(store, id, (w) => ({ ...w, runs: w.runs.map((r) => ({ ...r, complete: false })) }));
    fail = true;
    await fetchMore(store, id, 1);
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.kind).toBe("error");
  });

  it("closes the results of the run before, that are not read whole [CLIENT Prepared statements]", async () => {
    const asked = catalogBackend({ run_statement: () => rowsRan([["1"]], false), close_result: () => null });
    const [store, id] = await sheet("");
    await runStatements(store, id, [whole("VALUES (1)")]);
    await runStatements(store, id, [whole("VALUES (1)")]);
    expect(asked.filter((a) => a.command === "close_result").map((a) => a.args)).toEqual([
      { connection: 1, result: 3 },
    ]);
  });

  it("of EXPLAIN shows its plan, each page of it read, and keeps the plan before to compare [DOC sql/statements/explain.md EXPLAIN ANALYZE]", async () => {
    const asked = catalogBackend({
      run_statement: () => rowsRan([["-- physical:"]], false),
      fetch_rows: () => ({
        from: 1,
        rows: [["SeqScan ANN.T  (rows=4, cost=3.7)  (actual rows=4)"], ["-- ran: 4 rows"]],
        rowsRead: 3,
        complete: true,
        lobs: [],
      }),
    });
    const [store, id] = await sheet("");
    await explain(store, id, whole("SELECT * FROM T"), true);
    await explain(store, id, whole("SELECT * FROM T"), false);
    const w = worksheetOf(store.current(), id);
    expect(w?.pane).toBe("plan");
    expect(w?.plans).toHaveLength(2);
    expect(w?.plans[0]?.ran).toBe(4);
    expect(asked.filter((a) => a.command === "run_statement").map((a) => a.args["sql"])).toEqual([
      "EXPLAIN ANALYZE SELECT * FROM T",
      "EXPLAIN SELECT * FROM T",
    ]);
    catalogBackend({ run_statement: () => DONE });
    await explain(store, id, whole("VALUES (1)"), false);
    expect(worksheetOf(store.current(), id)?.plans).toHaveLength(2);
  });

  it("tells a notice in the messages of the worksheet that runs on its connection [CLIENT What the server tells]", async () => {
    catalogBackend();
    const [store, id] = await sheet("");
    told(store, {
      kind: "notice",
      connection: 1,
      sqlstate: "01T01",
      message: "rolled back",
      diagnostics: {
        severity: null,
        detail: null,
        hint: null,
        context: null,
        schema: null,
        table: null,
        column: null,
        dataType: null,
        constraint: null,
      },
    });
    told(store, {
      kind: "notice",
      connection: 5,
      sqlstate: "01T01",
      message: "elsewhere",
      diagnostics: {
        severity: null,
        detail: null,
        hint: null,
        context: null,
        schema: null,
        table: null,
        column: null,
        dataType: null,
        constraint: null,
      },
    });
    expect(worksheetOf(store.current(), id)?.messages.map((m) => m.text)).toEqual(["01T01: rolled back"]);
  });

  it("long, ended while the window is hidden, is notified [DESIGN] D36", async () => {
    const asked = catalogBackend({ run_statement: () => DONE, notify_finished: () => null });
    const [store, id] = await sheet("");
    store.update((now) => ({ ...now, settings: { ...now.settings, notifyAfterSeconds: 1 } }));
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    let clock = 0;
    const now = vi.spyOn(performance, "now").mockImplementation(() => (clock += 600));
    try {
      await runStatements(store, id, [whole("VALUES (1)")]);
    } finally {
      hidden.mockRestore();
      now.mockRestore();
    }
    expect(asked.find((a) => a.command === "notify_finished")?.args).toEqual({
      title: "Turborel Studio",
      body: "Untitled has finished running.",
    });
  });

  it("tells what the guards asked again, a result not read whole, and failures not of Studio's [RULE] R-ERR-2", async () => {
    let answer: () => unknown = () => ({
      kind: "confirm",
      answer: { class: "read", destroys: [], unclassified: [], production: false },
    });
    catalogBackend({ run_statement: () => answer() });
    const [store, id] = await sheet("");
    await runStatements(store, id, [whole("VALUES (1)")]);
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe("The guards asked again; nothing ran.");
    answer = () => rowsRan([["1"]], false);
    await runStatements(store, id, [whole("VALUES (1)")]);
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe("1+ rows, 2 ms on the server");
    answer = () => Promise.reject(new Error("boom"));
    await runStatements(store, id, [whole("VALUES (1)")]);
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe("TB910 (-910): boom");
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a failure of no Error, as a library may give
    answer = () => Promise.reject("plain");
    await runStatements(store, id, [whole("VALUES (1)")]);
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe("TB910 (-910): plain");
    catalogBackend({ judge_script: () => Promise.reject(new Error("judged")) });
    await runStatements(store, id, [whole("VALUES (1)")]);
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe("TB910 (-910): judged");
    changeWorksheet(store, id, (w) => ({ ...w, running: true }));
    await runStatements(store, id, [whole("VALUES (1)")]);
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe("TB910 (-910): judged");
  });

  it("keeps none in the history of a connection closed as it ran, and does not explain what did not run [DESIGN] D36", async () => {
    const asked = catalogBackend({ run_statement: () => DONE });
    const [store, id] = await sheet("");
    store.update((now) => ({ ...now, open: now.open.map((c) => ({ ...c, id: 2 })) }));
    changeWorksheet(store, id, (w) => ({ ...w, connection: 2 }));
    store.update((now) => ({ ...now, open: [] }));
    await runStatements(store, id, [whole("VALUES (1)")]);
    expect(asked.filter((a) => a.command === "record_history")).toEqual([]);
    await explain(store, id, whole("VALUES (1)"), false);
    expect(worksheetOf(store.current(), id)?.plans).toEqual([]);
  });

  it("tells a failure's rule and diagnostics, a change's generated values, and reads the catalog again after a definition changes [CLIENT What the server tells]", async () => {
    const generated: { kind: "ran"; answer: Ran } = {
      ...DONE,
      answer: {
        ...DONE.answer,
        warnings: [],
        outcome: { kind: "done", sqlcode: 0, sqlstate: "00000", rowsAffected: 1, generated: ["7"] },
      },
    };
    const asked = catalogBackend({ run_statement: () => generated, catalog_schemas: () => [] });
    const [store, id] = await sheet("");
    store.update((now) => ({
      ...now,
      catalogs: {
        1: { schemas: [], objects: {}, tables: {}, security: null, expanded: [], filter: "", found: null, chosen: [] },
      },
    }));
    await runStatements(store, id, [{ ...whole("CREATE TABLE T (A INTEGER)"), class: "changeSchema" }]);
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toMatch(/^1 rows affected, generated 7, \d+ ms$/u);
    expect(asked.filter((a) => a.command === "catalog_schemas")).toHaveLength(1);
    await runStatements(store, id, [{ ...whole("VALUES (1)"), class: "read" }]);
    expect(asked.filter((a) => a.command === "catalog_schemas")).toHaveLength(1);
    expect(
      failureText({
        ...failing(null),
        rule: "ISO/IEC 9075:1992 §11.8 GR7",
        diagnostics: {
          severity: "ERROR",
          detail: "a row of B",
          hint: "add the key",
          context: null,
          schema: "ANN",
          table: "T",
          column: "A",
          dataType: null,
          constraint: "T_FK",
        },
      }),
    ).toBe(
      "2A000 (-103): no such table; rule: ISO/IEC 9075:1992 §11.8 GR7; detail: a row of B; hint: add the key; of ANN.T.A; constraint T_FK",
    );
  });
});
