/**
 * Editing a result's rows (RULES.md D42): begun where the result's query
 * reads one base table and holds its key; each change staged in the run;
 * the statements that make them judged by the guards together, then run
 * in one transaction, each UPDATE and DELETE changing exactly its row,
 * committed once all have run, rolled back if any fails; the query run
 * again after, to show the rows as they are.
 */
import { catalogTable } from "../ipc/catalog";
import { runStatement, setAutocommit } from "../ipc/connections";
import { judgeScript } from "../ipc/worksheet";
import { session } from "../state/actions";
import { confirmed, failure, failureText, message } from "../state/running";
import type { Store } from "../state/store";
import { changeWorksheet, type RunResult, tell, worksheetOf } from "../state/worksheets";
import { wordScope } from "../worksheet/complete/words";
import { queryOf, requery } from "./actions";
import { type EditStatement, editStatements, editTarget, type Edits, NO_EDITS, staged } from "./edits";

/** Run `runId` of worksheet `id`. */
function runOf(store: Store, id: string, runId: number): RunResult | undefined {
  return worksheetOf(store.current(), id)?.runs.find((r) => r.id === runId);
}

/** Changes run `runId` in place. */
function changeRun(store: Store, id: string, runId: number, change: (r: RunResult) => RunResult): void {
  changeWorksheet(store, id, (w) => ({ ...w, runs: w.runs.map((r) => (r.id === runId ? change(r) : r)) }));
}

/** The one table `sql` reads, its schema the session's where it names none: null if it reads none or several. */
export function readTable(sql: string, schema: string | null): { schema: string; name: string } | null {
  const tables = wordScope(sql).filter((s) => s.kind === "table");
  const [only] = tables;
  const owner = only?.schema ?? schema;
  if (tables.length !== 1 || only?.name === null || only === undefined || owner === null) {
    return null;
  }
  return { schema: owner, name: only.name };
}

/** Begins editing run `runId`'s rows: told why not where its query reads no one base table holding its key. */
export async function beginEditing(store: Store, id: string, runId: number): Promise<void> {
  const run = runOf(store, id, runId);
  if (run === undefined || run.outcome?.kind !== "rows") {
    return;
  }
  const schema = store.current().open.find((c) => c.id === run.connection)?.session.schema ?? null;
  const table = readTable(queryOf(run).sql, schema);
  const refuse = (why: string) => {
    tell(store, id, message("error", why));
  };
  if (table === null) {
    refuse("Only the rows of a query of one table are edited.");
    return;
  }
  try {
    const detail = await catalogTable(run.connection, table.schema, table.name);
    const target = editTarget(detail, run.columns);
    if (target === null) {
      refuse(
        `The rows of ${table.schema}.${table.name} are edited only of a base table with a key, and a result of its key's columns.`,
      );
      return;
    }
    changeRun(store, id, runId, (r) => ({ ...r, editing: { target, edits: NO_EDITS } }));
  } catch (thrown: unknown) {
    refuse(failureText(failure(thrown)));
  }
}

/** Changes run `runId`'s staged edits as `change` says. */
export function stage(store: Store, id: string, runId: number, change: (edits: Edits) => Edits): void {
  changeRun(store, id, runId, (r) =>
    r.editing === null ? r : { ...r, editing: { ...r.editing, edits: change(r.editing.edits) } },
  );
}

/** Ends editing run `runId`, its edits let go. */
export function endEditing(store: Store, id: string, runId: number): void {
  changeRun(store, id, runId, (r) => ({ ...r, editing: null }));
}

/** The statements run `runId`'s edits make, as text, each its parameters' values after it. */
export function reviewText(run: RunResult): string {
  if (run.editing === null) {
    return "";
  }
  return editStatements(run.editing.target, run.rows, run.editing.edits)
    .map(
      (s) =>
        `${s.sql};${s.values.length === 0 ? "" : `\n-- ${s.values.map((v) => (v === null ? "NULL" : JSON.stringify(v))).join(", ")}`}`,
    )
    .join("\n");
}

/** Runs `statements` on `connection`, each confirmed: the first failure's text, or null if each did as it must. */
async function ranEach(connection: number, statements: readonly EditStatement[]): Promise<string | null> {
  for (const s of statements) {
    const answer = await runStatement(connection, s.sql, true, s.values);
    if (answer.kind !== "ran") {
      return "The guards asked again; nothing was kept.";
    }
    const outcome = answer.answer.outcome;
    if (s.one && (outcome.kind !== "done" || outcome.rowsAffected !== 1)) {
      return `${s.sql} changed ${outcome.kind === "done" ? String(outcome.rowsAffected ?? 0) : "no"} rows, not one: a row changed since it was read, or its key is not one row's.`;
    }
  }
  return null;
}

/** Runs `statements` of run `run` in a transaction: its own, committed or rolled back, if `own`; else the session's. */
async function inTransaction(
  store: Store,
  id: string,
  run: RunResult,
  { statements, own }: { statements: EditStatement[]; own: boolean },
) {
  const finish = async (sql: string) => {
    const done = await runStatement(run.connection, sql, true, []);
    if (done.kind === "ran") {
      session(store, run.connection, done.answer.session);
    }
  };
  try {
    const failed = await ranEach(run.connection, statements);
    if (failed !== null) {
      if (own) {
        await finish("ROLLBACK");
      }
      tell(store, id, message("error", failed));
      return false;
    }
    if (own) {
      await finish("COMMIT");
    }
    return true;
  } catch (thrown: unknown) {
    if (own) {
      await finish("ROLLBACK").catch(() => null);
    }
    tell(store, id, message("error", failureText(failure(thrown))));
    return false;
  }
}

/**
 * Applies run `runId`'s edits: the statements judged together, then run in a transaction of their own, committed if
 * each did as it must, rolled back if not; within the session's transaction, if one is active, left to it.
 */
export async function applyEdits(store: Store, id: string, runId: number): Promise<void> {
  const run = runOf(store, id, runId);
  const open = store.current().open.find((c) => c.id === run?.connection);
  if (run?.editing === undefined || run.editing === null || open === undefined || staged(run.editing.edits) === 0) {
    return;
  }
  const statements = editStatements(run.editing.target, run.rows, run.editing.edits);
  const ask = await judgeScript(run.connection, statements.map((s) => s.sql).join(";\n"));
  if (ask !== null && !(await confirmed(store, ask))) {
    tell(store, id, message("notice", "Not applied: the changes were not confirmed."));
    return;
  }
  const own = !open.session.transaction.active;
  const autocommit = open.session.transaction.autocommit;
  if (autocommit) {
    session(store, run.connection, await setAutocommit(run.connection, false));
  }
  const done = await inTransaction(store, id, run, { statements, own });
  if (autocommit) {
    session(store, run.connection, await setAutocommit(run.connection, true));
  }
  if (done) {
    tell(
      store,
      id,
      message("ok", `Applied ${String(statements.length)} statements${own ? "" : ", in the session's transaction"}.`),
    );
    endEditing(store, id, runId);
    await requery(store, id, runId, (q) => q);
  }
}
