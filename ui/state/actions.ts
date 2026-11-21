/**
 * What the front end does (RULES.md D31): each action calls the backend
 * through `ui/ipc/` (R-TS-3) and changes the store with what it gives. A
 * failure is kept as the state's error, which the window shows.
 */
import { listReports, type ReportList } from "../ipc/analyzer";
import { assistantAsked, assistantTold } from "../assistant/chat";
import { guestTold, hostTold } from "../live/live";
import {
  cancelStatement,
  closeConnection,
  type ConnectionSpec,
  type Guards,
  type Opened,
  openConnection,
  pingConnection,
  reconnect,
  runStatement,
  type SessionState,
  type StudioError,
} from "../ipc/connections";
import type { StudioEvent } from "../ipc/events";
import { type EmbeddedSpec, type Ending, openEmbedded, quitStudio } from "../ipc/embedded";
import { type FavouriteQuery, listQueries, projectFolders, sqlWords } from "../ipc/worksheet";
import { loadSettings, saveSettings, setAsideNotices, type Settings } from "../ipc/preferences";
import {
  deleteSavedConnection,
  keychainStatus,
  listSavedConnections,
  openSavedConnection,
  type PasswordChange,
  type KeychainStatus,
  type SavedConnection,
  type SavedList,
  saveConnection,
} from "../ipc/saved";
import type { Dialog, OpenConnection, Store, StudioState } from "./store";
import { tell } from "./worksheets";

/** Whether `thrown` is Studio's error, as the backend fails. */
export function isStudioError(thrown: unknown): thrown is StudioError {
  return typeof thrown === "object" && thrown !== null && "sqlstate" in thrown && "message" in thrown;
}

/** Runs `work`, keeping its failure as the state's error. */
export async function attempt<T>(store: Store, work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work();
  } catch (thrown: unknown) {
    const error: StudioError = isStudioError(thrown)
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
    store.update((now) => ({ ...now, error }));
    return undefined;
  }
}

/** Loads the settings, the saved connections, the keychain's status, Turborel's reserved words, the favourite queries, the reports and the project folders. */
export async function loadAll(store: Store): Promise<void> {
  // The files first, then what the keychain is asked of, which may be slow
  // to answer: each part kept as it comes, so one that did not, or is late,
  // leaves the others shown, and the files set aside told at once (D49).
  await Promise.all([loadFiles(store), loadKeyed(store)]);
}

/** Keeps each part of `parts` that came, by `keep`, and tells the first that did not. */
async function settled<T extends readonly unknown[]>(
  store: Store,
  parts: { readonly [K in keyof T]: Promise<T[K]> },
  keep: (now: StudioState, got: { readonly [K in keyof T]: T[K] | undefined }) => StudioState,
): Promise<void> {
  const results = await Promise.allSettled(parts);
  const got = results.map((r) => (r.status === "fulfilled" ? r.value : undefined)) as unknown as {
    readonly [K in keyof T]: T[K] | undefined;
  };
  store.update((now) => keep(now, got));
  const failed = results.find((r) => r.status === "rejected");
  if (failed !== undefined) {
    await attempt(store, () => Promise.reject(failed.reason as Error));
  }
}

/** Loads Studio's own files: the settings, the favourite queries, the project folders, the reports, and the reserved words; then tells the files set aside. */
async function loadFiles(store: Store): Promise<void> {
  await settled<[Settings, string[], FavouriteQuery[], string[], ReportList]>(
    store,
    [loadSettings(), sqlWords(), listQueries(), projectFolders(), listReports()],
    (now, [settings, reservedWords, queries, projects, reports]) => ({
      ...now,
      settings: settings ?? now.settings,
      reservedWords: reservedWords ?? now.reservedWords,
      queries: queries ?? now.queries,
      projects: projects ?? now.projects,
      reports: reports ?? now.reports,
    }),
  );
  await tellSetAside(store);
}

/** Loads the saved connections, whose passwords the keychain is asked of, and the keychain's status; then tells the files set aside. */
async function loadKeyed(store: Store): Promise<void> {
  await settled<[SavedList, KeychainStatus]>(
    store,
    [listSavedConnections(), keychainStatus()],
    (now, [saved, keychain]) => ({
      ...now,
      saved: saved ?? now.saved,
      keychain: keychain ?? now.keychain,
    }),
  );
  await tellSetAside(store);
}

/** Tells the files Studio set aside, as they did not fit, each once. */
export async function tellSetAside(store: Store): Promise<void> {
  const notices = await setAsideNotices().catch(() => []);
  if (notices.length > 0) {
    store.update((now) => ({ ...now, notices: [...now.notices, ...notices] }));
  }
}

/** Loads the saved connections again. */
export async function refreshSaved(store: Store): Promise<void> {
  await attempt(store, async () => {
    const saved = await listSavedConnections();
    store.update((now) => ({ ...now, saved }));
  });
}

