import { mockIPC } from "@tauri-apps/api/mocks";
import {
  cancelStatement,
  closeConnection,
  closeResult,
  fetchRows,
  listThreads,
  openConnection,
  pingConnection,
  reconnect,
  runStatement,
  sessionState,
  setAutocommit,
} from "./connections";

/** Records each command asked, with its arguments, answering `answer`. */
function recording(answer: unknown = null): { command: string; args: unknown }[] {
  const asked: { command: string; args: unknown }[] = [];
  mockIPC((command, args) => {
    asked.push({ command, args });
    return answer;
  });
  return asked;
}

describe("the connection commands", () => {
  it("open a connection with its settings and a password that goes one way [RULE] R-SEC-1", async () => {
    const asked = recording({ connection: 1, session: {} });
    await openConnection({ host: "db.example", user: "ann", tlsMode: "verify-full" }, "secret");
    expect(asked).toEqual([
      {
        command: "open_connection",
        args: { spec: { host: "db.example", user: "ann", tlsMode: "verify-full" }, password: "secret" },
      },
    ]);
  });

  it("name each command and its arguments as the backend registers them [DESIGN] D24", async () => {
    const asked = recording();
    await closeConnection(1);
    await reconnect(1);
    await cancelStatement(1);
    await runStatement(1, "VALUES (1)");
    await fetchRows(1, 2, 500, 100);
    await closeResult(1, 2);
    await sessionState(1);
    await setAutocommit(1, true);
    await pingConnection(1);
    await listThreads();
    expect(asked.map((a) => a.command)).toEqual([
      "close_connection",
      "reconnect",
      "cancel_statement",
      "run_statement",
      "fetch_rows",
      "close_result",
      "session_state",
      "set_autocommit",
      "ping_connection",
      "list_threads",
    ]);
    expect(asked[4]?.args).toEqual({ connection: 1, result: 2, from: 500, count: 100 });
    expect(asked[7]?.args).toEqual({ connection: 1, on: true });
  });

  it("give the backend's failure as it is [RULE] R-ERR-2", async () => {
    const failure = { sqlcode: -910, sqlstate: "TB910", message: "connection 7 is not open" };
    mockIPC(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the backend rejects with Studio's error, not an Error
      throw failure;
    });
    await expect(runStatement(7, "VALUES (1)")).rejects.toEqual(failure);
  });
});
