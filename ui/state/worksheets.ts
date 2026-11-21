/**
 * The window's worksheets (RULES.md D36): each its text, the connection
 * it runs on, its runs and messages, the values its markers were given,
 * its bookmarks; made, closed, reopened and kept between sessions.
 */
import type { EditTarget, Edits } from "../results/edits";
import type { Query } from "../results/requery";
import type { Cell, ColumnInfo, Outcome, ServerTime, StudioError } from "../ipc/connections";
import { keepWorksheets, type KeptWorksheet, loadWorksheets, type Piece } from "../ipc/worksheet";
import type { Plan } from "../plan/plan";
import type { ToRun } from "./running";
import type { Chart } from "../ipc/analyzer";
import type { StudioState, Store } from "./store";

/** A statement run, and what it gave. */
export interface RunResult {
  readonly id: number;
  readonly sql: string;
  /** Where the statement was in the worksheet's text as it ran. */
  readonly from: number;
  readonly to: number;
  readonly connection: number;
  readonly started: number;
  /** How long it took, as the window measured it; null while it runs. */
  readonly millis: number | null;
  readonly outcome: Outcome | null;
  /** A result's columns and the rows read of it so far. */
  readonly columns: readonly ColumnInfo[];
  readonly rows: readonly (readonly Cell[])[];
  readonly complete: boolean;
  readonly warnings: readonly StudioError[];
  readonly error: StudioError | null;
  readonly serverTime: ServerTime | null;
  /** The plan, of EXPLAIN. */
  readonly plan: Plan | null;
  /** The values its dynamic parameters were given, so it is run again sorted or filtered with them. */
  readonly values: readonly (string | null)[];
  /** The cells of the rows read that are large objects not sent whole, each `row:column`. */
  readonly lobs: readonly string[];
  /** Whether its result's tab is pinned, so the worksheet's next run leaves it open. */
  readonly pinned: boolean;
  /** How its result is sorted and filtered, run again; null as written. */
  readonly query: Query | null;
  /** Its rows' edits staged, and the table they are made in, while its rows are edited. */
  readonly editing: Editing | null;
}

/** A result's rows being edited: the table, and what is staged. */
export interface Editing {
  readonly target: EditTarget;
  readonly edits: Edits;
}

/** A run's time and rows, kept so runs of a statement are compared. */
export interface Timing {
  readonly sql: string;
  readonly connection: number;
  readonly at: number;
  readonly millis: number;
  /** The server's time, in microseconds, where it tells it. */
  readonly serverMicros: number | null;
  /** The rows it gave or changed, if it says. */
  readonly rows: number | null;
  readonly failed: boolean;
}

/** A line of the messages pane. */
export interface Message {
  readonly at: number;
  readonly kind: "ok" | "warning" | "error" | "notice";
  readonly text: string;
  /** Where in the worksheet's text it is about, if anywhere. */
  readonly position: number | null;
}

/** A worksheet. */
export interface WorksheetState {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  /** The open connection it runs on. */
  readonly connection: number | null;
  /** The saved connection it runs on, kept between sessions. */
  readonly savedConnection: string | null;
  readonly pinned: boolean;
  readonly path: string | null;
  readonly modified: boolean;
  readonly runs: readonly RunResult[];
  readonly messages: readonly Message[];
  readonly running: boolean;
  /** The values given its script variables, by name. */
  readonly variables: Readonly<Record<string, string>>;
  /** The values last given its parameters, by name or `?n`. */
  readonly binds: Readonly<Record<string, string | null>>;
  /** Its bookmarked lines, numbered from 1. */
  readonly bookmarks: readonly number[];
  /** The result shown, by its run's identifier. */
  readonly shown: number | null;
  /** The part of its pane shown below the editor. */
  readonly pane: Pane;
  /** Whether its editor is split, a second view of its text below the first. */
  readonly split: boolean;
  /** Whether the outline of its statements is shown. */
  readonly outline: boolean;
  /** The plans shown last, the latest last, so two may be compared. */
  readonly plans: readonly Plan[];
  /** The statement the latest plan explains. */
  readonly explained: ToRun | null;
  /** The index a what-if made for the latest plan, and dropped after; null of a plan of no what-if. */
  readonly whatIf: string | null;
  /** The chart of the report the worksheet opened, its results first shown so. */
  readonly chart: Chart | null;
  /** The assistant's draft it holds, if one: blocked for the assistant, run only once its word is typed. */
  readonly draft: { readonly blocked: boolean; readonly confirm: string | null } | null;
  /** Its statements, as last split. */
  readonly pieces: readonly Piece[];
  /** Its runs' times and rows, the latest last. */
  readonly timings: readonly Timing[];
}

/** The parts of a worksheet's pane. */
export type Pane = "results" | "messages" | "plan" | "timings";

/** The most messages a worksheet keeps. */
export const MAX_MESSAGES = 500;
/** The most runs a worksheet keeps. */
export const MAX_RUNS = 50;
/** The most timings a worksheet keeps. */
export const MAX_TIMINGS = 500;
/** How long the worksheets wait, unchanged, before they are kept, in milliseconds. */
export const KEEP_AFTER_MS = 1000;
/** The title of a worksheet made new. */
export const UNTITLED = "Untitled";

