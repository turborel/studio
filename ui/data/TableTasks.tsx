/**
 * The small tasks of a table's data (RULES.md D42, D43): its rows opened
 * in a worksheet to be edited, the first so many or those a condition
 * keeps; and its rows exported to a file, as CSV or native rows.
 */
import { useState } from "react";
import { type ExportKind, exportQuery } from "../ipc/results";
import { beginEditing } from "../results/editing";
import { isStudioError } from "../state/actions";
import { runStatements } from "../state/running";
import type { Store } from "../state/store";
import { useStore } from "../state/store";
import { changeWorksheet, openWorksheet, worksheetOf } from "../state/worksheets";
import { Modal } from "../shell/Modal";
import { type TableOf, tableSql } from "./tasks";

/** The rows an edit opens at first. */
export const FIRST_ROWS = 200;

/** The query of `of`'s rows `where` keeps, at most `rows` of them. */
export function rowsQuery(of: TableOf, rows: number, where: string): string {
  const condition = where.trim() === "" ? "" : ` WHERE ${where.trim()}`;
  return `SELECT * FROM ${tableSql(of)}${condition} FETCH FIRST ${String(rows)} ROWS ONLY`;
}

/** Opens `of`'s rows in a worksheet of their own, runs its query, and begins editing them. */
export async function editRows(store: Store, of: TableOf, rows: number, where: string): Promise<void> {
  const sql = rowsQuery(of, rows, where);
  const id = openWorksheet(store, sql, `${of.table} rows`);
  changeWorksheet(store, id, (w) => ({ ...w, connection: of.connection }));
  await runStatements(store, id, [{ sql, from: 0, to: sql.length }]);
  const run = worksheetOf(store.current(), id)?.runs.at(-1);
  if (run?.outcome?.kind === "rows") {
    await beginEditing(store, id, run.id);
  }
}

/** Closes the dialog. */
function closer(store: Store): () => void {
  return () => {
    store.update((now) => ({ ...now, dialog: null }));
  };
}

/** A condition of the table's columns, and how many rows. */
function RowsChoices(props: {
  readonly rows: number;
  readonly where: string;
  readonly onRows?: (rows: number) => void;
  readonly onWhere: (where: string) => void;
}) {
  return (
    <>
      {props.onRows !== undefined && (
        <label className="field">
          First rows{" "}
          <input
            type="number"
            min={1}
            max={100000}
            value={props.rows}
            onChange={(e) => props.onRows?.(Math.min(100000, Math.max(1, Number(e.target.value))))}
          />
        </label>
      )}
      <label className="field">
        Where{" "}
        <input
          type="text"
          value={props.where}
          placeholder="a condition of the columns, or nothing for every row"
          onChange={(e) => {
            props.onWhere(e.target.value);
          }}
        />
      </label>
    </>
  );
}

/** The dialog that opens `of`'s rows to be edited. */
export function EditRowsDialog({ of }: { readonly of: TableOf }) {
  const store = useStore();
  const [rows, setRows] = useState(FIRST_ROWS);
  const [where, setWhere] = useState("");
  const close = closer(store);
  return (
    <Modal title={`Edit Rows of ${of.schema}.${of.table}`} onClose={close}>
      <RowsChoices rows={rows} where={where} onRows={setRows} onWhere={setWhere} />
      <p className="hint">
        <code>{rowsQuery(of, rows, where)}</code>
      </p>
      <div className="dialog-buttons">
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            close();
            void editRows(store, of, rows, where);
          }}
        >
          Edit
        </button>
      </div>
    </Modal>
  );
}

/** The query of `of`'s rows `where` keeps, every one. */
export function exportedQuery(of: TableOf, where: string): string {
  return `SELECT * FROM ${tableSql(of)}${where.trim() === "" ? "" : ` WHERE ${where.trim()}`}`;
}

/** The dialog that exports `of`'s rows to a file. */
export function ExportDialog({ of }: { readonly of: TableOf }) {
  const store = useStore();
  const [kind, setKind] = useState<ExportKind>("csv");
  const [where, setWhere] = useState("");
  const [told, setTold] = useState("");
  const close = closer(store);
  const run = async () => {
    try {
      const done = await exportQuery(of.connection, exportedQuery(of, where), kind, of.table);
      setTold(done === null ? "" : `Exported ${String(done.rows)} rows to ${done.path}.`);
    } catch (thrown: unknown) {
      setTold(isStudioError(thrown) ? thrown.message : String(thrown));
    }
  };
  return (
    <Modal title={`Export Rows of ${of.schema}.${of.table}`} onClose={close}>
      <label className="field">
        As{" "}
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value === "native" ? "native" : "csv");
          }}
        >
          <option value="csv">CSV</option>
          <option value="native">Native rows</option>
        </select>
      </label>
      <RowsChoices rows={0} where={where} onWhere={setWhere} />
      <p role="status">{told}</p>
      <div className="dialog-buttons">
        <button type="button" onClick={close}>
          Close
        </button>
        <button type="button" onClick={() => void run()}>
          Export…
        </button>
      </div>
    </Modal>
  );
}