/** Adds the connection `opened`, of `name`, as the active one. */
function opened(
  store: Store,
  opened: Opened,
  about: Pick<OpenConnection, "name" | "savedId" | "guards" | "colour">,
): void {
  const connection: OpenConnection = { ...about, id: opened.connection, session: opened.session, serverTime: null };
  // An in-memory database's badge says it is not saved; any other told is a notice.
  const told = opened.session.transport === "inMemory" ? null : opened.told;
  store.update((now) => ({
    ...now,
    notices: told === null ? now.notices : [...now.notices, `${about.name}: ${told}`],
    open: [...now.open, connection],
    active: connection.id,
    dialog: null,
    // A worksheet kept on this saved connection, or on none while none was open, runs on it.
    worksheets: now.worksheets.map((w) =>
      w.connection === null &&
      (w.savedConnection === about.savedId || (w.savedConnection === null && now.open.length === 0))
        ? { ...w, connection: connection.id, savedConnection: about.savedId }
        : w,
    ),
  }));
}

/** Opens the saved connection `saved`, proving `password` if given, else the keychain's. */
export async function connectSaved(store: Store, saved: SavedConnection, password: string | null): Promise<void> {
  await attempt(store, async () => {
    const made = await openSavedConnection(saved.id, password);
    const guards = { environment: saved.environment, readOnly: saved.readOnly };
    opened(store, made, { name: saved.name, savedId: saved.id, guards, colour: saved.colour });
    await refreshSaved(store);
  });
}

/** Opens a connection not saved, by `spec`, under `guards`. */
export async function connectSpec(
  store: Store,
  name: string,
  spec: ConnectionSpec,
  guards: Guards,
  password: string | null,
): Promise<void> {
  await attempt(store, async () => {
    const made = await openConnection(spec, guards, password);
    opened(store, made, { name, savedId: null, guards, colour: null });
  });
}

/** Opens or makes the embedded database `spec` says, as `about` names it (RULES.md D59). */
export async function connectEmbedded(
  store: Store,
  spec: EmbeddedSpec,
  about: Pick<OpenConnection, "name" | "savedId" | "guards" | "colour">,
): Promise<boolean> {
  const made = await attempt(store, () => openEmbedded(spec, about.guards));
  if (made !== undefined) {
    opened(store, made, about);
    await refreshSaved(store);
  }
  return made !== undefined;
}

/** Makes a database in memory, a scratch one nothing of which is saved. */
export async function newInMemory(store: Store): Promise<void> {
  const count = store.current().open.filter((c) => c.session.transport === "inMemory").length;
  const spec: EmbeddedSpec = {
    place: { kind: "memory" },
    create: true,
    keys: null,
    checksumKey: null,
    pluginDirectories: null,
    user: null,
  };
  const name = count === 0 ? "In-memory" : `In-memory ${String(count + 1)}`;
  await connectEmbedded(store, spec, {
    name,
    savedId: null,
    guards: { environment: "development", readOnly: false },
    colour: null,
  });
}

/** Ends connection `id` now, whatever its transaction: the backend rolls back what is left. */
export async function disconnectNow(store: Store, id: number): Promise<void> {
  await attempt(store, async () => {
    await closeConnection(id);
  });
  store.update((now) => {
    const open = now.open.filter((c) => c.id !== id);
    const worksheets = now.worksheets.map((w) => (w.connection === id ? { ...w, connection: null } : w));
    const catalogs = Object.fromEntries(Object.entries(now.catalogs).filter(([key]) => key !== String(id)));
    const selected = now.selected?.connection === id ? null : now.selected;
    return {
      ...now,
      open,
      catalogs,
      selected,
      worksheets,
      active: now.active === id ? (open[0]?.id ?? null) : now.active,
    };
  });
}

/** Ends connection `id`: first asked how its transaction ends, if one is open (RULES.md D59). */
export async function disconnect(store: Store, id: number): Promise<void> {
  const connection = store.current().open.find((c) => c.id === id);
  if (connection?.session.transaction.active === true) {
    show(store, { kind: "openTransactions", connections: [id], quitting: false });
    return;
  }
  await disconnectNow(store, id);
}

/** Ends each of `connections`' transactions as `ending` says, then ends them, or quits Studio if `quitting`. */
export async function endAndClose(
  store: Store,
  { connections, quitting }: { readonly connections: readonly number[]; readonly quitting: boolean },
  ending: Ending,
): Promise<void> {
  if (quitting) {
    await attempt(store, () => quitStudio(ending));
    return;
  }
  for (const id of connections) {
    await endTransaction(store, id, ending === "commit" ? "COMMIT" : "ROLLBACK");
    if (store.current().open.find((c) => c.id === id)?.session.transaction.active !== true) {
      await disconnectNow(store, id);
    }
  }
  show(store, null);
}

