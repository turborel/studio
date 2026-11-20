/**
 * What the worksheet's commands do (RULES.md D30, D36), on the active
 * worksheet and its editor: run, explain, format, bookmarks, case, files,
 * favourites and the history. The commands registry runs them by name.
 */
import { toggleComment } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { activateHover } from "@codemirror/view";
import { saveTextFile } from "../ipc/catalog";
import { setAutocommit } from "../ipc/connections";
import { keepQuery, openSqlFile, readSqlFile, splitScript, writeSqlFile } from "../ipc/worksheet";
import { connectSaved, isStudioError, session, show } from "../state/actions";
import { select } from "../state/catalog";
import { explain, runOnConnections, runStatements, stopRun, type ToRun } from "../state/running";
import type { Store } from "../state/store";
import {
  changeWorksheet,
  closeOthers,
  closeWorksheet,
  openWorksheet,
  reopenWorksheet,
  worksheetOf,
} from "../state/worksheets";
import { formatWords } from "./dialect";
import { changeCase, formatScript, goToBookmark, selected, statementAtCursor, toggleBookmark } from "./editor/actions";
import { connectionOf, tableDetail, tableNamed } from "./editor/catalog";
import { viewOf } from "./editor/views";

/** The active worksheet's identifier and editor, if one is shown. */
function active(store: Store): { id: string; view: ReturnType<typeof viewOf> } | null {
  const id = store.current().activeWorksheet;
  return id === null ? null : { id, view: viewOf(id) };
}

/** Whether a worksheet is active. */
export function hasWorksheet(store: Store): boolean {
  return store.current().activeWorksheet !== null;
}

/** The statements of `text`, which begins at `from` in the worksheet, each by its place there. */
async function statementsOf(text: string, from: number): Promise<ToRun[]> {
  const pieces = await splitScript(text);
  return pieces.map((p) => ({ sql: p.statement.text, from: from + p.from, to: from + p.to, class: p.statement.class }));
}

/** The statement at `view`'s cursor: as last split, or split now if the text has not been yet. */
async function atCursor(view: NonNullable<ReturnType<typeof viewOf>>): Promise<ToRun | undefined> {
  const known = statementAtCursor(view);
  if (known !== undefined) {
    return { sql: known.statement.text, from: known.from, to: known.to, class: known.statement.class };
  }
  const head = view.state.selection.main.head;
  const all = await statementsOf(view.state.doc.toString(), 0);
  return all.find((s) => s.from <= head && head <= s.to) ?? all.filter((s) => s.to <= head).at(-1) ?? all[0];
}

/** Runs the selection's statements, or the statement at the cursor. */
export async function runCurrent(store: Store): Promise<void> {
  const at = active(store);
  if (at?.view === undefined) {
    return;
  }
  const chosen = selected(at.view);
  if (chosen !== null) {
    await runStatements(store, at.id, await statementsOf(chosen.text, chosen.from));
    return;
  }
  const statement = await atCursor(at.view);
  if (statement !== undefined) {
    await runStatements(store, at.id, [statement]);
  }
}

/** Runs every statement of the worksheet, in turn. */
export async function runScript(store: Store): Promise<void> {
  const at = active(store);
  if (at?.view !== undefined) {
    await runStatements(store, at.id, await statementsOf(at.view.state.doc.toString(), 0));
  }
}

/** Shows the plan of the statement at the cursor; EXPLAIN ANALYZE runs it. */
export async function explainCurrent(store: Store, analyze: boolean): Promise<void> {
  const at = active(store);
  if (at?.view === undefined) {
    return;
  }
  const chosen = selected(at.view);
  const [first] = chosen === null ? [] : await statementsOf(chosen.text, chosen.from);
  const statement = first ?? (await atCursor(at.view));
  if (statement !== undefined) {
    await explain(store, at.id, statement, analyze);
  }
}

/** Stops the active worksheet's run. */
export async function stopCurrent(store: Store): Promise<void> {
  const at = active(store);
  if (at !== null) {
    await stopRun(store, at.id);
  }
}

/** Formats the active worksheet's selection, or its whole script, as the settings say. */
export function formatCurrent(store: Store): void {
  const view = active(store)?.view;
  if (view === undefined) {
    return;
  }
  const { settings, reservedWords } = store.current();
  formatScript(view, {
    keyWords: settings.formatKeyWords,
    indent: settings.formatIndent,
    lineWidth: settings.formatLineWidth,
    words: formatWords(reservedWords),
  });
}

