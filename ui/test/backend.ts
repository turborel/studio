/**
 * The one mock of the backend the front end's tests share (RULES.md
 * R-TEST-7): each command answered by a handler a test gives, or by the
 * answer every test starts from, and each call kept for the test to read.
 */
import { mockIPC } from "@tauri-apps/api/mocks";
import type { SessionState } from "../ipc/connections";
import { DEFAULT_SETTINGS } from "../ipc/preferences";

/** The import formats, as the backend's plug-ins offer them (RULES.md D68). */
export const IMPORT_FORMATS = [
  { id: "csv", label: "CSV", extensions: ["csv", "txt"], takes: { header: true, delimited: true, sheets: false } },
  {
    id: "tsv",
    label: "Tab-separated",
    extensions: ["tsv", "tab", "txt"],
    takes: { header: true, delimited: true, sheets: false },
  },
  { id: "json", label: "JSON array", extensions: ["json"], takes: { header: false, delimited: false, sheets: false } },
  {
    id: "ndjson",
    label: "JSON, an object a line",
    extensions: ["ndjson", "jsonl"],
    takes: { header: false, delimited: false, sheets: false },
  },
  {
    id: "xlsx",
    label: "Excel workbook",
    extensions: ["xlsx"],
    takes: { header: true, delimited: false, sheets: true },
  },
];

/** A command asked of the backend, and its arguments. */
export interface Asked {
  readonly command: string;
  readonly args: Record<string, unknown>;
}

/** What a command answers with, given its arguments. */
export type Handler = (args: Record<string, unknown>) => unknown;

/** A session as a server over TLS tells it. */
export const SESSION: SessionState = {
  server: "turborel 0.0.0 (alpha)",
  authorization: "ANN",
  schema: "ANN",
  catalog: "TURBOREL",
  transaction: { active: false, autocommit: false, readOnly: false },
  serverReadOnly: false,
  owner: true,
  transport: "tls",
  lost: false,
};

/** The answers every test starts from. */
const DEFAULTS: Record<string, Handler> = {
  load_settings: () => DEFAULT_SETTINGS,
  save_settings: () => null,
  list_saved_connections: () => ({ connections: [], recent: [] }),
  keychain_status: () => ({ available: true, reason: null }),
  load_layout: () => null,
  save_layout: () => null,
  app_info: () => ({ version: "0.0.0", turborelCommit: "5863fe6521d3a2fc89fce6159295fabfca053c00" }),
  open_connection: () => ({ connection: 1, session: SESSION, told: null }),
  reconnect: () => SESSION,
  open_saved_connection: () => ({ connection: 1, session: SESSION, told: null }),
  sql_words: () => ["SELECT", "FROM", "WHERE", "VALUE", "INTEGER"],
  list_queries: () => [],
  project_folders: () => [],
  load_worksheets: () => [],
  split_script: () => [],
  search_history: () => [],
  record_history: () => true,
  judge_script: () => null,
  set_aside_notices: () => [],
  list_reports: () => ({ builtIn: [], own: [] }),
  import_formats: () => IMPORT_FORMATS,
  detect_import: () => null,
};

/** Mocks the backend with `handlers` over the defaults, and gives the calls made. */
export function mockBackend(handlers: Record<string, Handler> = {}): Asked[] {
  const asked: Asked[] = [];
  const all = { ...DEFAULTS, ...handlers };
  mockIPC(
    (command, args) => {
      const payload = (args ?? {}) as Record<string, unknown>;
      asked.push({ command, args: payload });
      const handler = all[command];
      if (handler === undefined) {
        return null;
      }
      return handler(payload);
    },
    { shouldMockEvents: true },
  );
  return asked;
}
