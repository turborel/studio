import { act, fireEvent, screen } from "@testing-library/react";
import type { TableDetail } from "../ipc/catalog";
import type { Ran, SessionState } from "../ipc/connections";
import { runStatements } from "../state/running";
import type { Store } from "../state/store";
import { changeWorksheet, openWorksheet, worksheetOf } from "../state/worksheets";
import { SESSION } from "../test/backend";
import { catalogBackend, must, opened, settle, within } from "../test/catalog";
import { Panes } from "../worksheet/Panes";
import { applyEdits, beginEditing, reviewText, stage } from "./editing";
import { editCell } from "./edits";

/** The table edited: ID its key, NAME a column. */
const ITEMS: TableDetail = {
  schema: "ANN",
  name: "ITEMS",
  kind: "BASE TABLE",
  columns: [
    {
      name: "ID",
      position: 1,
      typeWritten: "INTEGER",
      default: null,
      nullable: false,
      identity: null,
      generated: null,
      domain: null,
    },
    {
      name: "NAME",
      position: 2,
      typeWritten: "VARCHAR(20)",
      default: null,
      nullable: true,
      identity: null,
      generated: null,
      domain: null,
    },
  ],
  constraints: [
    { name: "ITEMS_PK", kind: "PRIMARY KEY", columns: ["ID"], check: null, references: null, deferrable: false },
  ],
  indexes: [],
  triggers: [],
  privileges: [],
  view: null,
  partitioning: null,
  partitionOf: null,
  storage: null,
};

/** The rows of ITEMS. */
const ITEM_ROWS = [
  ["1", "Pen"],
  ["2", "Ink"],
  ["3", "Nib"],
];

/** What a statement gave: the rows of `table`, or of a change, `affected` rows. */
function gave(
  sql: string,
  affected: number,
  session: SessionState,
  [table, rows]: readonly [TableDetail, readonly (readonly string[])[]] = [ITEMS, ITEM_ROWS],
): Ran {
  return {
    outcome: sql.startsWith("SELECT")
      ? {
          kind: "rows",
          result: 1,
          columns: table.columns.map((c) => ({
            name: c.name,
            typeWritten: c.typeWritten,
            typeName: null,
            notNull: !c.nullable,
          })),
          page: {
            from: 0,
            rows,
            rowsRead: rows.length,
            complete: true,
            lobs: [],
          },
        }
      : {
          kind: "done",
          sqlcode: 0,
          sqlstate: "00000",
          rowsAffected: /^(UPDATE|DELETE|INSERT)/u.test(sql) ? affected : null,
          generated: [],
        },
    warnings: [],
    serverTime: null,
    session,
  };
}

/** A worksheet that has run `sql` and shows its panes: the store, the worksheet, and the calls made. */
async function edited(
  sql = "SELECT * FROM ITEMS",
  { affected = 1, session = SESSION, table = ITEMS, rows = ITEM_ROWS } = {},
) {
  const asked = catalogBackend({
    catalog_table: () => table,
    run_statement: (args) => ({ kind: "ran", answer: gave(String(args["sql"]), affected, session, [table, rows]) }),
    set_autocommit: (args) => ({
      ...session,
      transaction: { ...session.transaction, autocommit: args["on"] === true },
    }),
  });
  const store = await opened();
  const id = openWorksheet(store, sql);
  within(store, <Panes id={id} />);
  await act(() => runStatements(store, id, [{ sql, from: 0, to: sql.length }]));
  await settle();
  return { store, id, asked };
}

/** The statements sent, after the first query. */
function sent(asked: { command: string; args: Record<string, unknown> }[]): unknown[] {
  return asked
    .filter((a) => a.command === "run_statement")
    .map((a) => a.args["sql"])
    .slice(1);
}

/** Clicks the button named `name`. */
async function click(name: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name }));
  await settle();
}

/** The run worksheet `id` shows last. */
function lastRun(store: Store, id: string) {
  return must(worksheetOf(store.current(), id)?.runs.at(-1));
}

