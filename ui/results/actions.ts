/**
 * What the results do (RULES.md D39): a result sorted and filtered, its
 * query run again within one that does so; pinned; its cells copied in a
 * format; its query's rows exported to a file; and what the status bar
 * tells of the cells selected.
 */
import { closeResult, type Cell, runStatement } from "../ipc/connections";
import { type ExportKind, exportQuery } from "../ipc/results";
import { session } from "../state/actions";
import { confirmed, failure, failureText, lobKeys, message, sessionAgain } from "../state/running";
import type { Store } from "../state/store";
import { changeWorksheet, type RunResult, tell, worksheetOf } from "../state/worksheets";
import { wordScope } from "../worksheet/complete/words";
import { type CopyFormat, copied } from "./copy";
import { delimited } from "./literals";
import { plain, type Query, sortable, wrapped } from "./requery";

/** Run `runId` of worksheet `id`. */
function runOf(store: Store, id: string, runId: number): RunResult | undefined {
  return worksheetOf(store.current(), id)?.runs.find((r) => r.id === runId);
}

/** Run `runId`'s query: as it was sorted and filtered last, or as written. */
export function queryOf(run: RunResult): Query {
  return run.query ?? { sql: run.sql, sort: [], filter: "" };
}

/** Whether run `run`'s result may be sorted and filtered: a query's, not a plan's. */
export function requeryable(run: RunResult): boolean {
  return run.outcome?.kind === "rows" && run.plan === null && sortable(queryOf(run).sql);
}

/** Changes run `runId`'s result in place. */
function changeRun(store: Store, id: string, runId: number, change: (r: RunResult) => RunResult): void {
  changeWorksheet(store, id, (w) => ({ ...w, runs: w.runs.map((r) => (r.id === runId ? change(r) : r)) }));
}

/** Runs `sql` with `values` on `connection`, the guards asked if they ask: what it gave, or null if not run. */
async function ranAsked(store: Store, connection: number, sql: string, values: readonly (string | null)[]) {
  const answer = await runStatement(connection, sql, false, values);
  if (answer.kind === "ran") {
    return answer.answer;
  }
  if (!(await confirmed(store, answer.answer))) {
    return null;
  }
  const again = await runStatement(connection, sql, true, values);
  return again.kind === "ran" ? again.answer : null;
}

/**
 * Sorts and filters run `runId`'s result of worksheet `id` as `change` says of its query: run again on the server,
 * its rows replaced and its old result closed once the new has come; a failure told, the old rows kept.
 */
export async function requery(store: Store, id: string, runId: number, change: (q: Query) => Query): Promise<void> {
  const w = worksheetOf(store.current(), id);
  const run = runOf(store, id, runId);
  if (w === undefined || w.running || run === undefined || !requeryable(run) || run.outcome?.kind !== "rows") {
    return;
  }
  const old = run.outcome.result;
  const next = change(queryOf(run));
  changeWorksheet(store, id, (x) => ({ ...x, running: true }));
  const clock = performance.now();
  try {
    const ran = await ranAsked(store, run.connection, wrapped(next, run.columns), run.values);
    if (ran?.outcome.kind !== "rows") {
      return;
    }
    session(store, run.connection, ran.session);
    const page = ran.outcome.page;
    changeRun(store, id, runId, (r) => ({
      ...r,
      outcome: ran.outcome,
      rows: page.rows,
      complete: page.complete,
      lobs: lobKeys(page),
      millis: performance.now() - clock,
      serverTime: ran.serverTime,
      query: plain(next) ? null : next,
    }));
    await closeResult(run.connection, old).catch(() => null);
    await sessionAgain(store, run.connection);
  } catch (thrown: unknown) {
    tell(store, id, message("error", failureText(failure(thrown))));
  } finally {
    changeWorksheet(store, id, (x) => ({ ...x, running: false }));
  }
}

/** Pins run `runId`'s result's tab, or not: one pinned stays open as the worksheet runs again. */
export function pinResult(store: Store, id: string, runId: number, pinned: boolean): void {
  changeRun(store, id, runId, (r) => ({ ...r, pinned }));
}

