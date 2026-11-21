/**
 * Explain Analyze of a data change (RULES.md D61): main's EXPLAIN ANALYZE
 * runs an INSERT, UPDATE, DELETE or MERGE for real, in the session's
 * transaction. Studio says so first, and, unless the user keeps the
 * changes, rolls them back after: to a savepoint set before it, inside
 * the user's transaction if one is open, else in a transaction of its
 * own, autocommit held off meanwhile, so nothing is committed by it. A
 * server's connection and an embedded database alike.
 */
import { runStatement, sessionState, setAutocommit } from "../ipc/connections";
import { attempt, session } from "./actions";
import { explain, type ToRun } from "./running";
import type { Store } from "./store";
import { worksheetOf } from "./worksheets";

/** The savepoint an analyzed change is rolled back to. */
export const ANALYZE_SAVEPOINT = "STUDIO_ANALYZE";

/** Whether `statement` is a data change, which EXPLAIN ANALYZE runs for real. */
export function changesData(statement: ToRun): boolean {
  return statement.class === "writeRows" && /^\s*(?:INSERT|UPDATE|DELETE|MERGE)\b/iu.test(statement.sql);
}

/** Runs `sql` on `connection` as a step of its own, its failure told. */
async function step(store: Store, connection: number, sql: string): Promise<void> {
  await attempt(store, () => runStatement(connection, sql, false));
}

/**
 * Runs EXPLAIN ANALYZE of data change `statement` on worksheet `id`, its
 * plan shown; then, unless `keep`, rolls its changes back to the
 * savepoint set before it, the transaction it began ended, and autocommit
 * as it was.
 */
export async function analyzeChange(store: Store, id: string, statement: ToRun, keep: boolean): Promise<void> {
  const connection = worksheetOf(store.current(), id)?.connection ?? null;
  if (keep || connection === null) {
    await explain(store, id, statement, true);
    return;
  }
  const before = store.current().open.find((c) => c.id === connection)?.session.transaction;
  const autocommit = before?.autocommit === true;
  const began = before?.active !== true;
  if (autocommit) {
    await attempt(store, () => setAutocommit(connection, false));
  }
  await step(store, connection, `SAVEPOINT ${ANALYZE_SAVEPOINT}`);
  try {
    await explain(store, id, statement, true);
  } finally {
    await step(store, connection, `ROLLBACK TO SAVEPOINT ${ANALYZE_SAVEPOINT}`);
    await step(store, connection, began ? "ROLLBACK" : `RELEASE SAVEPOINT ${ANALYZE_SAVEPOINT}`);
    if (autocommit) {
      await attempt(store, () => setAutocommit(connection, true));
    }
    const after = await attempt(store, () => sessionState(connection));
    if (after !== undefined) {
      session(store, connection, after);
    }
  }
}