describe("editing a result's rows", () => {
  it("stages cells, rows added and removed, reviews their statements and applies them in a transaction [DESIGN] D42", async () => {
    const { store, id, asked } = await edited();
    await click("Edit Rows");
    expect(screen.getByText("0 changes staged")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Edit 1,0"), { target: { value: "Quill" } });
    expect(screen.getByRole("button", { name: "Cell 1,0" }).textContent).toBe("Quill");
    fireEvent.contextMenu(screen.getByRole("button", { name: "Cell 1,1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Set to NULL" }));
    await click("Add Row");
    expect(screen.getByRole("button", { name: "Cell 1,3" }).textContent).toBe("DEFAULT");
    fireEvent.change(screen.getByLabelText("Edit 1,3"), { target: { value: "Pad" } });
    fireEvent.click(screen.getByRole("button", { name: "Cell 0,2" }));
    await click("Remove Rows Selected");
    expect(screen.getByText("4 changes staged")).toBeTruthy();
    expect(screen.queryByLabelText("Edit 1,2")).toBeNull();
    await click("Review Changes…");
    expect(screen.getByLabelText("Statements").textContent).toBe(
      'DELETE FROM "ANN"."ITEMS" WHERE "ID" = ?;\n-- "3"\nUPDATE "ANN"."ITEMS" SET "NAME" = ? WHERE "ID" = ?;\n-- "Quill", "1"\n' +
        'UPDATE "ANN"."ITEMS" SET "NAME" = ? WHERE "ID" = ?;\n-- NULL, "2"\nINSERT INTO "ANN"."ITEMS" ("NAME") VALUES (?);\n-- "Pad"',
    );
    await click("Close");
    await click("Apply Changes");
    expect(sent(asked)).toEqual([
      'DELETE FROM "ANN"."ITEMS" WHERE "ID" = ?',
      'UPDATE "ANN"."ITEMS" SET "NAME" = ? WHERE "ID" = ?',
      'UPDATE "ANN"."ITEMS" SET "NAME" = ? WHERE "ID" = ?',
      'INSERT INTO "ANN"."ITEMS" ("NAME") VALUES (?)',
      "COMMIT",
      "SELECT * FROM ITEMS",
    ]);
    expect(asked.filter((a) => a.command === "judge_script").at(-1)?.args["sql"]).toContain("DELETE FROM");
    expect(lastRun(store, id).editing).toBeNull();
    expect(worksheetOf(store.current(), id)?.messages.some((m) => m.text === "Applied 4 statements.")).toBe(true);
  });

  it("shows a number of 38 digits as its text, and sends one edited as its text [DESIGN] D42 [DOC sql/02-data-types.md Numbers]", async () => {
    const wide = "12345678901234567890123456789012345678";
    const edit = "-99999999999999999999999999999999999999";
    const amount = { ...must(ITEMS.columns[1]), name: "AMOUNT", typeWritten: "NUMERIC(38,0)" };
    const table = { ...ITEMS, name: "WIDE", columns: [must(ITEMS.columns[0]), amount] };
    const { asked } = await edited("SELECT * FROM WIDE", { table, rows: [["1", wide]] });
    await click("Edit Rows");
    expect(screen.getByRole("button", { name: "Cell 1,0" }).textContent).toBe(wide);
    fireEvent.change(screen.getByLabelText("Edit 1,0"), { target: { value: edit } });
    expect(screen.getByRole("button", { name: "Cell 1,0" }).textContent).toBe(edit);
    await click("Apply Changes");
    const update = asked.find((a) => a.command === "run_statement" && String(a.args["sql"]).startsWith("UPDATE"));
    expect(must(update).args["values"]).toEqual([edit, "1"]);
  });

  it("rolls back where a row changed since it was read, under autocommit too, and keeps the edits [DESIGN] D42", async () => {
    const session = { ...SESSION, transaction: { ...SESSION.transaction, autocommit: true } };
    const { store, id, asked } = await edited("SELECT * FROM ITEMS", { affected: 0, session });
    await act(() => beginEditing(store, id, lastRun(store, id).id));
    act(() => {
      stage(store, id, lastRun(store, id).id, (e) => editCell(e, [1, 0], "Quill", 3));
    });
    await act(() => applyEdits(store, id, lastRun(store, id).id));
    expect(sent(asked)).toEqual(['UPDATE "ANN"."ITEMS" SET "NAME" = ? WHERE "ID" = ?', "ROLLBACK"]);
    expect(asked.filter((a) => a.command === "set_autocommit").map((a) => a.args["on"])).toEqual([false, true]);
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toContain("changed 0 rows, not one");
    expect(lastRun(store, id).editing?.edits.changed).toEqual({ 0: { 1: "Quill" } });
    await click("Revert Changes");
    expect(screen.getByText("0 changes staged")).toBeTruthy();
    await click("Stop Editing");
    expect(lastRun(store, id).editing).toBeNull();
  });

  it("applies within the session's transaction, left to it, and not when the guards' question is declined [DESIGN] D42", async () => {
    const session = { ...SESSION, transaction: { ...SESSION.transaction, active: true } };
    const { store, id, asked } = await edited("SELECT * FROM ITEMS", { session });
    const runId = lastRun(store, id).id;
    await act(() => beginEditing(store, id, runId));
    act(() => {
      stage(store, id, runId, (e) => editCell(e, [1, 0], "Quill", 3));
    });
    await act(() => applyEdits(store, id, runId));
    expect(sent(asked)).toEqual(['UPDATE "ANN"."ITEMS" SET "NAME" = ? WHERE "ID" = ?', "SELECT * FROM ITEMS"]);
    expect(
      worksheetOf(store.current(), id)?.messages.some(
        (m) => m.text === "Applied 1 statements, in the session's transaction.",
      ),
    ).toBe(true);
    catalogBackend({
      catalog_table: () => ITEMS,
      judge_script: () => ({ class: "writeRows", destroys: [], unclassified: [], production: true }),
    });
    await act(() => beginEditing(store, id, lastRun(store, id).id));
    act(() => {
      stage(store, id, lastRun(store, id).id, (e) => editCell(e, [1, 0], "Nib", 3));
    });
    const applying = applyEdits(store, id, lastRun(store, id).id);
    await settle();
    const dialog = store.current().dialog;
    act(() => {
      if (dialog?.kind === "guard") {
        dialog.answer(false);
      }
    });
    await act(() => applying);
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe(
      "Not applied: the changes were not confirmed.",
    );
  });

  it("is refused of a query of several tables, of a table with no key, and of nothing staged [DESIGN] D42", async () => {
    const { store, id, asked } = await edited("SELECT * FROM ITEMS, OTHERS");
    await act(() => beginEditing(store, id, lastRun(store, id).id));
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe(
      "Only the rows of a query of one table are edited.",
    );
    act(() => {
      changeWorksheet(store, id, (w) => ({
        ...w,
        runs: w.runs.map((r) => ({ ...r, query: { sql: "SELECT * FROM ITEMS", sort: [], filter: "" } })),
      }));
    });
    catalogBackend({ catalog_table: () => ({ ...ITEMS, constraints: [] }) });
    await act(() => beginEditing(store, id, lastRun(store, id).id));
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toContain("edited only of a base table with a key");
    catalogBackend({ catalog_table: () => Promise.reject(new Error("no such table")) });
    await act(() => beginEditing(store, id, lastRun(store, id).id));
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toContain("no such table");
    await act(() => applyEdits(store, id, lastRun(store, id).id));
    await act(() => beginEditing(store, id, 99));
    expect(asked.filter((a) => a.command === "judge_script")).toHaveLength(1);
  });

  it("rolls back a run the guards ask of again, or that fails, and tells of one change staged [DESIGN] D42", async () => {
    let answer: (sql: string) => unknown = () => ({
      kind: "confirm",
      answer: { class: "writeRows", destroys: [], unclassified: [], production: false },
    });
    const asked = catalogBackend({
      catalog_table: () => ITEMS,
      run_statement: (args) => {
        const sql = String(args["sql"]);
        return sql.startsWith("SELECT") || sql === "ROLLBACK"
          ? { kind: "ran", answer: gave(sql, 1, SESSION) }
          : answer(sql);
      },
    });
    const store = await opened();
    const id = openWorksheet(store, "SELECT * FROM ITEMS");
    within(store, <Panes id={id} />);
    await act(() => runStatements(store, id, [{ sql: "SELECT * FROM ITEMS", from: 0, to: 19 }]));
    await click("Edit Rows");
    fireEvent.change(screen.getByLabelText("Edit 1,0"), { target: { value: "Quill" } });
    expect(screen.getByText("1 change staged")).toBeTruthy();
    expect(reviewText({ ...lastRun(store, id), editing: null })).toBe("");
    await act(() => applyEdits(store, id, lastRun(store, id).id));
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toBe("The guards asked again; nothing was kept.");
    answer = () => Promise.reject(new Error("the server went away"));
    await act(() => applyEdits(store, id, lastRun(store, id).id));
    expect(worksheetOf(store.current(), id)?.messages.at(-1)?.text).toContain("the server went away");
    expect(asked.filter((a) => a.args["sql"] === "ROLLBACK")).toHaveLength(2);
  });
});
