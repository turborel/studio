/**
 * The one mock of the backend the front end's tests share (RULES.md
 * R-TEST-7): each command answered by a handler a test gives, or by the
 * answer every test starts from, and each call kept for the test to read.
 */
import { mockIPC } from "@tauri-apps/api/mocks";
import type { SessionState } from "../ipc/connections";
import { DEFAULT_SETTINGS } from "../ipc/preferences";

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
  app_info: () => ({ version: "0.0.0", turborelCommit: "3df14c1621d8063f12452a6c189017e34b8e9fd9" }),
  open_connection: () => ({ connection: 1, session: SESSION }),
  open_saved_connection: () => ({ connection: 1, session: SESSION }),
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
