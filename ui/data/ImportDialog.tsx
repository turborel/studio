/**
 * The import wizard (RULES.md D43, D63): a CSV, tab-separated, JSON or
 * Excel file chosen in the platform's dialog, previewed as it is read;
 * into an existing table, each field taken into a column or skipped, its
 * cast shown and a conflict flagged; or into a new table, each field's
 * column named and typed as inferred, the CREATE TABLE shown and run
 * first; then imported through the guards, a batch committed at a time,
 * by copy where the server grants it, its progress shown, cancelled if
 * asked, rows refused stopped at, skipped, or skipped to a limit.
 */
import { useEffect, useState } from "react";
import { type Column, type TableDetail, catalogTable } from "../ipc/catalog";
import { type Confirm, runStatement } from "../ipc/connections";
import {
  cancelImport,
  chooseImportFile,
  type ImportProgress,
  type ImportReport,
  importRows,
  type ImportSpec,
  type Preview,
  previewImport,
  type Reading,
} from "../ipc/data";
import { onStudioEvent } from "../ipc/events";
import { isStudioError } from "../state/actions";
import { loadSchemas } from "../state/catalog";
import { type Store, useStore } from "../state/store";
import { Modal } from "../shell/Modal";
import { GuardQuestion } from "../worksheet/dialogs";
import { createTableSql, namer, qualified } from "./ddl";
import { mappingProblems, type NewColumn, newColumns, type Policy, policySpec, tableNameOf } from "./importing";
import { Fields, ImportProgressView, ImportReportView, NewColumns, PolicyChoices, ReadingChoices } from "./ImportParts";
import { firstFields, headingColumn, type TableOf, tableSql } from "./tasks";

/** What the rows go into: an existing table, or a new one of a schema. */
export type ImportTarget =
  | { readonly kind: "existing"; readonly of: TableOf }
  | { readonly kind: "new"; readonly connection: number; readonly schema: string };

/** How a file is read at first: CSV, its first record its header. */
const FIRST_READING: Reading = { format: "csv", header: true, delimiter: null, null: null, sheet: null };

/** What a failure says. */
function said(thrown: unknown): string {
  return isStudioError(thrown) ? thrown.message : thrown instanceof Error ? thrown.message : String(thrown);
}

/** The step the guards' question is of: the new table's CREATE TABLE, or the import. */
type Step = "create" | "import";

/** The wizard's state. */
interface ImportState {
  readonly path: string | null;
  readonly reading: Reading;
  readonly preview: Preview | null;
  /** Of an existing table: the column each field goes into. */
  readonly fields: readonly (string | null)[];
  /** Of a new table: its name, and a column of each field. */
  readonly table: string;
  readonly columns: readonly NewColumn[];
  readonly batch: number;
  readonly policy: Policy;
  readonly asking: { readonly confirm: Confirm; readonly step: Step } | null;
  readonly running: boolean;
  readonly progress: ImportProgress | null;
  readonly report: ImportReport | null;
  readonly told: string;
}

/** The wizard's state as it opens. */
const FIRST: ImportState = {
  path: null,
  reading: FIRST_READING,
  preview: null,
  fields: [],
  table: "",
  columns: [],
  batch: 1000,
  policy: { kind: "stop" },
  asking: null,
  running: false,
  progress: null,
  report: null,
  told: "",
};

/** The columns of `of`, read from the catalog. */
function useColumns(of: TableOf | null): readonly Column[] {
  const [columns, setColumns] = useState<readonly Column[]>([]);
  const { connection, schema, table } = of ?? { connection: 0, schema: "", table: "" };
  useEffect(() => {
    let current = true;
    if (table !== "") {
      catalogTable(connection, schema, table).then(
        (t: TableDetail) => {
          if (current) {
            setColumns(t.columns);
          }
        },
        () => undefined,
      );
    }
    return () => {
      current = false;
    };
  }, [connection, schema, table]);
  return columns;
}

/** The connection of `target`. */
function connectionOf(target: ImportTarget): number {
  return target.kind === "existing" ? target.of.connection : target.connection;
}

/** The new table's CREATE TABLE of `state`, its names written as `store`'s reserved words say. */
export function newTableSql(store: Store, schema: string, state: Pick<ImportState, "table" | "columns">): string {
  const columns = state.columns
    .filter((c) => c.included)
    .map((c) => ({
      name: c.name.trim(),
      type: c.type.trim(),
      notNull: false,
      default: "",
      primaryKey: false,
      unique: false,
    }));
  return createTableSql(
    { schema, name: state.table.trim(), columns, constraints: [] },
    namer(store.current().reservedWords),
  );
}

