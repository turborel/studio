/**
 * Running a worksheet's statements (RULES.md D29, D36): its script
 * variables given values, the whole judged by the connection's guards and
 * confirmed if they ask, then each statement in turn, its parameters given
 * values, until one fails or the run is cancelled; each outcome kept, told
 * in the messages pane and the history.
 */
import {
  cancelStatement,
  closeResult,
  type Confirm,
  fetchRows,
  type Page,
  type Ran,
  runStatement,
  sessionState,
  type StatementClass,
  type StudioError,
} from "../ipc/connections";
import { judgeScript, notifyFinished, recordHistory } from "../ipc/worksheet";
import { showFailure } from "../worksheet/editor/actions";
import { viewOf } from "../worksheet/editor/views";
import { parsePlan } from "../plan/plan";
import { prompted } from "../shell/PromptDialog";
import { bound, substituted, variableNames } from "../worksheet/variables";
import { isStudioError, session } from "./actions";
import { asked, NONE_ASKED, valuesFor } from "./values";
import { loadSchemas } from "./catalog";
import type { Store } from "./store";
import {
  changeWorksheet,
  MAX_RUNS,
  MAX_TIMINGS,
  type Message,
  type RunResult,
  tell,
  type Timing,
  worksheetOf,
} from "./worksheets";

/** A statement to run, by its place in the worksheet's text. */
export interface ToRun {
  readonly sql: string;
  readonly from: number;
  readonly to: number;
  /** Its class, as split, if known: one that changes definitions or who may do what reads the catalog again after. */
  readonly class?: StatementClass;
}

/** The classes of statements after which the explorer reads the catalog again. */
const CHANGES_CATALOG: readonly StatementClass[] = ["changeSchema", "security", "unclassified"];

/** How many rows each fetch of a result asks for. */
export const FETCH_ROWS = 500;
/** The milliseconds of a second. */
const SECOND = 1000;

/** The worksheets whose run was asked to stop. */
const stopping = new Set<string>();

/** Studio's failure of `thrown`. */
export function failure(thrown: unknown): StudioError {
  return isStudioError(thrown)
    ? thrown
    : {
        sqlcode: -910,
        sqlstate: "TB910",
        message: thrown instanceof Error ? thrown.message : String(thrown),
        rule: null,
        position: null,
        active: false,
        diagnostics: null,
      };
}

/** `label` and `value`, if there is a value. */
function part(label: string, value: string | null | undefined): string | null {
  return value === null || value === undefined || value === "" ? null : `${label}${value}`;
}

/** A failure as the messages pane tells it: its SQLSTATE, SQLCODE and message, its rule, and its diagnostics' detail, hint and object. */
export function failureText(error: StudioError): string {
  const d = error.diagnostics;
  const about = [d?.schema, d?.table, d?.column].filter((p): p is string => typeof p === "string").join(".");
  const parts = [
    `${error.sqlstate} (${String(error.sqlcode)}): ${error.message}`,
    part("rule: ", error.rule),
    part("detail: ", d?.detail),
    part("hint: ", d?.hint),
    part("of ", about),
    part("constraint ", d?.constraint),
  ];
  return parts.filter((p) => p !== null).join("; ");
}

/** A message, now. */
export function message(kind: Message["kind"], text: string, position: number | null = null): Message {
  return { at: Date.now(), kind, text, position };
}

/** Asks the user about what the guards ask: whether to run. */
export function confirmed(store: Store, confirm: Confirm): Promise<boolean> {
  return new Promise((answer) => {
    store.update((now) => ({
      ...now,
      dialog: {
        kind: "guard",
        confirm,
        answer: (run) => {
          store.update((then) => ({ ...then, dialog: null }));
          answer(run);
        },
      },
    }));
  });
}

/** Closes worksheet `id`'s results, and lets its runs go. */
async function clearRuns(store: Store, id: string): Promise<void> {
  const w = worksheetOf(store.current(), id);
  for (const run of w?.runs ?? []) {
    if (run.outcome?.kind === "rows" && !run.pinned) {
      await closeResult(run.connection, run.outcome.result).catch(() => undefined);
    }
  }
  for (const connection of new Set((w?.runs ?? []).filter((r) => !r.pinned).map((r) => r.connection))) {
    await sessionAgain(store, connection);
  }
  changeWorksheet(store, id, (x) => {
    const kept = x.runs.filter((r) => r.pinned);
    return { ...x, runs: kept, shown: kept.some((r) => r.id === x.shown) ? x.shown : null };
  });
}

