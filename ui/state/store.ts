/**
 * The window's store (RULES.md D31): the state every panel reads, held by
 * an object the window makes (R-SAFE-4), changed only through `update`,
 * and read in React through `useStudio`, so each component renders again
 * when what it reads changes.
 */
import { createContext, useContext, useSyncExternalStore } from "react";
import type { Guards, ServerTime, SessionState, StudioError } from "../ipc/connections";
import type { Settings } from "../ipc/preferences";
import { DEFAULT_SETTINGS } from "../ipc/preferences";
import type { KeychainStatus, SavedConnection, SavedList } from "../ipc/saved";
import type { CatalogState, Selected } from "../explorer/catalogState";

/** A connection open in this window. */
export interface OpenConnection {
  readonly id: number;
  readonly name: string;
  readonly savedId: string | null;
  readonly guards: Guards;
  readonly colour: string | null;
  readonly session: SessionState;
  readonly serverTime: ServerTime | null;
}

/** The dialog shown, if any. */
export type Dialog =
  | { readonly kind: "connection"; readonly editing: SavedConnection | null }
  | { readonly kind: "palette" }
  | { readonly kind: "settings" }
  | { readonly kind: "about" }
  | { readonly kind: "shortcuts" };

/** Everything the front end shows. */
export interface StudioState {
  readonly settings: Settings;
  readonly saved: SavedList;
  readonly keychain: KeychainStatus | null;
  readonly open: readonly OpenConnection[];
  readonly active: number | null;
  readonly dialog: Dialog | null;
  readonly error: StudioError | null;
  readonly catalogs: Readonly<Record<number, CatalogState>>;
  readonly selected: { readonly connection: number; readonly object: Selected } | null;
}

/** The state before anything is loaded. */
export const INITIAL: StudioState = {
  settings: DEFAULT_SETTINGS,
  saved: { connections: [], recent: [] },
  keychain: null,
  open: [],
  active: null,
  dialog: null,
  error: null,
  catalogs: {},
  selected: null,
};

/** The store of a window: its state, and who reads it. */
export class Store {
  private state: StudioState;
  private readonly listeners = new Set<() => void>();

  /** A store of `initial`. */
  constructor(initial: StudioState = INITIAL) {
    this.state = initial;
  }

  /** The state now. */
  current(): StudioState {
    return this.state;
  }

  /** Changes the state by `change`, and tells every reader. */
  update(change: (now: StudioState) => StudioState): void {
    this.state = change(this.state);
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Calls `listener` at each change, until the returned function is called. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** The window's store, as the components are given it. */
export const StoreContext = createContext<Store | null>(null);

/** The window's store. */
export function useStore(): Store {
  const store = useContext(StoreContext);
  if (store === null) {
    throw new Error("a component of the window is rendered outside its store");
  }
  return store;
}

/** What `select` reads of the window's state, rendered again as it changes. */
export function useStudio<T>(select: (now: StudioState) => T): T {
  const store = useStore();
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => select(store.current()),
  );
}

/** The connection open as `id`, if any. */
export function openConnection(now: StudioState, id: number | null): OpenConnection | undefined {
  return now.open.find((c) => c.id === id);
}
