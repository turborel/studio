/**
 * The actions of a table or schema in the details panel (RULES.md D42 to
 * D45): a table's rows edited, imported, exported and compared, and the
 * table altered; a table made in a schema. Each opens its dialog.
 */
import type { DataTask } from "../data/tasks";
import { Icon, type IconName } from "../icons/Icon";
import { baseTables, readModel } from "../model/live";
import { openModel } from "../model/models";
import { attempt, show } from "../state/actions";
import { useStore } from "../state/store";

/** An action's button: its icon and name. */
function Action({ icon, name, task }: { readonly icon: IconName; readonly name: string; readonly task: DataTask }) {
  const store = useStore();
  return (
    <button
      type="button"
      className="tool"
      onClick={() => {
        store.update((now) => ({ ...now, dialog: { kind: "data", task } }));
      }}
    >
      <Icon name={icon} />
      {name}
    </button>
  );
}

/** The actions of table `table` of schema `schema` on `connection`; of a view, none. */
export function TableActions(props: {
  readonly connection: number;
  readonly schema: string;
  readonly table: string;
  readonly kind: string;
}) {
  const of = { connection: props.connection, schema: props.schema, table: props.table };
  if (props.kind !== "BASE TABLE") {
    return null;
  }
  return (
    <div className="details-actions" role="group" aria-label="Table actions">
      <Action icon="edit" name="Edit Rows…" task={{ kind: "editRows", ...of }} />
      <Action icon="open" name="Import…" task={{ kind: "import", ...of }} />
      <Action icon="export" name="Export…" task={{ kind: "export", ...of }} />
      <Action icon="compare" name="Compare Rows…" task={{ kind: "compare", ...of }} />
      <Action icon="definition" name="Alter Table…" task={{ kind: "alterTable", ...of }} />
    </div>
  );
}

/** The action that opens a model of schema `schema`'s tables, read whole. */
function ModelAction({ connection, schema }: { readonly connection: number; readonly schema: string }) {
  const store = useStore();
  return (
    <button
      type="button"
      className="tool"
      onClick={() =>
        void attempt(store, async () => {
          const model = await readModel(connection, schema, {
            tables: await baseTables(connection, schema),
            name: schema,
          });
          openModel(store, model, { connection });
        })
      }
    >
      <Icon name="graph" />
      Open Model
    </button>
  );
}

/** The actions of schema `schema` on `connection`: a table made in it, its script, its comparison, its model and its analysis. */
export function SchemaActions({ connection, schema }: { readonly connection: number; readonly schema: string }) {
  const store = useStore();
  return (
    <div className="details-actions" role="group" aria-label="Schema actions">
      <Action icon="table" name="Create Table…" task={{ kind: "createTable", connection, schema }} />
      <Action icon="open" name="Import into New Table…" task={{ kind: "importNew", connection, schema }} />
      <Action icon="definition" name="Generate Script…" task={{ kind: "generate", connection, schema }} />
      <Action icon="compare" name="Compare Schema…" task={{ kind: "compareSchemas", connection, schema }} />
      <ModelAction connection={connection} schema={schema} />
      <button
        type="button"
        className="tool"
        onClick={() => {
          show(store, { kind: "analyzer", connection, schema });
        }}
      >
        <Icon name="analyze" />
        Analyze Schema…
      </button>
    </div>
  );
}