/**
 * Reads connection `connection`'s session again, as a result's last row read or its closing may end its
 * transaction under autocommit (CONFORMANCE.md S-CAP-17).
 */
export async function sessionAgain(store: Store, connection: number): Promise<void> {
  const now = await sessionState(connection).catch(() => null);
  if (now !== null) {
    session(store, connection, now);
  }
}

/** The number of worksheet `id`'s next run: past every run it keeps. */
function nextRun(store: Store, id: string): number {
  const runs = worksheetOf(store.current(), id)?.runs ?? [];
  return runs.reduce((most, r) => Math.max(most, r.id), 0) + 1;
}

/** The cells of `page` that are large objects not sent whole, as a run keeps them. */
export function lobKeys(page: Page): string[] {
  return page.lobs.map(([row, column]) => `${String(row)}:${String(column)}`);
}

/** Keeps `run`'s time and rows among worksheet `id`'s timings. */
function timed(store: Store, id: string, run: RunResult): void {
  const outcome = run.outcome;
  const rows = outcome === null ? null : outcome.kind === "rows" ? outcome.page.rowsRead : outcome.rowsAffected;
  const timing: Timing = {
    sql: run.sql,
    connection: run.connection,
    at: run.started,
    millis: run.millis ?? 0,
    serverMicros: run.serverTime?.total ?? null,
    rows,
    failed: run.error !== null,
  };
  changeWorksheet(store, id, (x) => ({ ...x, timings: [...x.timings, timing].slice(-MAX_TIMINGS) }));
}

/** The script variables of `statements` without a value in worksheet `id`. */
function unvalued(store: Store, id: string, statements: readonly ToRun[]): string[] {
  const values = worksheetOf(store.current(), id)?.variables ?? {};
  return [...new Set(statements.flatMap((s) => variableNames(s.sql)))].filter((n) => values[n] === undefined);
}

/** What the messages pane says of `ran`. */
function said(ran: Ran, millis: number): Message[] {
  const time =
    ran.serverTime === null
      ? `${String(Math.round(millis))} ms`
      : `${String(Math.round(ran.serverTime.total / SECOND))} ms on the server`;
  const outcome = ran.outcome;
  const what =
    outcome.kind === "rows"
      ? `${String(outcome.page.rowsRead)}${outcome.page.complete ? "" : "+"} rows`
      : outcome.rowsAffected === null
        ? "Done"
        : `${String(outcome.rowsAffected)} rows affected`;
  const generated =
    outcome.kind === "done" && outcome.generated.length > 0 ? `, generated ${outcome.generated.join(", ")}` : "";
  const warnings = ran.warnings.map((w) => message("warning", `${w.sqlstate} (${String(w.sqlcode)}): ${w.message}`));
  return [message("ok", `${what}${generated}, ${time}`), ...warnings];
}

/** Keeps `run` in the history, if the settings say. */
async function remember(store: Store, run: RunResult): Promise<void> {
  const now = store.current();
  const connection = now.open.find((c) => c.id === run.connection);
  if (!now.settings.historyKept || connection === undefined) {
    return;
  }
  const outcome = run.outcome;
  const rows = outcome === null ? null : outcome.kind === "rows" ? outcome.page.rowsRead : outcome.rowsAffected;
  const sqlstate = run.error?.sqlstate ?? (outcome?.kind === "done" ? outcome.sqlstate : "00000");
  await recordHistory({
    sql: run.sql,
    at: run.started,
    connection: connection.name,
    saved: connection.savedId,
    millis: Math.round(run.millis ?? 0),
    rows,
    sqlstate,
  }).catch(() => false);
}

/** A run of `statement`, as sent with `values`, before it has run. */
function begun(
  runId: number,
  statement: ToRun,
  { sent, values }: { sent: string; values: readonly (string | null)[] },
  connection: number,
): RunResult {
  return {
    id: runId,
    sql: sent,
    from: statement.from,
    to: statement.to,
    connection,
    started: Date.now(),
    millis: null,
    outcome: null,
    columns: [],
    rows: [],
    complete: true,
    warnings: [],
    error: null,
    serverTime: null,
    plan: null,
    values,
    lobs: [],
    pinned: false,
    query: null,
    editing: null,
  };
}

