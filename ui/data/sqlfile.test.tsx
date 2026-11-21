import { act, fireEvent, screen } from "@testing-library/react";
import { emit } from "@tauri-apps/api/event";
import { command } from "../commands/commands";
import type { FileReport, Scan } from "../ipc/data";
import { STUDIO_EVENT } from "../ipc/events";
import { openMenuOf } from "../shell/ConnectionsPanel";
import { catalogBackend, must, opened, refused, settle, within } from "../test/catalog";
import { DataDialog } from "./DataDialog";

/** What the file holds, as the backend's scan found it. */
const SCAN: Scan = {
  bytes: 2048,
  encoding: "utf16Le",
  statements: 3,
  classes: { writeRows: 2, changeSchema: 1 },
  destroys: [{ line: 7, what: "DELETE of every row of T, with no WHERE" }],
  destroysCount: 1,
  unclassified: [],
  unclassifiedCount: 0,
  firstWrite: { line: 1, what: "CREATE TABLE T (A INTEGER)" },
  readWrite: null,
  connects: null,
};

/** What the run did. */
const REPORT: FileReport = {
  ending: "finished",
  statements: 3,
  rowsAffected: 5,
  failed: 1,
  log: [
    {
      number: 2,
      line: 4,
      sqlstate: "23000",
      sqlcode: -201,
      message: "duplicate key",
      statement: "INSERT INTO T VALUES (1)",
    },
  ],
  rolledBack: false,
  millis: 1500,
};

/** The guards' question of the file. */
const ASKED = {
  class: "changeSchema",
  destroys: ["line 7: DELETE of every row of T, with no WHERE"],
  unclassified: [],
  production: false,
};

