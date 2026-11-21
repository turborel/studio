/**
 * Importing a file's rows into a table (RULES.md D43): a CSV or
 * tab-separated file chosen in the platform's dialog, previewed as it is
 * read, each field taken into a column or skipped, then imported through
 * the guards, a batch committed at a time, by copy where the server
 * grants it.
 */
import { useEffect, useState } from "react";
import { type TableDetail, catalogTable } from "../ipc/catalog";
import type { Confirm } from "../ipc/connections";
import {
  chooseImportFile,
  type ImportReport,
  importRows,
  type ImportSpec,
  type Preview,
  previewImport,
  type Reading,
} from "../ipc/data";
import { isStudioError } from "../state/actions";
import { useStore } from "../state/store";
import { Modal } from "../shell/Modal";
import { GuardQuestion } from "../worksheet/dialogs";
import { firstFields, type TableOf, tableSql } from "./tasks";

/** How a file is read at first: CSV, its first record its header. */
const FIRST_READING: Reading = { format: "csv", header: true, delimiter: null, null: null };

/** What a failure says. */
function said(thrown: unknown): string {
  return isStudioError(thrown) ? thrown.message : thrown instanceof Error ? thrown.message : String(thrown);
}

/** The choice of a file's format, and whether its first record is its header. */
function FormatChoices({
  reading,
  onReading,
}: {
  readonly reading: Reading;
  readonly onReading: (r: Reading) => void;
}) {
  return (
    <>
      <label>
        Format{" "}
        <select
          value={reading.format}
          onChange={(e) => {
            onReading({ ...reading, format: e.target.value === "tsv" ? "tsv" : "csv" });
          }}
        >
          <option value="csv">CSV</option>
          <option value="tsv">Tab-separated</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={reading.header}
          onChange={(e) => {
            onReading({ ...reading, header: e.target.checked });
          }}
        />{" "}
        First record names the fields
      </label>
    </>
  );
}

/** A text of a reading, empty for none. */
function TextChoice(props: {
  readonly label: string;
  readonly value: string | null;
  readonly size: number;
  readonly onValue: (v: string | null) => void;
}) {
  return (
    <label>
      {props.label}{" "}
      <input
        type="text"
        size={props.size}
        maxLength={props.size === 2 ? 1 : undefined}
        value={props.value ?? ""}
        onChange={(e) => {
          props.onValue(e.target.value === "" ? null : e.target.value);
        }}
      />
    </label>
  );
}

/** The choices of how a file is read. */
function ReadingChoices({
  reading,
  onReading,
}: {
  readonly reading: Reading;
  readonly onReading: (r: Reading) => void;
}) {
  return (
    <fieldset className="import-reading">
      <legend>How the file is read</legend>
      <FormatChoices reading={reading} onReading={onReading} />
      <TextChoice
        label="Delimiter"
        size={2}
        value={reading.delimiter}
        onValue={(delimiter) => {
          onReading({ ...reading, delimiter });
        }}
      />
      <TextChoice
        label="Null is written"
        size={6}
        value={reading.null}
        onValue={(v) => {
          onReading({ ...reading, null: v });
        }}
      />
    </fieldset>
  );
}

