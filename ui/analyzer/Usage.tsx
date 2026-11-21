/**
 * The analyzer's statistics (RULES.md D52, D57): the statements run since
 * the database opened, the costliest by total time first, each query's
 * plan a click away in the plan viewer; and of the schema, its indexes no
 * search used since the database opened, and its tables' and indexes'
 * sizes, as STATEMENT_STATISTICS, INDEX_STATISTICS and TABLE_STATISTICS
 * tell them.
 */
import { useEffect, useState } from "react";
import { adminView, type ViewName, type ViewRows } from "../ipc/admin";
import { openDdl } from "../data/ddlActions";
import { isStudioError } from "../state/actions";
import { useStore } from "../state/store";

/** The most statements the analyzer lists. */
export const MAX_STATEMENTS = 25;
/** The statements EXPLAIN takes: queries. */
const QUERY = /^\s*(?:SELECT|WITH|VALUES|TABLE|\()/iu;

/** What a view read gave: its rows, or why not, or none yet. */
type Read = ViewRows | string | null;

/** The rows of `view` on `connection`. */
function useRows(connection: number, view: ViewName): Read {
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
  }, [connection, view]);
  return read;
}

/** A table of `rows`' columns `shown`, each by its index, under `label`, each row's act after it. */
function Table(props: {
  readonly rows: readonly (readonly (string | null)[])[];
  readonly heads: readonly string[];
  readonly shown: readonly number[];
  readonly label: string;
  readonly act?: (row: readonly (string | null)[]) => React.ReactNode;
}) {
  return (
    <table className="details-table" aria-label={props.label}>
      <thead>
        <tr>
          {props.shown.map((c) => (
            <th key={c} scope="col">
              {props.heads[c]}
            </th>
          ))}
          {props.act !== undefined && <th scope="col">Plan</th>}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row, r) => (
          <tr key={`r${String(r)}`}>
            {props.shown.map((c) => (
              <td key={c}>{row[c] ?? "NULL"}</td>
            ))}
            {props.act !== undefined && <td>{props.act(row)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** What is shown while `read` is not rows: reading, or why not. */
function NotRows({ read }: { readonly read: string | null }) {
  return read === null ? <p className="hint">Reading…</p> : <p className="error">{read}</p>;
}

/** The statements run since the database opened, the costliest by total time first, each query's plan opened by Explain. */
export function TopStatements({ connection }: { readonly connection: number }) {
  const store = useStore();
  const read = useRows(connection, "statementStatistics");
  if (typeof read !== "object" || read === null) {
    return <NotRows read={read} />;
  }
  const rows = read.rows.slice(0, MAX_STATEMENTS);
  return (
    <>
      <p className="hint">
        Since the database opened; a statement&apos;s literals are written ?, and another user&apos;s text is shown only
        to the owner and a holder of the role MONITOR.
      </p>
      <Table
        rows={rows}
        heads={["Statement", "User", "Calls", "Total µs", "Mean µs", "Max µs", "Rows", "Rows read", "Bytes spilled"]}
        shown={[0, 1, 2, 3, 4, 5, 6, 7, 8]}
        label="Top statements by total time"
        act={(row) => {
          const text = row[0] ?? null;
          return text !== null && QUERY.test(text) ? (
            <button
              type="button"
              onClick={() =>
                void openDdl(store, connection, { sql: `EXPLAIN ${text}`, title: "Plan of a statement" }, true)
              }
            >
              Explain
            </button>
          ) : null;
        }}
      />
    </>
  );
}

/** The rows of `read` of schema `schema`, its first column the schema's. */
function ofSchema(read: ViewRows, schema: string): readonly (readonly (string | null)[])[] {
  return read.rows.filter((r) => r[0] === schema);
}

/** Of schema `schema`: its indexes unused since the database opened, and its tables' and indexes' sizes. */
export function Usage({ connection, schema }: { readonly connection: number; readonly schema: string }) {
  const indexes = useRows(connection, "indexStatistics");
  const tables = useRows(connection, "tableStatistics");
  if (typeof indexes !== "object" || indexes === null) {
    return <NotRows read={indexes} />;
  }
  if (typeof tables !== "object" || tables === null) {
    return <NotRows read={tables} />;
  }
  const mine = ofSchema(indexes, schema);
  const unused = mine.filter((r) => r[4] === "0");
  return (
    <>
      <h4>Indexes unused</h4>
      <p className="hint">
        Counted since the database opened or the index was made: an index a workload that has not run yet would use
        shows 0 too. Each costs its writes; judge one of a whole workload before dropping it.
      </p>
      {unused.length === 0 ? (
        <p className="hint">Every index of {schema} was searched.</p>
      ) : (
        <Table rows={unused} heads={indexes.columns} shown={[1, 2, 3, 6, 8]} label="Indexes unused" />
      )}
      <h4>Tables</h4>
      <Table rows={ofSchema(tables, schema)} heads={tables.columns} shown={[1, 2, 3, 4, 5, 6]} label="Table sizes" />
      <h4>Indexes</h4>
      <Table rows={mine} heads={indexes.columns} shown={[1, 2, 3, 4, 6, 7, 8]} label="Index sizes" />
    </>
  );
}
