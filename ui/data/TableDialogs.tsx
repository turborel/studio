/**
 * The dialogs that make and alter a table (RULES.md D44): each writes its
 * DDL as it is filled in, shown before it runs, and opens it in a
 * worksheet of the connection, or runs it there.
 */
import { type ReactNode, useEffect, useState } from "react";
import { catalogTable, type TableDetail } from "../ipc/catalog";
import { useStore, useStudio } from "../state/store";
import { Modal } from "../shell/Modal";
import {
  type AlterAction,
  alterScript,
  type ColumnSpec,
  type ConstraintSpec,
  createTableSql,
  namer,
  qualified,
  type TableSpec,
  tableProblem,
} from "./ddl";
import { openDdl } from "./ddlActions";
import { AlterForm } from "./AlterForm";
import { ColumnsEditor, ConstraintsEditor } from "./TableForms";
import type { TableOf } from "./tasks";

/** A column as it is added: of no name, INTEGER, taking null. */
export const NEW_COLUMN: ColumnSpec = {
  name: "",
  type: "INTEGER",
  notNull: false,
  default: "",
  primaryKey: false,
  unique: false,
};

/** The DDL shown, and its buttons: Cancel, Open in Worksheet and Run, the last two once it is whole. */
function Written(props: {
  readonly sql: string;
  readonly problem: string | null;
  readonly onClose: () => void;
  readonly onOpen: (run: boolean) => void;
}) {
  return (
    <>
      <pre className="value-text ddl-preview" aria-label="DDL">
        {props.sql}
      </pre>
      {props.problem !== null && <p className="error">{props.problem}</p>}
      <div className="dialog-buttons">
        <button type="button" onClick={props.onClose}>
          Cancel
        </button>
        <button
          type="button"
          disabled={props.problem !== null}
          onClick={() => {
            props.onOpen(false);
          }}
        >
          Open in Worksheet
        </button>
        <button
          type="button"
          disabled={props.problem !== null}
          onClick={() => {
            props.onOpen(true);
          }}
        >
          Run
        </button>
      </div>
    </>
  );
}

/** A labelled text field. */
export function Field(props: {
  readonly label: string;
  readonly value: string;
  readonly onValue: (v: string) => void;
  readonly children?: ReactNode;
}) {
  return (
    <label className="field">
      {props.label}{" "}
      <input
        type="text"
        value={props.value}
        onChange={(e) => {
          props.onValue(e.target.value);
        }}
      />
      {props.children}
    </label>
  );
}

/** The dialog that makes a table in schema `schema` of `connection`. */
export function CreateTableDialog({ connection, schema }: { readonly connection: number; readonly schema: string }) {
  const store = useStore();
  const reserved = useStudio((s) => s.reservedWords);
  const [spec, setSpec] = useState<TableSpec>({ schema, name: "", columns: [NEW_COLUMN], constraints: [] });
  const name = namer(reserved);
  const close = () => {
    store.update((now) => ({ ...now, dialog: null }));
  };
  const problem = tableProblem(spec);
  return (
    <Modal title={`Create Table in ${schema}`} onClose={close} wide={true}>
      <Field
        label="Name"
        value={spec.name}
        onValue={(n) => {
          setSpec({ ...spec, name: n });
        }}
      />
      <ColumnsEditor
        columns={spec.columns}
        onColumns={(columns) => {
          setSpec({ ...spec, columns });
        }}
      />
      <ConstraintsEditor
        columns={spec.columns.map((c) => c.name).filter((n) => n !== "")}
        constraints={spec.constraints}
        onConstraints={(constraints: readonly ConstraintSpec[]) => {
          setSpec({ ...spec, constraints });
        }}
      />
      <Written
        sql={problem === null ? `${createTableSql(spec, name)};` : ""}
        problem={problem}
        onClose={close}
        onOpen={(run) =>
          void openDdl(store, connection, { sql: `${createTableSql(spec, name)};`, title: `Create ${spec.name}` }, run)
        }
      />
    </Modal>
  );
}

/** The table `of`, read from the catalog: null until it is. */
function useTable(of: TableOf): TableDetail | null {
  const [table, setTable] = useState<TableDetail | null>(null);
  useEffect(() => {
    let current = true;
    catalogTable(of.connection, of.schema, of.table).then(
      (t) => {
        if (current) {
          setTable(t);
        }
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [of.connection, of.schema, of.table]);
  return table;
}

/** The dialog that alters table `of`, its actions staged a statement each. */
export function AlterTableDialog({ of }: { readonly of: TableOf }) {
  const store = useStore();
  const reserved = useStudio((s) => s.reservedWords);
  const table = useTable(of);
  const [actions, setActions] = useState<readonly AlterAction[]>([]);
  const name = namer(reserved);
  const close = () => {
    store.update((now) => ({ ...now, dialog: null }));
  };
  const script = alterScript(qualified(of.schema, of.table, name), actions, name);
  return (
    <Modal title={`Alter Table ${of.schema}.${of.table}`} onClose={close} wide={true}>
      {table === null ? (
        <p className="hint">Reading the table…</p>
      ) : (
        <AlterForm
          table={table}
          onAction={(a) => {
            setActions([...actions, a]);
          }}
        />
      )}
      {actions.length > 0 && (
        <ol className="alter-actions" aria-label="Actions">
          {actions.map((a, i) => (
            <li key={`${String(i)}.${a.kind}`}>
              <code>{alterScript(qualified(of.schema, of.table, name), [a], name)}</code>{" "}
              <button
                type="button"
                aria-label={`Remove action ${String(i + 1)}`}
                onClick={() => {
                  setActions(actions.filter((_, j) => j !== i));
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
      <Written
        sql={script}
        problem={actions.length === 0 ? "Add an action to alter the table." : null}
        onClose={close}
        onOpen={(run) => void openDdl(store, of.connection, { sql: script, title: `Alter ${of.table}` }, run)}
      />
    </Modal>
  );
}