/** The import's spec of `state` into `target`. */
function specOf(store: Store, target: ImportTarget, state: ImportState, path: string): ImportSpec {
  const { skip, limit } = policySpec(state.policy);
  const name = namer(store.current().reservedWords);
  const table = target.kind === "existing" ? tableSql(target.of) : qualified(target.schema, state.table.trim(), name);
  const fields =
    target.kind === "existing" ? state.fields : state.columns.map((c) => (c.included ? headingColumn(c.name) : null));
  return { path, reading: state.reading, table, fields, batch: state.batch, skip, limit };
}

/** Takes in the progress the backend tells of the import on `connection`. */
function useProgress(connection: number, setState: (change: (s: ImportState) => ImportState) => void): void {
  useEffect(() => {
    const stop = onStudioEvent((event) => {
      if (event.kind === "import" && event.connection === connection) {
        setState((s) => (s.running ? { ...s, progress: event.progress } : s));
      }
    });
    return () => {
      void stop.then((unlisten) => {
        unlisten();
      });
    };
  }, [connection, setState]);
}

/** Reads `path` as `reading` says: its preview, its fields' columns, and a new table's name and columns. */
async function readFile(
  { path, reading }: { readonly path: string; readonly reading: Reading },
  table: string,
  columns: readonly Column[],
  change: (next: Partial<ImportState>) => void,
): Promise<void> {
  try {
    const preview = await previewImport(path, reading);
    const count = preview.headings?.length ?? preview.inferred.length;
    const fields = firstFields(
      preview.headings,
      count,
      columns.map((c) => c.name),
    );
    const made = newColumns(preview.headings, preview.inferred);
    change({ path, preview, fields, table: table === "" ? tableNameOf(path) : table, columns: made, told: "" });
  } catch (thrown: unknown) {
    change({ path, preview: null, told: said(thrown) });
  }
}

/** Makes the new table of `state`, through the guards unless `confirmed`: whether it was made. */
async function createTable(
  store: Store,
  target: ImportTarget,
  state: ImportState,
  confirmed: boolean,
  change: (next: Partial<ImportState>) => void,
): Promise<boolean> {
  const connection = connectionOf(target);
  const schema = target.kind === "new" ? target.schema : "";
  const answer = await runStatement(connection, newTableSql(store, schema, state), confirmed);
  if (answer.kind === "confirm") {
    change({ asking: { confirm: answer.answer, step: "create" }, running: false });
    return false;
  }
  void loadSchemas(store, connection);
  return true;
}

/** An import into `target`: its state, its change, reading its file, and running it. */
function useImport(target: ImportTarget, columns: readonly Column[]) {
  const store = useStore();
  const [state, setState] = useState<ImportState>(FIRST);
  const change = (next: Partial<ImportState>) => {
    setState((s) => ({ ...s, ...next }));
  };
  const connection = connectionOf(target);
  useProgress(connection, setState);
  const read = (path: string, reading: Reading) => readFile({ path, reading }, state.table, columns, change);
  const create = (confirmed: boolean) => createTable(store, target, state, confirmed, change);
  const run = async (step: Step, confirmed: boolean) => {
    if (state.path === null) {
      return;
    }
    change({ asking: null, running: true, progress: null, report: null, told: "" });
    try {
      if (target.kind === "new" && step === "create" && !(await create(confirmed))) {
        return;
      }
      const spec = specOf(store, target, state, state.path);
      const answer = await importRows(connection, spec, step === "import" && confirmed);
      change(
        answer.kind === "confirm"
          ? { asking: { confirm: answer.answer, step: "import" }, running: false }
          : { report: answer.answer, running: false },
      );
    } catch (thrown: unknown) {
      change({ running: false, told: said(thrown) });
    }
  };
  const cancel = () => {
    cancelImport(connection).catch((thrown: unknown) => {
      change({ told: said(thrown) });
    });
  };
  return { state, change, read, run, cancel };
}

/** What stops a new table's import from being run, if anything. */
function newTableProblems(state: ImportState): string[] {
  const made = state.columns.filter((c) => c.included);
  const found: string[] = [];
  if (state.table.trim() === "") {
    found.push("The table needs a name.");
  }
  if (made.length === 0) {
    found.push("Make a column of a field.");
  }
  for (const c of made) {
    if (c.name.trim() === "" || c.type.trim() === "") {
      found.push(`Field ${String(c.field + 1)}'s column needs a name and a type.`);
    }
  }
  const names = made.map((c) => headingColumn(c.name));
  if (new Set(names).size < names.length) {
    found.push("Two columns have the same name.");
  }
  return found;
}

/** What is wrong with the import before it is run: of an existing table, of a new one. */
function problems(target: ImportTarget, state: ImportState, columns: readonly Column[]): string[] {
  if (state.preview === null) {
    return [];
  }
  if (target.kind === "new") {
    return newTableProblems(state);
  }
  return state.fields.every((f) => f === null)
    ? ["Choose a column for a field."]
    : mappingProblems(state.fields, columns);
}