/** A worksheet made new, of `text`, on `connection`. */
export function freshWorksheet(
  id: string,
  text: string,
  connection: number | null,
  savedConnection: string | null,
): WorksheetState {
  return {
    id,
    title: UNTITLED,
    text,
    connection,
    savedConnection,
    pinned: false,
    path: null,
    modified: text !== "",
    runs: [],
    messages: [],
    running: false,
    variables: {},
    binds: {},
    bookmarks: [],
    shown: null,
    pane: "results",
    split: false,
    outline: false,
    plans: [],
    explained: null,
    whatIf: null,
    chart: null,
    draft: null,
    pieces: [],
    timings: [],
  };
}

/** The worksheet `id` of `now`. */
export function worksheetOf(now: StudioState, id: string | null): WorksheetState | undefined {
  return now.worksheets.find((w) => w.id === id);
}

/** Changes worksheet `id` by `change`. */
export function changeWorksheet(store: Store, id: string, change: (w: WorksheetState) => WorksheetState): void {
  store.update((now) => ({ ...now, worksheets: now.worksheets.map((w) => (w.id === id ? change(w) : w)) }));
}

/** Adds `messages` to worksheet `id`'s, the oldest let go past `MAX_MESSAGES`. */
export function tell(store: Store, id: string, ...messages: Message[]): void {
  changeWorksheet(store, id, (w) => ({ ...w, messages: [...w.messages, ...messages].slice(-MAX_MESSAGES) }));
}

/** A new identifier. */
function newId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/** Opens a worksheet of `text`, titled `title`, on the active connection, and makes it the active one: its identifier. */
export function openWorksheet(store: Store, text = "", title = UNTITLED): string {
  const id = newId();
  store.update((now) => {
    const active = now.open.find((c) => c.id === now.active);
    const sheet = { ...freshWorksheet(id, text, active?.id ?? null, active?.savedId ?? null), title };
    return { ...now, worksheets: [...now.worksheets, sheet], activeWorksheet: id };
  });
  return id;
}

/** Closes worksheet `id`, kept to be reopened until the window closes. */
export function closeWorksheet(store: Store, id: string): void {
  store.update((now) => {
    const closed = worksheetOf(now, id);
    if (closed === undefined) {
      return now;
    }
    const worksheets = now.worksheets.filter((w) => w.id !== id);
    const activeWorksheet = now.activeWorksheet === id ? (worksheets.at(-1)?.id ?? null) : now.activeWorksheet;
    return {
      ...now,
      worksheets,
      activeWorksheet,
      closedWorksheets: [...now.closedWorksheets, closed].slice(-MAX_RUNS),
    };
  });
}

/** Opens again the worksheet closed last, if any. */
export function reopenWorksheet(store: Store): void {
  store.update((now) => {
    const last = now.closedWorksheets.at(-1);
    if (last === undefined) {
      return now;
    }
    return {
      ...now,
      worksheets: [...now.worksheets, last],
      closedWorksheets: now.closedWorksheets.slice(0, -1),
      activeWorksheet: last.id,
    };
  });
}

/** Closes every worksheet but `id` and the pinned. */
export function closeOthers(store: Store, id: string): void {
  for (const w of store.current().worksheets) {
    if (w.id !== id && !w.pinned) {
      closeWorksheet(store, w.id);
    }
  }
}

/** Makes worksheet `id` the active one. */
export function activateWorksheet(store: Store, id: string): void {
  store.update((now) => ({ ...now, activeWorksheet: id }));
}

/** Sets worksheet `id`'s text, as the editor changed it. */
export function setText(store: Store, id: string, text: string): void {
  changeWorksheet(store, id, (w) => (w.text === text ? w : { ...w, text, modified: true }));
}

/** Runs worksheet `id` on open connection `connection`. */
export function setConnection(store: Store, id: string, connection: number | null): void {
  const saved = store.current().open.find((c) => c.id === connection)?.savedId ?? null;
  changeWorksheet(store, id, (w) => ({ ...w, connection, savedConnection: saved }));
}

/** The worksheet as kept between sessions. */
export function kept(w: WorksheetState): KeptWorksheet {
  return {
    id: w.id,
    title: w.title,
    text: w.text,
    connection: w.savedConnection,
    pinned: w.pinned,
    path: w.path,
    modified: w.modified,
  };
}

/** Reads the worksheets kept, each on no connection until one of its saved connection opens. */
export async function restoreWorksheets(store: Store): Promise<void> {
  const loaded = await loadWorksheets().catch(() => []);
  store.update((now) => ({
    ...now,
    worksheets: loaded.map((k) => ({
      ...freshWorksheet(k.id, k.text, null, k.connection),
      title: k.title,
      pinned: k.pinned,
      path: k.path,
      modified: k.modified,
    })),
    activeWorksheet: loaded.at(-1)?.id ?? null,
  }));
}

/** Gives each worksheet of `savedId`'s saved connection, on none, the connection just opened. */
export function bindOpened(store: Store, savedId: string | null, connection: number): void {
  if (savedId === null) {
    return;
  }
  store.update((now) => ({
    ...now,
    worksheets: now.worksheets.map((w) =>
      w.connection === null && w.savedConnection === savedId ? { ...w, connection } : w,
    ),
  }));
}

/** Keeps the worksheets as they change, `KEEP_AFTER_MS` after the last change: what stops it. */
export function keepAsChanged(store: Store): () => void {
  let last = store.current().worksheets.map(kept);
  let pending: ReturnType<typeof setTimeout> | undefined;
  return store.subscribe(() => {
    const now = store.current().worksheets.map(kept);
    if (JSON.stringify(now) === JSON.stringify(last)) {
      return;
    }
    last = now;
    clearTimeout(pending);
    pending = setTimeout(() => void keepWorksheets(now).catch(() => undefined), KEEP_AFTER_MS);
  });
}