/** Runs `act` on the active worksheet's editor, if one is shown. */
export function onEditor(store: Store, act: (view: NonNullable<ReturnType<typeof viewOf>>) => unknown): void {
  const view = active(store)?.view;
  if (view !== undefined) {
    act(view);
    view.focus();
  }
}

/** The editor's own commands, by name. */
export const EDITOR_ACTS = {
  comment: (store: Store) => {
    onEditor(store, toggleComment);
  },
  upper: (store: Store) => {
    onEditor(store, (v) => {
      changeCase(v, true);
    });
  },
  lower: (store: Store) => {
    onEditor(store, (v) => {
      changeCase(v, false);
    });
  },
  bookmark: (store: Store) => {
    onEditor(store, toggleBookmark);
  },
  nextBookmark: (store: Store) => {
    onEditor(store, (v) => {
      goToBookmark(v, false);
    });
  },
  previousBookmark: (store: Store) => {
    onEditor(store, (v) => {
      goToBookmark(v, true);
    });
  },
  find: (store: Store) => {
    onEditor(store, openSearchPanel);
  },
  describe: (store: Store) => {
    onEditor(store, (v) => {
      activateHover(v, v.state.selection.main.head, 1);
    });
  },
} as const;

/** Shows, in the details panel, the object named at the cursor: a table, a view or a routine of the catalog. */
export async function goToDefinition(store: Store): Promise<void> {
  const at = active(store);
  const view = at?.view;
  if (at === null || view === undefined) {
    return;
  }
  const word = view.state.wordAt(view.state.selection.main.head);
  const id = connectionOf({ store, worksheet: at.id });
  if (word === null || id === null) {
    return;
  }
  const { schema, table } = tableNamed(view.state.doc.toString(), view.state.sliceDoc(word.from, word.to));
  const detail = await tableDetail({ store, worksheet: at.id }, schema, table);
  if (detail !== null) {
    await select(store, id, { kind: "table", schema: detail.schema, name: detail.name });
    return;
  }
  const routine = Object.entries(store.current().catalogs[id]?.objects ?? {})
    .flatMap(([s, o]) => o.routines.map((r) => ({ schema: s, ...r })))
    .find((r) => r.name === table);
  if (routine !== undefined) {
    await select(store, id, {
      kind: "routine",
      schema: routine.schema,
      specific: routine.specific,
      name: routine.name,
    });
  }
}

/** Saves the active worksheet: to its file, or, if it has none or `as`, to one the dialog chooses. */
export async function saveCurrent(store: Store, as: boolean): Promise<void> {
  const id = store.current().activeWorksheet;
  const w = worksheetOf(store.current(), id);
  if (w === undefined) {
    return;
  }
  try {
    if (w.path !== null && !as) {
      await writeSqlFile(w.path, w.text);
      changeWorksheet(store, w.id, (x) => ({ ...x, modified: false }));
      return;
    }
    const name = w.title.toLowerCase().endsWith(".sql") ? w.title : `${w.title}.sql`;
    const path = await saveTextFile(name, w.text);
    if (path !== null) {
      const title = path.split(/[\\/]/u).at(-1) ?? name;
      changeWorksheet(store, w.id, (x) => ({ ...x, path, title, modified: false }));
    }
  } catch (thrown: unknown) {
    if (isStudioError(thrown)) {
      store.update((now) => ({ ...now, error: thrown }));
    }
  }
}

/** Opens a `.sql` file the dialog chooses, in a worksheet of its own. */
export async function openFile(store: Store): Promise<void> {
  const opened = await openSqlFile().catch(() => null);
  if (opened !== null) {
    const id = openWorksheet(store, opened.text, opened.name);
    changeWorksheet(store, id, (w) => ({ ...w, path: opened.path, modified: false }));
  }
}