/** The fields of the file: into an existing table's columns, or a new table's. */
function FieldsPart(
  props: { readonly target: ImportTarget; readonly columns: readonly Column[] } & ReturnType<typeof useImport>,
) {
  const store = useStore();
  const { state, change, target } = props;
  if (state.preview === null) {
    return null;
  }
  if (target.kind === "existing") {
    return (
      <Fields
        preview={state.preview}
        columns={props.columns}
        fields={state.fields}
        onFields={(fields) => {
          change({ fields });
        }}
      />
    );
  }
  return (
    <>
      <label>
        Table{" "}
        <input
          type="text"
          aria-label="Name of the new table"
          value={state.table}
          onChange={(e) => {
            change({ table: e.target.value });
          }}
        />
      </label>
      <NewColumns
        preview={state.preview}
        columns={state.columns}
        onColumns={(columns) => {
          change({ columns });
        }}
      />
      <pre className="ddl" aria-label="DDL">
        {newTableSql(store, target.schema, state)}
      </pre>
    </>
  );
}

/** The wizard's buttons: Close, or Cancel Import while it runs; and Import. */
function ImportButtons(props: {
  readonly target: ImportTarget;
  readonly state: ImportState;
  readonly blocked: boolean;
  readonly close: () => void;
  readonly cancel: () => void;
  readonly run: () => void;
}) {
  const { state } = props;
  return (
    <div className="dialog-buttons">
      <button type="button" onClick={state.running ? props.cancel : props.close}>
        {state.running ? "Cancel Import" : "Close"}
      </button>
      <button type="button" disabled={state.preview === null || state.running || props.blocked} onClick={props.run}>
        {props.target.kind === "new" ? "Create Table and Import" : "Import"}
      </button>
    </div>
  );
}

/** The file chosen, and how it is read, read again as that changes. */
function FileChoice(props: ReturnType<typeof useImport>) {
  const { state, change, read } = props;
  const choose = async () => {
    const path = await chooseImportFile();
    if (path !== null) {
      await read(path, state.reading);
    }
  };
  return (
    <>
      <p>
        <button type="button" data-first="" disabled={state.running} onClick={() => void choose()}>
          Choose File…
        </button>{" "}
        <span className="hint">{state.path ?? "No file chosen."}</span>
      </p>
      <ReadingChoices
        reading={state.reading}
        sheets={state.preview?.sheets ?? null}
        onReading={(r) => {
          change({ reading: r });
          if (state.path !== null) {
            void read(state.path, r);
          }
        }}
      />
    </>
  );
}

/** The wizard's form: its file, how it is read, its fields, the loading, and what it did. */
function ImportForm(
  props: {
    readonly target: ImportTarget;
    readonly columns: readonly Column[];
    readonly close: () => void;
  } & ReturnType<typeof useImport>,
) {
  const { state, change, run, target } = props;
  const found = problems(target, state, props.columns);
  return (
    <>
      <FileChoice {...props} />
      <FieldsPart {...props} />
      {found.length > 0 && (
        <ul className="error" aria-label="Problems">
          {found.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <PolicyChoices
        batch={state.batch}
        policy={state.policy}
        onBatch={(batch) => {
          change({ batch });
        }}
        onPolicy={(policy) => {
          change({ policy });
        }}
      />
      {state.running && <ImportProgressView progress={state.progress} />}
      {state.report !== null && <ImportReportView report={state.report} />}
      {state.told !== "" && <p className="error">{state.told}</p>}
      <ImportButtons
        target={target}
        state={state}
        blocked={found.some((p) => !p.includes("takes no null"))}
        close={props.close}
        cancel={props.cancel}
        run={() => void run("create", false)}
      />
    </>
  );
}

/** The wizard that imports a file's rows into `target`. */
export function ImportDialog({ target }: { readonly target: ImportTarget }) {
  const store = useStore();
  const columns = useColumns(target.kind === "existing" ? target.of : null);
  const importing = useImport(target, columns);
  const close = () => {
    store.update((now) => ({ ...now, dialog: null }));
  };
  const asking = importing.state.asking;
  const title =
    target.kind === "existing"
      ? `Import into ${target.of.schema}.${target.of.table}`
      : `Import into a New Table of ${target.schema}`;
  return (
    <Modal title={title} onClose={importing.state.running ? () => undefined : close} wide={true}>
      {asking === null ? (
        <ImportForm {...importing} target={target} columns={columns} close={close} />
      ) : (
        <GuardQuestion
          confirm={asking.confirm}
          labels={asking.step === "create" ? ["Create Table", "Don't Create"] : ["Import", "Don't Import"]}
          answer={(yes) => {
            if (yes) {
              void importing.run(asking.step, true);
            } else {
              importing.change({ asking: null, told: "Not imported: the import was not confirmed." });
            }
          }}
        />
      )}
    </Modal>
  );
}
