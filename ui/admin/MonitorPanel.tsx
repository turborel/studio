/**
 * The monitor (RULES.md D57): the active connection's server and
 * database, read of Turborel's own views and read again as often as
 * chosen: its sessions, each cancelled or ended; the server's counters,
 * drawn over the time the panel is open; the jobs; the files; the
 * memory's reservations; the backups, archived segments and restore
 * points; the replica group; the settings, each set for the session or
 * the database, or given its default; and the plug-ins, an embedded
 * database's as Studio gave them (D59), and the extensions.
 */
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { ViewName, ViewRows } from "../ipc/admin";
import { adminView } from "../ipc/admin";
import type { ColumnInfo } from "../ipc/connections";
import { chartData } from "../results/chart";
import { Drawing, Legend } from "../results/ChartView";
import { isStudioError } from "../state/actions";
import { useStore, useStudio } from "../state/store";
import { runAct } from "./admin";
import { PlugIns } from "./PlugIns";
import "./admin.css";

/** The monitor's tabs, each with its name. */
export const TABS = [
  ["sessions", "Sessions"],
  ["server", "Server"],
  ["jobs", "Jobs"],
  ["files", "Files"],
  ["memory", "Memory"],
  ["backups", "Backups"],
  ["replication", "Replication"],
  ["settings", "Settings"],
  ["plugIns", "Plug-ins"],
] as const;

/** A tab's identifier. */
export type MonitorTab = (typeof TABS)[number][0];

/** The intervals the monitor reads its views again at, in seconds; 0 for never. */
export const INTERVALS = [0, 1, 2, 5, 10, 30] as const;

/** The server's counters drawn, of SERVER's columns. */
const DRAWN = ["WORKERS_BUSY", "STATEMENTS_WAITING", "CONNECTIONS"];
/** The most samples of the counters kept. */
export const MAX_SAMPLES = 120;

/** What a view read gave: its rows, or why not. */
type Read = ViewRows | string | null;

/** The rows of `view` on `connection`, read again as `tick` changes. */
function useView(connection: number, view: ViewName, tick: number): Read {
  const [read, setRead] = useState<Read>(null);
  useEffect(() => {
    let current = true;
    adminView(connection, view).then(
      (rows) => {
        if (current) {
          setRead(rows);
        }
      },
      (thrown: unknown) => {
        if (current) {
          setRead(isStudioError(thrown) ? thrown.message : String(thrown));
        }
      },
    );
    return () => {
      current = false;
    };
  }, [connection, view, tick]);
  return read;
}

/** What is shown of a view with no rows to show: absent, or none. */
function NoRows({ absent }: { readonly absent: boolean }) {
  return absent ? (
    <p className="hint">
      The database has not this view: an embedded database has no server, so no server&apos;s sessions or counters.
    </p>
  ) : (
    <p className="hint">No rows. Only the database&apos;s owner sees the server&apos;s and the database&apos;s rows.</p>
  );
}

