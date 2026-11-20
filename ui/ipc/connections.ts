/**
 * The commands of connections and statements, typed as the backend gives
 * them (RULES.md D24, D25, R-TS-2). A password goes one way, from the
 * connection dialog to the backend, and never comes back (R-SEC-1).
 */
import { invoke } from "@tauri-apps/api/core";

/** A connection's settings, each a setting of turborel-client's by its name. */
export interface ConnectionSpec {
  uri?: string;
  host?: string;
  port?: string;
  user?: string;
  tlsMode?: string;
  channelBinding?: string;
  connectTimeout?: string;
  service?: string;
  serviceFile?: string;
  passfile?: string;
  target?: string;
  loadBalance?: string;
  tlsRoots?: string;
  tlsSystemRoots?: string;
  tlsCertificate?: string;
  tlsKey?: string;
  serverName?: string;
}

/** A failure's or a notice's diagnostics, as the server gave them. */
export interface Diagnostics {
  readonly severity: string | null;
  readonly detail: string | null;
  readonly hint: string | null;
  readonly context: string | null;
  readonly schema: string | null;
  readonly table: string | null;
  readonly column: string | null;
  readonly dataType: string | null;
  readonly constraint: string | null;
}

/** A failure, as the messages pane shows it (R-ERR-2). */
export interface StudioError {
  readonly sqlcode: number;
  readonly sqlstate: string;
  readonly message: string;
  readonly rule: string | null;
  readonly position: number | null;
  readonly active: boolean;
  readonly diagnostics: Diagnostics | null;
}

/** How a connection reaches its server (R-SEC-3). */
export type Transport = "tls" | "local" | "plain";

/** A session's transaction. */
export interface Transaction {
  readonly active: boolean;
  readonly autocommit: boolean;
  readonly readOnly: boolean;
}

/** A connection's session, as the status bar shows it. */
export interface SessionState {
  readonly server: string;
  readonly authorization: string;
  readonly schema: string | null;
  readonly catalog: string | null;
  readonly transaction: Transaction;
  readonly serverReadOnly: boolean;
  readonly owner: boolean;
  readonly transport: Transport;
  readonly lost: boolean;
}

/** A connection opened. */
export interface Opened {
  readonly connection: number;
  readonly session: SessionState;
}

/** A column of a result. */
export interface ColumnInfo {
  readonly name: string | null;
  readonly typeWritten: string;
  readonly typeName: string | null;
  readonly notNull: boolean;
}

/** A value as the grid shows it: its text, or null. */
export type Cell = string | null;

/** Rows of a result, from a place in it. */
export interface Page {
  readonly from: number;
  readonly rows: readonly (readonly Cell[])[];
  readonly rowsRead: number;
  readonly complete: boolean;
}

/** A statement's outcome. */
export type Outcome =
  | { readonly kind: "rows"; readonly result: number; readonly columns: readonly ColumnInfo[]; readonly page: Page }
  | {
      readonly kind: "done";
      readonly sqlcode: number;
      readonly sqlstate: string;
      readonly rowsAffected: number | null;
      readonly generated: readonly string[];
    };

/** The server's time for a statement, in microseconds. */
export interface ServerTime {
  readonly total: number;
  readonly queued: number;
  readonly locks: number;
}

/** What running a statement gave. */
export interface Ran {
  readonly outcome: Outcome;
  readonly warnings: readonly StudioError[];
  readonly serverTime: ServerTime | null;
  readonly session: SessionState;
}

/** A worker thread the manager holds. */
export interface ThreadInfo {
  readonly name: string;
  readonly connection: number;
}

/** A connection's environment, which sets its guards and colour. */
export type Environment = "development" | "test" | "production";

/** A connection's guards (RULES.md D29). */
export interface Guards {
  readonly environment: Environment;
  readonly readOnly: boolean;
}

/** What a statement is, from the least a guard weighs to the most. */
export type StatementClass =
  "read" | "transaction" | "session" | "writeRows" | "changeSchema" | "security" | "administration" | "unclassified";

/** Why a script needs the user's confirmation before it runs. */
export interface Confirm {
  readonly class: StatementClass;
  readonly destroys: readonly string[];
  readonly unclassified: readonly string[];
  readonly production: boolean;
}

/** What running a script answers: what it gave, or what to confirm. */
export type RunAnswer =
  { readonly kind: "ran"; readonly answer: Ran } | { readonly kind: "confirm"; readonly answer: Confirm };

/** Opens a connection under `guards`, proving `password` if given. */
export function openConnection(spec: ConnectionSpec, guards: Guards, password: string | null): Promise<Opened> {
  return invoke<Opened>("open_connection", { spec, guards, password });
}

/** Ends a connection. */
export function closeConnection(connection: number): Promise<null> {
  return invoke<null>("close_connection", { connection });
}

/** Connects a connection again, by the settings it was made by. */
export function reconnect(connection: number): Promise<SessionState> {
  return invoke<SessionState>("reconnect", { connection });
}

/** Cancels the statement a connection runs. */
export function cancelStatement(connection: number): Promise<null> {
  return invoke<null>("cancel_statement", { connection });
}

/**
 * Runs a statement through its connection's guards: one they ask about runs only once `confirmed`;
 * its dynamic parameters given `values`, as text or null, if it has any.
 */
export function runStatement(
  connection: number,
  sql: string,
  confirmed: boolean,
  values: readonly (string | null)[] = [],
): Promise<RunAnswer> {
  return invoke<RunAnswer>("run_statement", { connection, sql, confirmed, values });
}

/** At most `count` rows of a result, from row `from`. */
export function fetchRows(connection: number, result: number, from: number, count: number): Promise<Page> {
  return invoke<Page>("fetch_rows", { connection, result, from, count });
}

/** Closes a result. */
export function closeResult(connection: number, result: number): Promise<null> {
  return invoke<null>("close_result", { connection, result });
}

/** A connection's session. */
export function sessionState(connection: number): Promise<SessionState> {
  return invoke<SessionState>("session_state", { connection });
}

/** Makes each statement its own transaction, or not. */
export function setAutocommit(connection: number, on: boolean): Promise<SessionState> {
  return invoke<SessionState>("set_autocommit", { connection, on });
}

/** Asks whether a connection's server answers. */
export function pingConnection(connection: number): Promise<null> {
  return invoke<null>("ping_connection", { connection });
}

/** The connections' worker threads. */
export function listThreads(): Promise<ThreadInfo[]> {
  return invoke<ThreadInfo[]>("list_threads");
}