/** Keeps what `ran` gave of run `base`, and tells it. */
async function finished(store: Store, id: string, base: RunResult, ran: Ran, millis: number): Promise<void> {
  session(store, base.connection, ran.session);
  const outcome = ran.outcome;
  const rows =
    outcome.kind === "rows"
      ? {
          columns: outcome.columns,
          rows: outcome.page.rows,
          complete: outcome.page.complete,
          lobs: lobKeys(outcome.page),
        }
      : {};
  const done: RunResult = { ...base, millis, outcome, warnings: ran.warnings, serverTime: ran.serverTime, ...rows };
  changeWorksheet(store, id, (x) => ({
    ...x,
    runs: x.runs.map((r) => (r.id === base.id ? done : r)),
    pane: outcome.kind === "rows" ? "results" : x.pane,
  }));
  tell(store, id, ...said(ran, millis));
  timed(store, id, done);
  await remember(store, done);
}

/** Keeps `thrown`, run `base`'s failure, tells it, and shows its place in the editor. */
async function failed(store: Store, id: string, base: RunResult, thrown: unknown, millis: number): Promise<void> {
  const error = failure(thrown);
  const at = error.position === null ? null : base.from + error.position;
  changeWorksheet(store, id, (x) => ({
    ...x,
    runs: x.runs.map((r) => (r.id === base.id ? { ...base, millis, error } : r)),
    pane: "messages",
  }));
  tell(store, id, message("error", failureText(error), at));
  const view = viewOf(id);
  if (view !== undefined && at !== null) {
    showFailure(view, at);
  }
  timed(store, id, { ...base, millis, error });
  await remember(store, { ...base, millis, error });
}

/** Runs one statement of worksheet `id` on `connection`: whether the run goes on. */
async function runOne(store: Store, id: string, connection: number, statement: ToRun, runId: number): Promise<boolean> {
  const w = worksheetOf(store.current(), id);
  const { sql: sent, names } = bound(substituted(statement.sql, w?.variables ?? {}));
  const values = await valuesFor(store, id, connection, { sent, names });
  if (values === null) {
    tell(store, id, message("notice", "Not run: no values were given."));
    return false;
  }
  const base = begun(runId, statement, { sent, values }, connection);
  changeWorksheet(store, id, (x) => ({ ...x, runs: [...x.runs, base].slice(-MAX_RUNS), shown: runId }));
  const clock = performance.now();
  try {
    const answer = await runStatement(connection, sent, true, values);
    if (answer.kind === "confirm") {
      tell(store, id, message("error", "The guards asked again; nothing ran."));
      return false;
    }
    await finished(store, id, base, answer.answer, performance.now() - clock);
    await readPlan(store, id, runId, statement);
    return true;
  } catch (thrown: unknown) {
    await failed(store, id, base, thrown, performance.now() - clock);
    return false;
  }
}

/** Tells the user, if the window is in the background and the run was long, that it has finished. */
async function notifyIfLong(store: Store, id: string, millis: number): Promise<void> {
  const after = store.current().settings.notifyAfterSeconds;
  if (after === 0 || millis < after * SECOND || !document.hidden) {
    return;
  }
  const title = worksheetOf(store.current(), id)?.title ?? "A worksheet";
  await notifyFinished("Turborel Studio", `${title} has finished running.`).catch(() => null);
}

/** The connection worksheet `id` runs `statements` on, its script variables given values: null, told why, if it cannot run. */
async function ready(store: Store, id: string, statements: readonly ToRun[]): Promise<number | null> {
  const w = worksheetOf(store.current(), id);
  if (w === undefined || statements.length === 0 || w.running) {
    return null;
  }
  const connection = w.connection;
  if (connection === null || store.current().open.every((c) => c.id !== connection)) {
    tell(store, id, message("error", "The worksheet has no open connection: choose one."));
    return null;
  }
  const missing = unvalued(store, id, statements);
  if (missing.length > 0 && (await asked(store, id, NONE_ASKED, missing)) === null) {
    tell(store, id, message("notice", "Not run: no values were given."));
    return null;
  }
  return connection;
}

