/**
 * The sessions that wait, and who they wait on (RULES.md D57): of
 * CONNECTIONS, each session waiting on a lock, the log's sync or a
 * worker, with the lock and the session that holds it; that session
 * ended by End Connection, through the guards as every act is.
 */
import type { ViewRows } from "../ipc/admin";

/** The columns of CONNECTIONS a wait is read of. */
const ID = 0;
/** The statement a session runs. */
const STATEMENT = 6;
/** What a session waits on: LOCK, IO or WORKER. */
const WAITING_ON = 9;
/** The table or row waited for. */
const LOCK_NAME = 10;
/** The session holding it. */
const LOCK_HOLDER = 11;

/** A session that waits: its ID, on what, for what, held by whom, and its statement. */
export interface Wait {
  readonly id: string;
  readonly on: string;
  readonly lock: string | null;
  readonly holder: string | null;
  readonly statement: string | null;
}

/** The sessions of `sessions` that wait. */
export function waitsOf(sessions: ViewRows): Wait[] {
  return sessions.rows.flatMap((r) => {
    const on = r[WAITING_ON] ?? null;
    return on === null
      ? []
      : [
          {
            id: r[ID] ?? "",
            on,
            lock: r[LOCK_NAME] ?? null,
            holder: r[LOCK_HOLDER] ?? null,
            statement: r[STATEMENT] ?? null,
          },
        ];
  });
}

/** What a wait is told as. */
function told(w: Wait): string {
  const what =
    w.on === "LOCK" ? `a lock${w.lock === null ? "" : ` of ${w.lock}`}` : w.on === "IO" ? "the log's sync" : "a worker";
  return `Session ${w.id} waits on ${what}${w.holder === null ? "" : `, held by session ${w.holder}`}`;
}

/** The sessions of `sessions` that wait, each holder ended by `end`. */
export function Waits({ sessions, end }: { readonly sessions: ViewRows; readonly end: (id: number) => void }) {
  const waits = waitsOf(sessions);
  if (waits.length === 0) {
    return <p className="hint">No session waits.</p>;
  }
  return (
    <ul className="monitor-waits" aria-label="Waits">
      {waits.map((w) => (
        <li key={w.id}>
          <span title={w.statement ?? undefined}>{told(w)}</span>
          {w.holder !== null && (
            <button
              type="button"
              onClick={() => {
                end(Number(w.holder));
              }}
            >
              End Connection {w.holder}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