/** The rows of a view as a table, each row's acts after it. */
function RowsTable(props: {
  readonly read: Read;
  readonly label: string;
  readonly acts?: (row: readonly (string | null)[]) => ReactNode;
}) {
  const { read } = props;
  if (read === null) {
    return <p className="hint">Reading…</p>;
  }
  if (typeof read === "string") {
    return <p className="error">{read}</p>;
  }
  if (read.absent || read.rows.length === 0) {
    return <NoRows absent={read.absent} />;
  }
  return (
    <div className="monitor-table">
      <table className="details-table" aria-label={props.label}>
        <thead>
          <tr>
            {read.columns.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
            {props.acts !== undefined && <th scope="col">Acts</th>}
          </tr>
        </thead>
        <tbody>
          {read.rows.map((row, r) => (
            <tr key={`r${String(r)}`}>
              {row.map((cell, c) => (
                <td key={read.columns[c] ?? String(c)}>{cell ?? "NULL"}</td>
              ))}
              {props.acts !== undefined && <td>{props.acts(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A session's acts: its statement cancelled, its connection ended. */
function SessionActs(props: {
  readonly row: readonly (string | null)[];
  readonly onAct: (kind: "cancelConnection" | "endConnection", id: number) => void;
}) {
  const id = Number(props.row[0]);
  return (
    <>
      <button
        type="button"
        disabled={props.row[4] !== "RUNNING"}
        onClick={() => {
          props.onAct("cancelConnection", id);
        }}
      >
        Cancel Statement
      </button>
      <button
        type="button"
        className="danger"
        onClick={() => {
          props.onAct("endConnection", id);
        }}
      >
        End Connection
      </button>
    </>
  );
}

/** The sessions, each cancelled or ended, and their clients' attributes. */
function Sessions({
  connection,
  tick,
  onAct,
}: {
  readonly connection: number;
  readonly tick: number;
  readonly onAct: () => void;
}) {
  const store = useStore();
  const sessions = useView(connection, "connections", tick);
  const attributes = useView(connection, "connectionAttributes", tick);
  const [told, setTold] = useState("");
  const act = (kind: "cancelConnection" | "endConnection", id: number) =>
    void runAct(store, connection, { kind, id }).then((outcome) => {
      setTold(outcome.kind === "failed" ? outcome.why : "");
      onAct();
    });
  return (
    <>
      {told !== "" && <p role="status">{told}</p>}
      <RowsTable read={sessions} label="Sessions" acts={(row) => <SessionActs row={row} onAct={act} />} />
      <p className="hint">The server tells each session&apos;s state, not the statement it runs.</p>
      <h4>Attributes of the clients</h4>
      <RowsTable read={attributes} label="Attributes" />
    </>
  );
}

/** The server's row, read again as `tick` changes, and its samples, each its time first, the latest last. */
function useSamples(connection: number, tick: number): [Read, readonly (readonly (string | null)[])[]] {
  const [read, setRead] = useState<Read>(null);
  const [samples, setSamples] = useState<readonly (readonly (string | null)[])[]>([]);
  useEffect(() => {
    let current = true;
    adminView(connection, "server").then(
      (rows) => {
        if (!current) {
          return;
        }
        setRead(rows);
        const [row] = rows.rows;
        if (row !== undefined) {
          setSamples((s) => [...s, [new Date().toLocaleTimeString(), ...row]].slice(-MAX_SAMPLES));
        }
      },
      (thrown: unknown) => {
        if (current) {
          setRead(isStudioError(thrown) ? thrown.message : String(thrown));
        }
      },
    );
    return () => {
      current = false;
    };
  }, [connection, tick]);
  return [read, samples];
}

/** The server's counters now, and drawn over the time the panel is open. */
function Server({ connection, tick }: { readonly connection: number; readonly tick: number }) {
  const [read, samples] = useSamples(connection, tick);
  const names = typeof read === "object" && read !== null ? read.columns : null;
  const columns: ColumnInfo[] = useMemo(
    () =>
      ["TIME", ...(names ?? [])].map((name) => ({ name, typeWritten: "INTEGER", typeName: "INTEGER", notNull: false })),
    [names],
  );
  const data = samples.length < 2 ? null : chartData(columns, samples, { kind: "line", label: "TIME", values: DRAWN });
  return (
    <>
      <RowsTable read={read} label="Server" />
      {data === null ? (
        <p className="hint">The counters are drawn once read twice.</p>
      ) : typeof data === "string" ? (
        <p className="hint">{data}</p>
      ) : (
        <figure className="monitor-chart" aria-label="The server's counters over time">
          <Legend data={data} />
          <Drawing data={data} kind="line" />
        </figure>
      )}
    </>
  );
}

/** Views of one tab, each its own table. */
function Views({
  connection,
  tick,
  views,
}: {
  readonly connection: number;
  readonly tick: number;
  readonly views: readonly (readonly [ViewName, string])[];
}) {
  return (
    <>
      {views.map(([view, name]) => (
        <section key={view} aria-label={name}>
          {views.length > 1 && <h4>{name}</h4>}
          <ViewTable connection={connection} tick={tick} view={view} name={name} />
        </section>
      ))}
    </>
  );
}

/** One view's table. */
function ViewTable(props: {
  readonly connection: number;
  readonly tick: number;
  readonly view: ViewName;
  readonly name: string;
}) {
  const read = useView(props.connection, props.view, props.tick);
  if (props.view === "replicas" && typeof read === "object" && read?.absent === true) {
    return <p className="hint">This database is in no replica group.</p>;
  }
  return <RowsTable read={read} label={props.name} />;
}

/** The buttons that set a setting for the session or the database, or give it its default. */
function SetButtons(props: {
  readonly sessionSettable: boolean;
  readonly set: (database: boolean, toDefault: boolean) => void;
}) {
  const acts: readonly (readonly [string, boolean, boolean])[] = [
    ["Set for Session", false, false],
    ["Session Default", false, true],
    ["Set for Database", true, false],
    ["Database Default", true, true],
  ];
  return (
    <div className="dialog-buttons">
      {acts.map(([label, database, toDefault]) => (
        <button
          key={label}
          type="button"
          disabled={!database && !props.sessionSettable}
          onClick={() => {
            props.set(database, toDefault);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** The setting chosen's editor: its value set for the session or the database, or its default. */
function SettingEditor(props: {
  readonly connection: number;
  readonly row: readonly (string | null)[];
  readonly onAct: () => void;
}) {
  const store = useStore();
  const [, current, , , kind, sessionSettable, takesEffect, description] = props.row;
  const name = props.row[0] ?? "";
  const [value, setValue] = useState(current ?? "");
  const [told, setTold] = useState("");
  const set = (database: boolean, toDefault: boolean) =>
    void runAct(store, props.connection, {
      kind: database ? "setDatabase" : "setSession",
      name,
      value: toDefault ? { kind: "default" } : { kind: "value", value, integer: (kind ?? "").startsWith("INTEGER") },
    }).then((outcome) => {
      setTold(outcome.kind === "failed" ? outcome.why : outcome.kind === "done" ? `${name} is set.` : "");
      props.onAct();
    });
  return (
    <fieldset className="monitor-setting">
      <legend>{name}</legend>
      <p className="hint">
        {description ?? ""} Takes {kind ?? "a value"}; a change takes effect {(takesEffect ?? "").toLowerCase()}.
      </p>
      <label className="field">
        <span>Value</span>
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
        />
      </label>
      <SetButtons sessionSettable={sessionSettable === "YES"} set={set} />
      {told !== "" && <p role="status">{told}</p>}
    </fieldset>
  );
}

/** The settings, filtered, one chosen to be set. */
function Settings({
  connection,
  tick,
  onAct,
}: {
  readonly connection: number;
  readonly tick: number;
  readonly onAct: () => void;
}) {
  const read = useView(connection, "settings", tick);
  const [filter, setFilter] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  if (typeof read !== "object" || read === null) {
    return <RowsTable read={read} label="Settings" />;
  }
  const shown = { ...read, rows: read.rows.filter((r) => (r[0] ?? "").toLowerCase().includes(filter.toLowerCase())) };
  const row = read.rows.find((r) => r[0] === chosen);
  return (
    <>
      <label className="field">
        <span>Filter the settings</span>
        <input
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
          }}
        />
      </label>
      {row !== undefined && <SettingEditor key={chosen} connection={connection} row={row} onAct={onAct} />}
      <RowsTable
        read={shown}
        label="Settings"
        acts={(r) => (
          <button
            type="button"
            onClick={() => {
              setChosen(r[0] ?? null);
            }}
          >
            Change…
          </button>
        )}
      />
    </>
  );
}

/** The views of the backups' tab. */
const BACKUP_VIEWS: readonly (readonly [ViewName, string])[] = [
  ["backups", "Backups"],
  ["restorePoints", "Restore points"],
  ["archivedSegments", "Archived segments"],
];

/** The tab `tab`'s content. */
function TabContent({
  tab,
  connection,
  tick,
  onAct,
}: {
  readonly tab: MonitorTab;
  readonly connection: number;
  readonly tick: number;
  readonly onAct: () => void;
}) {
  switch (tab) {
    case "sessions":
      return <Sessions connection={connection} tick={tick} onAct={onAct} />;
    case "server":
      return <Server connection={connection} tick={tick} />;
    case "jobs":
      return <Views connection={connection} tick={tick} views={[["jobs", "Jobs"]]} />;
    case "files":
      return (
        <Views
          connection={connection}
          tick={tick}
          views={[
            ["files", "Files"],
            ["fileFormats", "Formats"],
          ]}
        />
      );
    case "memory":
      return <Views connection={connection} tick={tick} views={[["memoryReservations", "Memory reservations"]]} />;
    case "backups":
      return <Views connection={connection} tick={tick} views={BACKUP_VIEWS} />;
    case "replication":
      return <Views connection={connection} tick={tick} views={[["replicas", "Replica group"]]} />;
    case "settings":
      return <Settings connection={connection} tick={tick} onAct={onAct} />;
    case "plugIns":
      return (
        <PlugIns connection={connection}>
          <Views connection={connection} tick={tick} views={[["extensions", "Extensions"]]} />
        </PlugIns>
      );
  }
}

/** Reads again each `every` seconds, and as asked: the tick that says when. */
function useTick(every: number): [number, () => void] {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (every === 0) {
      return undefined;
    }
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, every * 1000);
    return () => {
      clearInterval(timer);
    };
  }, [every]);
  return [
    tick,
    () => {
      setTick((t) => t + 1);
    },
  ];
}

/** The monitor's head: the connection, Refresh, and how often it reads again. */
function Head(props: {
  readonly name: string | null;
  readonly every: number;
  readonly onEvery: (n: number) => void;
  readonly onRefresh: () => void;
}) {
  return (
    <div className="monitor-head">
      <span>{props.name}</span>
      <button type="button" onClick={props.onRefresh}>
        Refresh
      </button>
      <label className="field">
        <span>Read again every</span>
        <select
          value={props.every}
          onChange={(e) => {
            props.onEvery(Number(e.target.value));
          }}
        >
          {INTERVALS.map((i) => (
            <option key={i} value={i}>
              {i === 0 ? "never" : `${String(i)} s`}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** The monitor of the active connection. */
export function MonitorPanel() {
  const connection = useStudio((s) => s.active);
  const name = useStudio((s) => s.open.find((c) => c.id === s.active)?.name ?? null);
  const [tab, setTab] = useState<MonitorTab>("sessions");
  const [every, setEvery] = useState<number>(5);
  const [tick, again] = useTick(every);
  if (connection === null) {
    return <div className="panel-empty">Open a connection to monitor its server.</div>;
  }
  return (
    <div className="panel monitor-panel" role="region" aria-label="Monitor">
      <Head name={name} every={every} onEvery={setEvery} onRefresh={again} />
      <div role="tablist" className="tabs">
        {TABS.map(([t, title]) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
            }}
          >
            {title}
          </button>
        ))}
      </div>
      <TabContent key={`${String(connection)}.${tab}`} tab={tab} connection={connection} tick={tick} onAct={again} />
    </div>
  );
}
