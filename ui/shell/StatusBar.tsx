/**
 * The status bar (RULES.md R-SEC-3, D32): the active connection, its
 * environment and colour, the session's user, schema and transaction as
 * the server told them, whether it is secure, and the server's time for
 * the last statement; and what the result's cells selected hold. A
 * connection not secure says so plainly.
 */
import type { SessionState, Transport } from "../ipc/connections";
import { openConnection, type OpenConnection, useStudio } from "../state/store";
import { ENVIRONMENT_NAMES } from "./environment";

/** How each transport is shown. */
const TRANSPORTS: Readonly<Record<Transport, string>> = {
  tls: "TLS",
  local: "Local socket",
  plain: "NOT SECURE",
};

/** The microseconds in a millisecond. */
const MICROS = 1000;

/** The transaction's state, as the status bar shows it. */
export function transactionState(session: SessionState): string {
  const access = session.transaction.readOnly ? ", read only" : "";
  if (session.transaction.active) {
    return `Transaction active${access}`;
  }
  return session.transaction.autocommit ? `Autocommit${access}` : `No transaction${access}`;
}

/** The parts of the status bar of `connection`. */
function parts(connection: OpenConnection): string[] {
  const { session } = connection;
  const shown = [`${connection.name} (${ENVIRONMENT_NAMES[connection.guards.environment]})`];
  shown.push(`${session.authorization}${session.schema === null ? "" : ` · ${session.schema}`}`);
  shown.push(transactionState(session));
  if (connection.guards.readOnly) {
    shown.push("Read-only connection");
  }
  if (session.serverReadOnly) {
    shown.push("Replica");
  }
  if (connection.serverTime !== null) {
    shown.push(`${(connection.serverTime.total / MICROS).toFixed(1)} ms`);
  }
  return shown;
}

/** The status bar. */
export function StatusBar() {
  const connection = useStudio((s) => openConnection(s, s.active));
  const cells = useStudio((s) => s.cellSummary);
  const summary = cells === null ? null : <span className="status-cells">{cells}</span>;
  if (connection === undefined) {
    return (
      <footer className="status-bar" role="status" aria-label="Status bar">
        Not connected
        {summary}
      </footer>
    );
  }
  const { transport, lost } = connection.session;
  return (
    <footer className="status-bar" role="status" aria-label="Status bar">
      {parts(connection).map((part) => (
        <span key={part}>{part}</span>
      ))}
      <span className={transport === "plain" ? "status-insecure" : "status-secure"}>{TRANSPORTS[transport]}</span>
      {lost && <span className="status-insecure">Connection lost: reconnect to go on</span>}
      {summary}
    </footer>
  );
}
