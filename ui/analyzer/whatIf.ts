/**
 * A what-if index (RULES.md D51): an index made for real, the statement
 * explained, and the index dropped, so the plan before and the plan with
 * it are compared. Turborel makes an index apart from any transaction,
 * and other sessions see it while it stands, so it runs only when the
 * user asks, after a warning that says so, each statement through the
 * connection's guards. A transaction the EXPLAIN began, not under
 * autocommit, is rolled back before DROP INDEX, which runs outside one.
 */
import { explain, runStatements, type ToRun } from "../state/running";
import { show } from "../state/actions";
import type { Store } from "../state/store";
import { changeWorksheet, worksheetOf } from "../state/worksheets";

/** A what-if: the worksheet, the statement explained, the index and the statements that make and drop it. */
export interface WhatIf {
  readonly worksheet: string;
  readonly statement: ToRun;
  readonly index: string;
  readonly create: string;
  readonly drop: string;
}

/** Whether worksheet `id`'s last run failed, or none ran. */
function failed(store: Store, id: string): boolean {
  const run = worksheetOf(store.current(), id)?.runs.at(-1);
  return run?.error !== null;
}

/** Whether worksheet `id`'s connection is under autocommit. */
function autocommit(store: Store, id: string): boolean {
  const now = store.current();
  const connection = worksheetOf(now, id)?.connection;
  return now.open.find((c) => c.id === connection)?.session.transaction.autocommit ?? true;
}

/** Runs what-if `w`: the index made, the statement explained, the index dropped. */
export async function runWhatIf(store: Store, w: WhatIf): Promise<void> {
  show(store, null);
  const at = { from: w.statement.from, to: w.statement.from };
  await runStatements(store, w.worksheet, [{ sql: w.create, ...at, class: "changeSchema" }]);
  if (failed(store, w.worksheet)) {
    return;
  }
  const before = worksheetOf(store.current(), w.worksheet)?.plans.at(-1);
  try {
    await explain(store, w.worksheet, w.statement, false);
  } finally {
    if (!autocommit(store, w.worksheet)) {
      await runStatements(store, w.worksheet, [{ sql: "ROLLBACK", ...at, class: "transaction" }]);
    }
    await runStatements(store, w.worksheet, [{ sql: w.drop, ...at, class: "changeSchema" }]);
  }
  const explained = worksheetOf(store.current(), w.worksheet)?.plans.at(-1) !== before;
  changeWorksheet(store, w.worksheet, (x) => ({ ...x, whatIf: explained ? w.index : null, pane: "plan" }));
}
