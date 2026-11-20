/**
 * What the front end does (RULES.md D31): each action calls the backend
 * through `ui/ipc/` (R-TS-3) and changes the store with what it gives. A
 * failure is kept as the state's error, which the window shows.
 */
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
import { loadSettings, saveSettings, type Settings } from "../ipc/preferences";
import {
  deleteSavedConnection,
  keychainStatus,
  listSavedConnections,
  openSavedConnection,
  type PasswordChange,
  type SavedConnection,
  saveConnection,
} from "../ipc/saved";
import type { Dialog, OpenConnection, Store } from "./store";

/** Whether `thrown` is Studio's error, as the backend fails. */
export function isStudioError(thrown: unknown): thrown is StudioError {
  return typeof thrown === "object" && thrown !== null && "sqlstate" in thrown && "message" in thrown;
}

/** Runs `work`, keeping its failure as the state's error. */
async function attempt<T>(store: Store, work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work();
  } catch (thrown: unknown) {
    const error: StudioError = isStudioError(thrown)
      ? thrown
      : {
          sqlcode: -910,
          sqlstate: "TB910",
          message: String(thrown),
          rule: null,
          position: null,
          active: false,
          diagnostics: null,
        };
    store.update((now) => ({ ...now, error }));
    return undefined;
  }
}

/** Loads the settings, the saved connections and the keychain's status. */
export async function loadAll(store: Store): Promise<void> {
  await attempt(store, async () => {
    const [settings, saved, keychain] = await Promise.all([loadSettings(), listSavedConnections(), keychainStatus()]);
    store.update((now) => ({ ...now, settings, saved, keychain }));
  });
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
  store.update((now) => ({ ...now, open: [...now.open, connection], active: connection.id, dialog: null }));
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

/** Ends connection `id`. */
export async function disconnect(store: Store, id: number): Promise<void> {
  await attempt(store, async () => {
    await closeConnection(id);
  });
  store.update((now) => {
    const open = now.open.filter((c) => c.id !== id);
    return { ...now, open, active: now.active === id ? (open[0]?.id ?? null) : now.active };
  });
}

/** Sets the session of connection `id`. */
function session(store: Store, id: number, session: SessionState): void {
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

/** Takes in an event the backend tells. */
export function told(store: Store, event: StudioEvent): void {
  if (event.kind === "lost") {
    store.update((now) => ({
      ...now,
      open: now.open.map((c) => (c.id === event.connection ? { ...c, session: { ...c.session, lost: true } } : c)),
    }));
  } else if (event.kind === "session") {
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