/** The fields' columns, and the first records under them. */
function Fields(props: {
  readonly preview: Preview;
  readonly columns: readonly string[];
  readonly fields: readonly (string | null)[];
  readonly onFields: (fields: (string | null)[]) => void;
}) {
  const { preview, columns, fields } = props;
  return (
    <table className="result-table" aria-label="Preview">
      <thead>
        <tr>
          {fields.map((f, i) => (
            <th key={String(i)} scope="col">
              <span>{preview.headings?.[i] ?? `Field ${String(i + 1)}`}</span>
              <select
                aria-label={`Column of field ${String(i + 1)}`}
                value={f ?? ""}
                onChange={(e) => {
                  props.onFields(fields.map((g, j) => (j === i ? (e.target.value === "" ? null : e.target.value) : g)));
                }}
              >
                <option value="">Skip</option>
                {columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {preview.records.map((r, i) => (
          <tr key={String(i)}>
            {fields.map((_, j) => (
              <td key={String(j)} className={r[j] === null || r[j] === undefined ? "null" : undefined}>
                {r[j] ?? "NULL"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The columns of `of`, read from the catalog. */
function useColumns(of: TableOf): readonly string[] {
  const [columns, setColumns] = useState<readonly string[]>([]);
  useEffect(() => {
    let current = true;
    catalogTable(of.connection, of.schema, of.table).then(
      (t: TableDetail) => {
        if (current) {
          setColumns(t.columns.map((c) => c.name));
        }
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [of.connection, of.schema, of.table]);
  return columns;
}

/** The import's state: the file, how it is read, its preview, the fields' columns, what was said. */
interface ImportState {
  readonly path: string | null;
  readonly reading: Reading;
  readonly preview: Preview | null;
  readonly fields: readonly (string | null)[];
  readonly batch: number;
  readonly skip: boolean;
  readonly asking: Confirm | null;
  readonly report: ImportReport | null;
  readonly told: string;
}

/** The import's state as the dialog opens. */
const FIRST: ImportState = {
  path: null,
  reading: FIRST_READING,
  preview: null,
  fields: [],
  batch: 1000,
  skip: false,
  asking: null,
  report: null,
  told: "",
};

/** An import into `of`: its state, its change, reading its file, and running it. */
function useImport(of: TableOf, columns: readonly string[]) {
  const [state, setState] = useState<ImportState>(FIRST);
  const change = (next: Partial<ImportState>) => {
    setState((s) => ({ ...s, ...next }));
  };
  const read = async (path: string, reading: Reading) => {
    try {
      const preview = await previewImport(path, reading);
      const count = preview.headings?.length ?? preview.records[0]?.length ?? 0;
      change({ path, preview, fields: firstFields(preview.headings, count, columns), told: "" });
    } catch (thrown: unknown) {
      change({ path, preview: null, told: said(thrown) });
    }
  };
  const run = async (confirmed: boolean) => {
    if (state.path === null) {
      return;
    }
    const { path, reading, fields, batch, skip } = state;
    const spec: ImportSpec = { path, reading, table: tableSql(of), fields, batch, skip };
    try {
      const answer = await importRows(of.connection, spec, confirmed);
      change(answer.kind === "confirm" ? { asking: answer.answer } : { asking: null, report: answer.answer, told: "" });
    } catch (thrown: unknown) {
      change({ asking: null, told: said(thrown) });
    }
  };
  return { state, change, read, run };
}

/** What an import did. */
function Report({ report }: { readonly report: ImportReport }) {
  return (
    <div role="status">
      <p>
        Imported {String(report.rows)} rows{report.rejected > 0 ? `; ${String(report.rejected)} skipped:` : "."}
      </p>
      <ul>
        {report.skipped.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

/** The choices of the rows a batch commits, and of skipping rows refused. */
function BatchChoices({
  state,
  change,
}: {
  readonly state: ImportState;
  readonly change: (next: Partial<ImportState>) => void;
}) {
  return (
    <p>
      <label>
        Commit each{" "}
        <input
          type="number"
          min={0}
          value={state.batch}
          onChange={(e) => {
            change({ batch: Math.max(0, Number(e.target.value)) });
          }}
        />{" "}
        rows, 0 for all at once
      </label>{" "}
      <label>
        <input
          type="checkbox"
          checked={state.skip}
          onChange={(e) => {
            change({ skip: e.target.checked });
          }}
        />{" "}
        Skip a row refused, and tell it
      </label>
    </p>
  );
}

/** The import's form: its file, how it is read, its fields, its batch, and what it did. */
function ImportForm(
  props: { readonly columns: readonly string[]; readonly close: () => void } & ReturnType<typeof useImport>,
) {
  const { state, change, read, run, columns } = props;
  const choose = async () => {
    const path = await chooseImportFile();
    if (path !== null) {
      await read(path, state.reading);
    }
  };
  return (
    <>
      <p>
        <button type="button" onClick={() => void choose()}>
          Choose File…
        </button>{" "}
        <span className="hint">{state.path ?? "No file chosen."}</span>
      </p>
      <ReadingChoices
        reading={state.reading}
        onReading={(r) => {
          change({ reading: r });
          if (state.path !== null) {
            void read(state.path, r);
          }
        }}
      />
      {state.preview !== null && (
        <Fields
          preview={state.preview}
          columns={columns}
          fields={state.fields}
          onFields={(fields) => {
            change({ fields });
          }}
        />
      )}
      <BatchChoices state={state} change={change} />
      {state.report !== null && <Report report={state.report} />}
      {state.told !== "" && <p className="error">{state.told}</p>}
      <ImportButtons state={state} close={props.close} run={run} />
    </>
  );
}

/** The import's buttons: Close, and Import once a field goes into a column. */
function ImportButtons(props: {
  readonly state: ImportState;
  readonly close: () => void;
  readonly run: (confirmed: boolean) => Promise<void>;
}) {
  return (
    <div className="dialog-buttons">
      <button type="button" onClick={props.close}>
        Close
      </button>
      <button
        type="button"
        disabled={props.state.preview === null || props.state.fields.every((f) => f === null)}
        onClick={() => void props.run(false)}
      >
        Import
      </button>
    </div>
  );
}

/** The dialog that imports a file's rows into `of`. */
export function ImportDialog({ of }: { readonly of: TableOf }) {
  const store = useStore();
  const columns = useColumns(of);
  const importing = useImport(of, columns);
  const close = () => {
    store.update((now) => ({ ...now, dialog: null }));
  };
  const asking = importing.state.asking;
  return (
    <Modal title={`Import into ${of.schema}.${of.table}`} onClose={close} wide={true}>
      {asking === null ? (
        <ImportForm {...importing} columns={columns} close={close} />
      ) : (
        <GuardQuestion
          confirm={asking}
          labels={["Import", "Don't Import"]}
          answer={(yes) => {
            if (yes) {
              void importing.run(true);
            } else {
              importing.change({ asking: null, told: "Not imported: the import was not confirmed." });
            }
          }}
        />
      )}
    </Modal>
  );
}