/** The connection each worksheet's run runs on now. */
const runningOn = new Map<string, number>();

/** Runs `statements` on `connection`, the guards asked first, until one fails or the run is stopped: the next run's number. */
async function runAll(
  store: Store,
  id: string,
  connection: number,
  statements: readonly ToRun[],
  first: number,
): Promise<number> {
  const values = worksheetOf(store.current(), id)?.variables ?? {};
  const script = statements.map((s) => substituted(s.sql, values)).join(";\n");
  const confirm = await judgeScript(connection, script);
  if (confirm !== null && !(await confirmed(store, confirm))) {
    tell(store, id, message("notice", "Not run: the run was not confirmed."));
    return first;
  }
  let next = first;
  runningOn.set(id, connection);
  for (const statement of statements) {
    if (stopping.has(id)) {
      break;
    }
    const ok = await runOne(store, id, connection, statement, next);
    next += 1;
    if (!ok) {
      break;
    }
  }
  if (
    statements.some((s) => s.class !== undefined && CHANGES_CATALOG.includes(s.class)) &&
    store.current().catalogs[connection] !== undefined
  ) {
    await loadSchemas(store, connection);
  }
  return next;
}

/** Runs `work` as worksheet `id`'s run: marked running, its failure told, its end notified if long. */
async function asRun(store: Store, id: string, work: () => Promise<void>): Promise<void> {
  changeWorksheet(store, id, (x) => ({ ...x, running: true }));
  stopping.delete(id);
  const clock = performance.now();
  try {
    await work();
  } catch (thrown: unknown) {
    const error = failure(thrown);
    tell(store, id, message("error", `${error.sqlstate} (${String(error.sqlcode)}): ${error.message}`));
    changeWorksheet(store, id, (x) => ({ ...x, pane: "messages" }));
  } finally {
    runningOn.delete(id);
    changeWorksheet(store, id, (x) => ({ ...x, running: false }));
    await notifyIfLong(store, id, performance.now() - clock);
  }
}

/** Whether worksheet `id` may run: one of no draft blocked for the assistant, or one whose word the user types (RULES.md D55). */
async function draftConfirmed(store: Store, id: string): Promise<boolean> {
  const draft = worksheetOf(store.current(), id)?.draft;
  if (draft?.blocked !== true) {
    return true;
  }
  const word = draft.confirm ?? "RUN";
  const typed = await prompted(
    store,
    "Run the Assistant's Draft",
    `It is blocked for the assistant. Type ${word} to run it yourself`,
  );
  return typed !== null && typed.toUpperCase() === word.toUpperCase();
}

/** Runs `statements` of worksheet `id`, in turn, as this module's header says. */
export async function runStatements(store: Store, id: string, statements: readonly ToRun[]): Promise<void> {
  if (!(await draftConfirmed(store, id))) {
    tell(store, id, message("notice", "Not run: the assistant's draft runs only once its word is typed."));
    return;
  }
  const connection = await ready(store, id, statements);
  if (connection === null) {
    return;
  }
  await asRun(store, id, async () => {
    await clearRuns(store, id);
    await runAll(store, id, connection, statements, nextRun(store, id));
  });
}

/**
 * Runs `statements` of worksheet `id` on each of `connections` in turn, each judged by its own guards, its results
 * its own: a failure on one ends the run on it, and the next is run on.
 */
export async function runOnConnections(
  store: Store,
  id: string,
  statements: readonly ToRun[],
  connections: readonly number[],
): Promise<void> {
  const w = worksheetOf(store.current(), id);
  if (w === undefined || w.running || statements.length === 0 || connections.length === 0) {
    return;
  }
  const missing = unvalued(store, id, statements);
  if (missing.length > 0 && (await asked(store, id, NONE_ASKED, missing)) === null) {
    tell(store, id, message("notice", "Not run: no values were given."));
    return;
  }
  await asRun(store, id, async () => {
    await clearRuns(store, id);
    let next = nextRun(store, id);
    for (const connection of connections) {
      if (stopping.has(id)) {
        break;
      }
      const name = store.current().open.find((c) => c.id === connection)?.name ?? String(connection);
      tell(store, id, message("notice", `On ${name}:`));
      next = await runAll(store, id, connection, statements, next);
    }
  });
}