/** Quits as the user asked: first asked how each open transaction ends, if any is open (RULES.md D59). */
export async function quitAsked(store: Store): Promise<void> {
  const active = store
    .current()
    .open.filter((c) => c.session.transaction.active)
    .map((c) => c.id);
  if (active.length === 0) {
    await attempt(store, () => quitStudio("rollback"));
    return;
  }
  show(store, { kind: "openTransactions", connections: active, quitting: true });
}

/** Sets the session of connection `id`, as the server last told it. */
export function session(store: Store, id: number, session: SessionState): void {
  store.update((now) => ({ ...now, open: now.open.map((c) => (c.id === id ? { ...c, session } : c)) }));
}

/** Connects connection `id` again. */
export async function reconnectOpen(store: Store, id: number): Promise<void> {
  const made = await attempt(store, () => reconnect(id));
  if (made !== undefined) {
    session(store, id, made);
  }
}

/** Cancels the statement connection `id` runs. */
export async function cancel(store: Store, id: number): Promise<void> {
  await attempt(store, () => cancelStatement(id));
}

/** Ends connection `id`'s transaction by `statement`, COMMIT or ROLLBACK. */
export async function endTransaction(store: Store, id: number, statement: "COMMIT" | "ROLLBACK"): Promise<void> {
  const answer = await attempt(store, () => runStatement(id, statement, false));
  if (answer?.kind === "ran") {
    const { session: after, serverTime } = answer.answer;
    store.update((now) => ({
      ...now,
      open: now.open.map((c) => (c.id === id ? { ...c, session: after, serverTime } : c)),
    }));
  }
}

/** Makes connection `id` the active one. */
export function activate(store: Store, id: number): void {
  store.update((now) => ({ ...now, active: id }));
}

/** Shows `dialog`, or none. */
export function show(store: Store, dialog: Dialog | null): void {
  store.update((now) => ({ ...now, dialog }));
}

/** Forgets the error shown. */
export function dismissError(store: Store): void {
  store.update((now) => ({ ...now, error: null }));
}

/** Saves `connection`, its password as `password` says, and gives it as saved. */
export async function save(
  store: Store,
  connection: SavedConnection,
  password: PasswordChange,
): Promise<SavedConnection | undefined> {
  const made = await attempt(store, () => saveConnection(connection, password));
  await refreshSaved(store);
  return made;
}

/** Deletes the saved connection `id`. */
export async function forget(store: Store, id: string): Promise<void> {
  await attempt(store, () => deleteSavedConnection(id));
  await refreshSaved(store);
}

/** Changes the settings by `change`, and saves them. */
export async function changeSettings(store: Store, change: (now: Settings) => Settings): Promise<void> {
  const settings = change(store.current().settings);
  store.update((now) => ({ ...now, settings }));
  await attempt(store, () => saveSettings(settings));
}

/** Takes in an event the backend tells: a notice is told in the messages of the worksheet that runs on its connection. */
export function told(store: Store, event: StudioEvent): void {
  if (event.kind === "notice") {
    const now = store.current();
    const sheet =
      now.worksheets.find((w) => w.connection === event.connection && w.running) ??
      now.worksheets.find((w) => w.connection === event.connection);
    if (sheet !== undefined) {
      tell(store, sheet.id, {
        at: Date.now(),
        kind: "notice",
        text: `${event.sqlstate}: ${event.message}`,
        position: null,
      });
    }
  } else if (event.kind === "liveHost") {
    hostTold(store, event.event);
  } else if (event.kind === "liveGuest") {
    guestTold(store, event.event);
  } else if (event.kind === "assistant") {
    assistantTold(store, event.conversation, event.event);
  } else if (event.kind === "assistantAsks") {
    assistantAsked(store, event.conversation, event.id, event.question);
  } else if (event.kind === "liveLink") {
    // A link opens the join dialog filled in; nothing joins until Join.
    store.update((now) => ({ ...now, dialog: { kind: "liveJoin", opened: event.opened } }));
  } else if (event.kind === "quitAsked") {
    void quitAsked(store);
  } else if (event.kind === "sqlFile" || event.kind === "import") {
    // The dialog of the file's run, or of the import, listens for its progress itself.
  } else if (event.kind === "lost") {
    store.update((now) => ({
      ...now,
      open: now.open.map((c) => (c.id === event.connection ? { ...c, session: { ...c.session, lost: true } } : c)),
    }));
  } else {
    session(store, event.connection, event.session);
  }
}

/** Checks each open connection as the computer wakes, if the settings say, and connects a lost one again. */
export async function checkAfterWake(store: Store): Promise<void> {
  if (!store.current().settings.reconnectOnWake) {
    return;
  }
  for (const connection of store.current().open) {
    try {
      await pingConnection(connection.id);
    } catch {
      // A connection that does not answer is connected again, below.
    }
    const lost =
      connection.session.lost || store.current().open.find((c) => c.id === connection.id)?.session.lost === true;
    if (lost) {
      await reconnectOpen(store, connection.id);
    }
  }
}
