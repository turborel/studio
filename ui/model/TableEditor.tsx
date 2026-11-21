/**
 * A table of a model designed (RULES.md D46): its schema and name, its
 * columns, its constraints and its indexes, edited by the table forms;
 * saved into the model, or removed from it.
 */
import { useState } from "react";
import { Field } from "../data/TableDialogs";
import { ColumnsEditor, ConstraintsEditor } from "../data/TableForms";
import { tableProblem } from "../data/ddl";
import { useStore } from "../state/store";
import { Modal } from "../shell/Modal";
import { formOf, type TableForm, tableOf } from "./edit";
import { type ModelTable, tableKey } from "./model";
import { changeModel, editModel, type ModelDoc } from "./models";

/** A new table of a model, in `schema`. */
export function newTable(schema: string): ModelTable {
  return {
    schema,
    name: "",
    columns: [{ name: "ID", type: "INTEGER", notNull: true, default: null }],
    primaryKey: { name: null, columns: ["ID"] },
    uniques: [],
    checks: [],
    foreignKeys: [],
    indexes: [],
    position: null,
  };
}

/** An index of a table designed: its fields, and the button that removes it. */
function IndexRow(props: {
  readonly index: TableForm["indexes"][number];
  readonly n: number;
  readonly onIndex: (part: Partial<TableForm["indexes"][number]>) => void;
  readonly onRemove: () => void;
}) {
  const { index, n } = props;
  return (
    <li>
      <input
        aria-label={`Name of index ${String(n)}`}
        value={index.name}
        onChange={(e) => {
          props.onIndex({ name: e.target.value });
        }}
      />
      <input
        aria-label={`Columns of index ${String(n)}`}
        placeholder="A, B"
        value={index.columns}
        onChange={(e) => {
          props.onIndex({ columns: e.target.value });
        }}
      />
      <input
        aria-label={`Method of index ${String(n)}`}
        value={index.method}
        onChange={(e) => {
          props.onIndex({ method: e.target.value });
        }}
      />
      <button type="button" aria-label={`Remove index ${String(n)}`} onClick={props.onRemove}>
        ×
      </button>
    </li>
  );
}

/** The indexes of a table designed: each its name, columns and method; one added or removed. */
function IndexesEditor({ form, onForm }: { readonly form: TableForm; readonly onForm: (f: TableForm) => void }) {
  return (
    <fieldset>
      <legend>Indexes</legend>
      <ol>
        {form.indexes.map((x, i) => (
          <IndexRow
            key={String(i)}
            index={x}
            n={i + 1}
            onIndex={(part) => {
              onForm({ ...form, indexes: form.indexes.map((y, j) => (j === i ? { ...y, ...part } : y)) });
            }}
            onRemove={() => {
              onForm({ ...form, indexes: form.indexes.filter((_, j) => j !== i) });
            }}
          />
        ))}
      </ol>
      <button
        type="button"
        onClick={() => {
          onForm({ ...form, indexes: [...form.indexes, { name: "", columns: "", method: "btree" }] });
        }}
      >
        Add Index
      </button>
    </fieldset>
  );
}

/** What is wrong with `form` before it is saved, if anything. */
function formProblem(form: TableForm): string | null {
  return (
    tableProblem({ schema: form.schema, name: form.name, columns: form.columns, constraints: [] }) ??
    (form.schema.trim() === "" ? "The table needs a schema." : null)
  );
}

/** The fields of a table designed. */
function TableFields({ form, onForm }: { readonly form: TableForm; readonly onForm: (f: TableForm) => void }) {
  return (
    <>
      <Field
        label="Schema"
        value={form.schema}
        onValue={(schema) => {
          onForm({ ...form, schema });
        }}
      />
      <Field
        label="Name"
        value={form.name}
        onValue={(name) => {
          onForm({ ...form, name });
        }}
      />
      <ColumnsEditor
        columns={form.columns}
        onColumns={(columns) => {
          onForm({ ...form, columns });
        }}
      />
      <ConstraintsEditor
        columns={form.columns.map((c) => c.name)}
        constraints={form.constraints}
        onConstraints={(constraints) => {
          onForm({ ...form, constraints });
        }}
      />
      <IndexesEditor form={form} onForm={onForm} />
    </>
  );
}

/** The dialog that designs `table` of model `doc`, a new one if `old` is null. */
export function TableEditor({
  doc,
  old,
  onClose,
}: {
  readonly doc: ModelDoc;
  readonly old: ModelTable | null;
  readonly onClose: () => void;
}) {
  const store = useStore();
  const [form, setForm] = useState<TableForm>(() => formOf(old ?? newTable(doc.model.tables[0]?.schema ?? "PUBLIC")));
  const problem = formProblem(form);
  const save = () => {
    const table = tableOf(form, old);
    const key = old === null ? null : tableKey(old);
    editModel(store, doc.id, (m) => ({ ...m, tables: [...m.tables.filter((t) => tableKey(t) !== key), table] }));
    changeModel(store, doc.id, (d) => ({ ...d, selected: tableKey(table) }));
    onClose();
  };
  return (
    <Modal title={old === null ? "Add Table" : `Edit ${tableKey(old)}`} onClose={onClose} wide={true}>
      <TableFields form={form} onForm={setForm} />
      {problem !== null && <p className="error">{problem}</p>}
      <div className="dialog-buttons">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" disabled={problem !== null} onClick={save}>
          Save Table
        </button>
      </div>
    </Modal>
  );
}