/** Opens the file `path`, a project's, in a worksheet of its own, or the worksheet it is open in. */
export async function openPath(store: Store, path: string): Promise<void> {
  const open = store.current().worksheets.find((w) => w.path === path);
  if (open !== undefined) {
    store.update((now) => ({ ...now, activeWorksheet: open.id }));
    return;
  }
  try {
    const opened = await readSqlFile(path);
    const id = openWorksheet(store, opened.text, opened.name);
    changeWorksheet(store, id, (w) => ({ ...w, path: opened.path, modified: false }));
  } catch (thrown: unknown) {
    if (isStudioError(thrown)) {
      store.update((now) => ({ ...now, error: thrown }));
    }
  }
}

/** Asks for a name to keep the selection, or the statement at the cursor, as a favourite query. */
export function favouriteCurrent(store: Store): void {
  const view = active(store)?.view;
  if (view === undefined) {
    return;
  }
  const sql = selected(view)?.text ?? statementAtCursor(view)?.statement.text ?? view.state.doc.toString();
  if (sql.trim() !== "") {
    show(store, { kind: "favourite", sql });
  }
}

/** Keeps `sql` as the favourite query `name`. */
export async function keepFavourite(store: Store, name: string, sql: string): Promise<void> {
  try {
    const queries = await keepQuery({ id: crypto.randomUUID().replaceAll("-", ""), name, sql });
    store.update((now) => ({ ...now, queries, dialog: null }));
  } catch (thrown: unknown) {
    if (isStudioError(thrown)) {
      store.update((now) => ({ ...now, error: thrown }));
    }
  }
}

/** Makes each statement of the active worksheet's connection its own transaction, or not. */
export async function toggleAutocommit(store: Store): Promise<void> {
  const w = worksheetOf(store.current(), store.current().activeWorksheet);
  const connection = store.current().open.find((c) => c.id === w?.connection);
  if (connection !== undefined) {
    const next = await setAutocommit(connection.id, !connection.session.transaction.autocommit).catch(() => null);
    if (next !== null) {
      session(store, connection.id, next);
    }
  }
}

/** The worksheet's tab commands, by name. */
export const TAB_ACTS = {
  close: (store: Store) => {
    const id = store.current().activeWorksheet;
    if (id !== null) {
      closeWorksheet(store, id);
    }
  },
  closeOthers: (store: Store) => {
    const id = store.current().activeWorksheet;
    if (id !== null) {
      closeOthers(store, id);
    }
  },
  reopen: (store: Store) => {
    reopenWorksheet(store);
  },
  pin: (store: Store) => {
    const id = store.current().activeWorksheet;
    if (id !== null) {
      changeWorksheet(store, id, (w) => ({ ...w, pinned: !w.pinned }));
    }
  },
  split: (store: Store) => {
    const id = store.current().activeWorksheet;
    if (id !== null) {
      changeWorksheet(store, id, (w) => ({ ...w, split: !w.split }));
    }
  },
  outline: (store: Store) => {
    const id = store.current().activeWorksheet;
    if (id !== null) {
      changeWorksheet(store, id, (w) => ({ ...w, outline: !w.outline }));
    }
  },
} as const;

/** The folders of the saved connections, each as its path of folder names, outermost first, each once. */
export function savedFolders(store: Store): string[][] {
  const paths = new Map<string, string[]>();
  for (const { connection } of store.current().saved.connections) {
    for (let depth = 1; depth <= connection.folder.length; depth += 1) {
      const path = connection.folder.slice(0, depth);
      paths.set(path.join("\u0000"), path);
    }
  }
  return [...paths.values()].sort((a, b) => a.join(" / ").localeCompare(b.join(" / ")));
}

/** Runs the active worksheet's script on each saved connection of the folder `path`, or of a folder within it, each opened if not open. */
export async function runOnFolder(store: Store, path: readonly string[]): Promise<void> {
  const at = active(store);
  if (at?.view === undefined) {
    return;
  }
  const saved = store
    .current()
    .saved.connections.map((v) => v.connection)
    .filter((c) => path.every((name, i) => c.folder[i] === name));
  const connections: number[] = [];
  for (const connection of saved) {
    let open = store.current().open.find((c) => c.savedId === connection.id);
    if (open === undefined) {
      await connectSaved(store, connection, null);
      open = store.current().open.find((c) => c.savedId === connection.id);
    }
    if (open !== undefined) {
      connections.push(open.id);
    }
  }
  store.update((now) => ({ ...now, activeWorksheet: at.id }));
  await runOnConnections(store, at.id, await statementsOf(at.view.state.doc.toString(), 0), connections);
}