describe("Run SQL File", () => {
  it("opens from the File menu's command and a connection's menu, on that connection [DESIGN] D62", async () => {
    catalogBackend();
    const store = await opened();
    const run = must(command("file.runSql"));
    expect(run.enabled({ store } as never)).toBe(true);
    await run.run({ store } as never);
    expect(store.current().dialog).toEqual({ kind: "data", task: { kind: "runSqlFile", connection: 1 } });
    const item = openMenuOf(store, must(store.current().open[0])).find(
      (i) => i !== "separator" && i.label === "Run SQL File…",
    );
    expect(item).toBeDefined();
  });

  it("sums up the file, asks once as the guards say, shows its progress, and tells and saves what it did [DESIGN] D62 [RULE] R-SEC-8", async () => {
    let finish: (report: unknown) => void = () => undefined;
    const asked = catalogBackend({
      choose_sql_file: () => "/data/load.sql",
      scan_sql_file: () => [SCAN, ASKED],
      run_sql_file: (args) =>
        args["confirmed"] === true
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : { kind: "confirm", confirm: ASKED, scan: SCAN },
      save_sql_file_log: () => "/data/load.sql.log",
    });
    const store = await opened();
    within(store, <DataDialog task={{ kind: "runSqlFile", connection: 1 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose File…" }));
    await settle();
    const summary = screen.getByRole("region", { name: "What the file holds" }).textContent;
    expect(summary).toContain("3 statements in 2,048 bytes, UTF-16, little-endian.");
    expect(summary).toContain("Changes rows: 2 statements");
    expect(summary).toContain("Destroys: 1 statement");
    expect(summary).toContain("Line 7: DELETE of every row of T, with no WHERE");
    fireEvent.click(screen.getByRole("radio", { name: "One transaction for the whole file" }));
    fireEvent.click(screen.getByRole("radio", { name: "Go on, logging its line and SQLSTATE" }));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await settle();
    expect(screen.getByText("The script changes definitions.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Run File" }));
    await settle();
    const runs = asked.filter((a) => a.command === "run_sql_file");
    expect(runs.map((a) => a.args)).toEqual([
      {
        connection: 1,
        path: "/data/load.sql",
        options: { transactions: { kind: "whole" }, stopOnError: false },
        confirmed: false,
      },
      {
        connection: 1,
        path: "/data/load.sql",
        options: { transactions: { kind: "whole" }, stopOnError: false },
        confirmed: true,
      },
    ]);
    await act(async () => {
      await emit(STUDIO_EVENT, {
        kind: "sqlFile",
        connection: 1,
        progress: { statements: 2, bytes: 1024, total: 2048, failed: 1 },
      });
    });
    expect(screen.getByRole("status", { name: "Progress" }).textContent).toContain(
      "2 statements run, 1,024 of 2,048 bytes read, 1 failed.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel Run" }));
    expect(asked.some((a) => a.command === "cancel_sql_file")).toBe(true);
    await act(async () => {
      finish({ kind: "ran", report: REPORT });
      await settle();
    });
    const report = screen.getByRole("status", { name: "What the run did" }).textContent;
    expect(report).toContain("Finished: 3 statements run, 5 rows affected, 1 failed, in 1.5 s.");
    expect(report).toContain("Line 4: 23000 (-201): duplicate key");
    fireEvent.click(screen.getByRole("button", { name: "Save Log…" }));
    await settle();
    expect(asked.find((a) => a.command === "save_sql_file_log")?.args).toEqual({
      path: "/data/load.sql",
      report: REPORT,
    });
    expect(screen.getByText("The log is saved as /data/load.sql.log.")).toBeTruthy();
  });

  it("tells a file refused, and one the user would not run [DESIGN] D62", async () => {
    catalogBackend({
      choose_sql_file: () => "/data/bad.sql",
      scan_sql_file: () => refused({ sqlcode: -910, sqlstate: "TB910", message: "the file is not text Studio reads" }),
    });
    const store = await opened();
    within(store, <DataDialog task={{ kind: "runSqlFile", connection: 1 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose File…" }));
    await settle();
    expect(screen.getByText("the file is not text Studio reads")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Run" }).disabled).toBe(true);
  });

  it("tells a stop and what was rolled back, failures past the log, a file not confirmed, and failures of its own [DESIGN] D62", async () => {
    let chosen: string | null = null;
    let runs = 0;
    const asked = catalogBackend({
      choose_sql_file: () => chosen,
      scan_sql_file: () => [
        { ...SCAN, destroysCount: 3 },
        { ...ASKED, production: true },
      ],
      run_sql_file: (args) => {
        runs += 1;
        if (args["confirmed"] !== true) {
          return { kind: "confirm", confirm: ASKED, scan: SCAN };
        }
        return runs > 3
          ? refused({ sqlcode: -910, sqlstate: "TB910", message: "the session's transaction is open" })
          : { kind: "ran", report: { ...REPORT, ending: "stopped", failed: 12, rolledBack: true } };
      },
      save_sql_file_log: () => null,
    });
    const store = await opened();
    within(store, <DataDialog task={{ kind: "runSqlFile", connection: 1 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose File…" }));
    await settle();
    expect(screen.getByText("No file chosen.")).toBeTruthy();
    chosen = "/data/load.sql";
    fireEvent.click(screen.getByRole("button", { name: "Choose File…" }));
    await settle();
    expect(screen.getByText("and 2 more")).toBeTruthy();
    expect(screen.getByText("This is a production connection, and the file may write.")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Autocommit: each statement its own" }));
    fireEvent.click(screen.getByRole("radio", { name: /Commit every/u }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Statements a commit follows" }), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Statements a commit follows" }), {
      target: { value: "250" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Stop, rolling back what ran since the last commit" }));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Don't Run" }));
    expect(screen.getByText("Not run: the file was not confirmed.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await settle();
    await act(async () => {
      await emit(STUDIO_EVENT, {
        kind: "sqlFile",
        connection: 9,
        progress: { statements: 1, bytes: 1, total: 2, failed: 0 },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Run File" }));
    await settle();
    expect(asked.filter((a) => a.command === "run_sql_file").at(-1)?.args["options"]).toEqual({
      transactions: { kind: "every", every: 250 },
      stopOnError: true,
    });
    const report = screen.getByRole("status", { name: "What the run did" }).textContent;
    expect(report).toContain("Stopped at a failure");
    expect(report).toContain("What ran since the last commit was rolled back.");
    expect(report).toContain("and 11 more failures, not kept.");
    fireEvent.click(screen.getByRole("button", { name: "Save Log…" }));
    await settle();
    expect(screen.queryByText(/The log is saved/u)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Run Again" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Run File" }));
    await settle();
    expect(screen.getByText("the session's transaction is open")).toBeTruthy();
  });
});