/** Stops worksheet `id`'s run: the statement running is cancelled, and none after it runs. */
export async function stopRun(store: Store, id: string): Promise<void> {
  const w = worksheetOf(store.current(), id);
  const connection = runningOn.get(id) ?? w?.connection ?? null;
  if (w?.running !== true || connection === null) {
    return;
  }
  stopping.add(id);
  tell(store, id, message("notice", "Cancelling…"));
  await cancelStatement(connection).catch(() => null);
}

/** Reads more rows of run `runId`'s result, of worksheet `id`. */
export async function fetchMore(store: Store, id: string, runId: number): Promise<void> {
  const run = worksheetOf(store.current(), id)?.runs.find((r) => r.id === runId);
  if (run?.outcome?.kind !== "rows" || run.complete) {
    return;
  }
  try {
    const page = await fetchRows(run.connection, run.outcome.result, run.rows.length, FETCH_ROWS);
    changeWorksheet(store, id, (x) => ({
      ...x,
      runs: x.runs.map((r) =>
        r.id === runId
          ? { ...r, rows: [...r.rows, ...page.rows], complete: page.complete, lobs: [...r.lobs, ...lobKeys(page)] }
          : r,
      ),
    }));
    if (page.complete) {
      await sessionAgain(store, run.connection);
    }
  } catch (thrown: unknown) {
    const error = failure(thrown);
    tell(store, id, message("error", `${error.sqlstate} (${String(error.sqlcode)}): ${error.message}`));
  }
}

/**
 * Runs EXPLAIN of `statement`, which runs nothing, a data change's no more than a query's, or EXPLAIN ANALYZE, which
 * runs it, and shows its plan in worksheet `id`'s plan viewer.
 */
export async function explain(store: Store, id: string, statement: ToRun, analyze: boolean): Promise<void> {
  await runStatements(store, id, [{ ...statement, sql: `EXPLAIN ${analyze ? "ANALYZE " : ""}${statement.sql}` }]);
}

/**
 * EXPLAIN, or EXPLAIN ANALYZE, before a query or a data change, as Turborel reads it, comments and spaces before it:
 * what it explains. A data change is INSERT, UPDATE or DELETE, or MERGE before INTO or WITH (Turborel's
 * `sql/statements/explain.md`, its D980).
 */
const EXPLAINED =
  /^(?:\s+|--[^\n]*\n|\/\*[\s\S]*?\*\/)*EXPLAIN\s+(?:ANALYZE\s+)?(?:((?:INSERT|UPDATE|DELETE)\b[\s\S]*|MERGE\s+(?:INTO|WITH)\b[\s\S]*)|((?:SELECT|VALUES|TABLE|WITH|\()[\s\S]*))$/iu;

/** The statement `sql` explains, if it is EXPLAIN or EXPLAIN ANALYZE of one. */
export function explainedOf(sql: string): string | null {
  const found = EXPLAINED.exec(sql);
  return (found?.[1] ?? found?.[2])?.trim() ?? null;
}

/** Reads run `runId`'s plan whole, of EXPLAIN `statement`, and shows it in the plan viewer; its rows stay the result's. */
async function readPlan(store: Store, id: string, runId: number, statement: ToRun): Promise<void> {
  const run = worksheetOf(store.current(), id)?.runs.find((r) => r.id === runId);
  const explained = explainedOf(statement.sql);
  if (run?.outcome?.kind !== "rows" || explained === null || run.columns[0]?.name !== "PLAN") {
    return;
  }
  let rows = run.rows;
  let complete = run.complete;
  while (!complete) {
    const page = await fetchRows(run.connection, run.outcome.result, rows.length, FETCH_ROWS);
    rows = [...rows, ...page.rows];
    complete = page.complete;
  }
  const plan = parsePlan(rows.map((r) => r[0] ?? ""));
  changeWorksheet(store, id, (x) => ({
    ...x,
    runs: x.runs.map((r) => (r.id === runId ? { ...r, rows, complete, plan } : r)),
    plans: [...x.plans, plan].slice(-2),
    explained: { ...statement, sql: explained },
    whatIf: null,
    pane: "plan",
  }));
}
