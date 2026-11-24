/**
 * The window's store (RULES.md D31): the state every panel reads, held by
 * an object the window makes (R-SAFE-4), changed only through `update`,
 * and read in React through `useStudio`, so each component renders again
 * when what it reads changes.
 */
import type { DebugState } from "../debugger/debugging";
import type { LinkOpened } from "../ipc/live";
import type { ModelDoc } from "../model/models";
import type { DataTask } from "../data/tasks";
import { createContext, useContext, useSyncExternalStore } from "react";
import type { ConnectionSpec, Guards, ServerTime, SessionState, StudioError } from "../ipc/connections";
import type { EmbeddedMode } from "../shell/embeddedForm";
import type { Settings } from "../ipc/preferences";
import { DEFAULT_SETTINGS } from "../ipc/preferences";
import type { KeychainStatus, SavedConnection, SavedList } from "../ipc/saved";
import type { CatalogState, Selected } from "../explorer/catalogState";
import type { Confirm } from "../ipc/connections";
import type { FavouriteQuery } from "../ipc/worksheet";
import type { Chart, ReportList } from "../ipc/analyzer";
import type { WhatIf } from "../analyzer/whatIf";
import type { OpenMenu } from "../shell/ContextMenu";
import { type Chat, newChat } from "../assistant/chat";
import { type LiveState, NO_LIVE } from "../live/live";
import type { SecurityForm } from "../admin/SecurityDialog";
import type { WorksheetState } from "./worksheets";

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
  | {
      readonly kind: "connection";
      readonly editing: SavedConnection | null;
      /** Settings the new connection begins with, as of a server found for a database another process holds. */
      readonly spec?: ConnectionSpec;
    }
  | { readonly kind: "embedded"; readonly mode: EmbeddedMode; readonly editing: SavedConnection | null }
  | {
      /** How the open transactions of `connections` end, before they are closed or Studio quits (RULES.md D59). */
      readonly kind: "openTransactions";
      readonly connections: readonly number[];
      readonly quitting: boolean;
    }
  | { readonly kind: "palette" }
  | { readonly kind: "settings" }
  | { readonly kind: "about" }
  | { readonly kind: "shortcuts" }
  | { readonly kind: "guard"; readonly confirm: Confirm; readonly answer: (run: boolean) => void }
  | {
      /** Explain Analyze of a data change, which runs it for real: analyzed then rolled back, kept, or not run (RULES.md D61). */
      readonly kind: "analyzeChange";
      readonly sql: string;
      readonly answer: (choice: "rollBack" | "keep" | "explain" | null) => void;
    }
  | {
      readonly kind: "values";
      readonly names: readonly string[];
      readonly types: readonly string[];
      /** Of a CALL, the OUT parameters, whose values come back in its row, each told as it is named. */
      readonly outputs: readonly string[];
      readonly remembered: Readonly<Record<string, string | null>>;
      readonly variables: readonly string[];
      readonly answer: (given: Given | null) => void;
    }
  | { readonly kind: "history" }
  | { readonly kind: "folders" }
  | { readonly kind: "favourite"; readonly sql: string }
  | { readonly kind: "data"; readonly task: DataTask }
  | { readonly kind: "builder"; readonly worksheet: string; readonly connection: number; readonly schema: string }
  | {
      readonly kind: "analyzer";
      readonly connection: number;
      readonly schema: string;
      /** The table it is of, if one: the findings and indexes of that table alone. */
      readonly table?: string;
      readonly tab?: "findings" | "indexes" | "settings";
    }
  | { readonly kind: "whatIf"; readonly whatIf: WhatIf }
  | { readonly kind: "report"; readonly sql: string; readonly chart: Chart | null }
  | { readonly kind: "assistantSettings" }
  | { readonly kind: "liveSettings" }
  | { readonly kind: "security"; readonly connection: number; readonly form: SecurityForm }
  | { readonly kind: "liveRecords" }
  | {
      readonly kind: "liveJoin";
      /** The invitation's link the platform opened Studio by, if it opened it so (RULES.md D66). */
      readonly opened?: LinkOpened;
    }
  | {
      readonly kind: "prompt";
      readonly title: string;
      readonly label: string;
      readonly initial: string;
      readonly answer: (value: string | null) => void;
    };

/** The values a statement's markers are given: its parameters' and its script variables'. */
export interface Given {
  readonly binds: Readonly<Record<string, string | null>>;
  readonly variables: Readonly<Record<string, string>>;
}

/** Everything the front end shows. */
export interface StudioState {
  readonly settings: Settings;
  readonly saved: SavedList;
  readonly keychain: KeychainStatus | null;
  readonly open: readonly OpenConnection[];
  readonly active: number | null;
  readonly dialog: Dialog | null;
  /** The context menu open, if any. */
  readonly menu: OpenMenu | null;
  readonly error: StudioError | null;
  readonly catalogs: Readonly<Record<number, CatalogState>>;
  readonly selected: { readonly connection: number; readonly object: Selected } | null;
  readonly worksheets: readonly WorksheetState[];
  readonly activeWorksheet: string | null;
  readonly closedWorksheets: readonly WorksheetState[];
  /** Turborel's reserved words, as its lexer reads them. */
  readonly reservedWords: readonly string[];
  readonly queries: readonly FavouriteQuery[];
  /** The reports: the built-in, then the user's own. */
  readonly reports: ReportList;
  readonly projects: readonly string[];
  /** What the status bar tells of the result's cells selected, if any are. */
  readonly cellSummary: string | null;
  /** What Studio tells, until each is dismissed: its files set aside, a database recovered as it opened. */
  readonly notices: readonly string[];
  /** The models open, each a tab, and the one active. */
  readonly models: readonly ModelDoc[];
  readonly activeModel: string | null;
  /** The assistant's conversation. */
  readonly chat: Chat;
  /** Live Sessions. */
  readonly live: LiveState;
  /** Whether the explorer shows its search of the catalog. */
  readonly explorerSearch: boolean;
  /** The user's home folder, which paths are shown beneath as `~`, once known. */
  readonly home: string | null;
  /** The routine debugged, if one is (RULES.md D73). */
  readonly debug: DebugState | null;
}

/** The state before anything is loaded. */
export const INITIAL: StudioState = {
  settings: DEFAULT_SETTINGS,
  saved: { connections: [], recent: [] },
  keychain: null,
  open: [],
  active: null,
  dialog: null,
  menu: null,
  error: null,
  catalogs: {},
  selected: null,
  worksheets: [],
  activeWorksheet: null,
  closedWorksheets: [],
  reservedWords: [],
  queries: [],
  reports: { builtIn: [], own: [] },
  projects: [],
  cellSummary: null,
  notices: [],
  models: [],
  activeModel: null,
  chat: newChat(),
  live: NO_LIVE,
  explorerSearch: false,
  home: null,
  debug: null,
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