/** Closes run `runId`'s result, and lets the run go. */
export async function closeRun(store: Store, id: string, runId: number): Promise<void> {
  const run = runOf(store, id, runId);
  if (run === undefined) {
    return;
  }
  if (run.outcome?.kind === "rows") {
    await closeResult(run.connection, run.outcome.result).catch(() => null);
    await sessionAgain(store, run.connection);
  }
  changeWorksheet(store, id, (w) => ({
    ...w,
    runs: w.runs.filter((r) => r.id !== runId),
    shown: w.shown === runId ? null : w.shown,
  }));
}

/** The table INSERT statements copied of `sql`'s result insert into: the one table it reads, else RESULT. */
export function insertTable(sql: string): string {
  const tables = wordScope(sql).filter((s) => s.kind === "table" && s.name !== null);
  const [only] = tables;
  if (tables.length !== 1 || only?.name === null || only === undefined) {
    return "RESULT";
  }
  const name = only.name;
  return only.schema === null ? delimited(name) : `${delimited(only.schema)}.${delimited(name)}`;
}

/** Cells of a result chosen: the rows' places, and the columns'. */
export interface Chosen {
  readonly rows: readonly number[];
  readonly columns: readonly number[];
}

/** The cells `chosen` of run `run`. */
export function chosenCells(run: RunResult, chosen: Chosen): { columns: RunResult["columns"]; rows: Cell[][] } {
  const places = chosen.columns.filter((c) => c < run.columns.length);
  const columns = places.flatMap((c) => {
    const column = run.columns[c];
    return column === undefined ? [] : [column];
  });
  const rows = chosen.rows.flatMap((r) => {
    const row = run.rows[r];
    return row === undefined ? [] : [places.map((c) => row[c] ?? null)];
  });
  return { columns, rows };
}

/** Copies the cells `chosen` of run `runId` as `format`, with headers or not: told, a failure among them. */
export async function copyCells(
  store: Store,
  id: string,
  runId: number,
  { format, headers }: { format: CopyFormat; headers: boolean },
  chosen: Chosen,
): Promise<void> {
  const run = runOf(store, id, runId);
  if (run === undefined) {
    return;
  }
  try {
    const text = copied(format, chosenCells(run, chosen), { headers, table: insertTable(queryOf(run).sql) });
    await navigator.clipboard.writeText(text);
    tell(store, id, message("ok", `Copied ${String(chosen.rows.length)} rows.`));
  } catch (thrown: unknown) {
    tell(store, id, message("error", thrown instanceof Error ? thrown.message : String(thrown)));
    changeWorksheet(store, id, (w) => ({ ...w, pane: "messages" }));
  }
}

/** Exports the rows of `sql` on `connection` as `kind`, for worksheet `id`: told, where and how many, or why not. */
export async function exportRows(
  store: Store,
  id: string,
  { connection, sql }: { connection: number; sql: string },
  kind: ExportKind,
): Promise<void> {
  const title = worksheetOf(store.current(), id)?.title ?? "result";
  const name = title.replace(/\.sql$/iu, "").replaceAll(/[/\\\0]/gu, "_") || "result";
  try {
    const done = await exportQuery(connection, sql, kind, name);
    if (done !== null) {
      tell(store, id, message("ok", `Exported ${String(done.rows)} rows to ${done.path}.`));
    }
  } catch (thrown: unknown) {
    tell(store, id, message("error", failureText(failure(thrown))));
    changeWorksheet(store, id, (w) => ({ ...w, pane: "messages" }));
  }
}

/** Exports run `runId`'s result, its query run again as it is sorted and filtered. */
export async function exportResult(store: Store, id: string, runId: number, kind: ExportKind): Promise<void> {
  const run = runOf(store, id, runId);
  if (run === undefined) {
    return;
  }
  if (run.values.length > 0) {
    tell(store, id, message("error", "A statement of parameters is not exported: write its values in it."));
    return;
  }
  await exportRows(store, id, { connection: run.connection, sql: wrapped(queryOf(run), run.columns) }, kind);
}

/** Says, in the status bar, what `text` tells of the cells selected; null for none. */
export function showSummary(store: Store, text: string | null): void {
  if (store.current().cellSummary !== text) {
    store.update((now) => ({ ...now, cellSummary: text }));
  }
}
