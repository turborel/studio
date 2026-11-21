/**
 * The query builder (RULES.md D48): a worksheet's query built by picking
 * tables of a schema, the joins their foreign keys imply following;
 * choosing columns and aggregates, conditions and order. Its SQL is
 * written into the worksheet as it changes, and stays the worksheet's to
 * edit once the builder is closed.
 */
import { useEffect, useState } from "react";
import { catalogTable } from "../ipc/catalog";
import { namer } from "../data/ddl";
import { useStore, useStudio } from "../state/store";
import { setText } from "../state/worksheets";
import { Modal } from "../shell/Modal";
import { viewOf } from "../worksheet/editor/views";
import { baseTables } from "../model/live";
import { thrownText } from "../model/ModelDialogs";
import { Conditions, Joins, Order, Tables } from "./BuilderParts";
import { NO_QUERY, pick, type QuerySpec, querySql, unpick } from "./query";
import type { Store } from "../state/store";

/** Writes `sql` into worksheet `id`: through its editor, if it is shown, else into its text. */
export function writeInto(store: Store, id: string, sql: string): void {
  const view = viewOf(id);
  if (view === undefined) {
    setText(store, id, sql);
    return;
  }
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: sql } });
}

/** The tables of `schema` on `connection`, read as either changes. */
function useTables(connection: number, schema: string): readonly string[] {
  const [tables, setTables] = useState<readonly string[]>([]);
  useEffect(() => {
    let current = true;
    baseTables(connection, schema).then(
      (found) => {
        if (current) {
          setTables(found);
        }
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [connection, schema]);
  return tables;
}

/** The choice of a table to pick, and Add Table. */
function AddTable({ tables, onAdd }: { readonly tables: readonly string[]; readonly onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <p>
      <label>
        Table{" "}
        <select
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        >
          <option value="">Choose a table</option>
          {tables.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>{" "}
      <button
        type="button"
        disabled={name === ""}
        onClick={() => {
          onAdd(name);
        }}
      >
        Add Table
      </button>
    </p>
  );
}

/** The query being built of worksheet `worksheet`: its parts, their change, written into the worksheet, and a table picked. */
function useBuilder(worksheet: string, connection: number, schema: string) {
  const store = useStore();
  const reserved = useStudio((s) => s.reservedWords);
  const [spec, setSpec] = useState<QuerySpec>(NO_QUERY);
  const [told, setTold] = useState("");
  const change = (next: QuerySpec) => {
    setSpec(next);
    writeInto(store, worksheet, querySql(next, namer(reserved)));
  };
  const add = async (name: string) => {
    try {
      change(pick(spec, await catalogTable(connection, schema, name)));
    } catch (thrown: unknown) {
      setTold(thrownText(thrown));
    }
  };
  return { spec, change, add, told, sql: querySql(spec, namer(reserved)) };
}

/** The builder of worksheet `worksheet`'s query, of tables of `schema` on `connection`. */
export function BuilderDialog({
  worksheet,
  connection,
  schema,
}: {
  readonly worksheet: string;
  readonly connection: number;
  readonly schema: string;
}) {
  const store = useStore();
  const tables = useTables(connection, schema);
  const { spec, change, add, told, sql } = useBuilder(worksheet, connection, schema);
  const close = () => {
    store.update((now) => ({ ...now, dialog: null }));
  };
  return (
    <Modal title="Query Builder" onClose={close} wide={true}>
      <AddTable tables={tables} onAdd={(n) => void add(n)} />
      <Tables
        spec={spec}
        onSpec={change}
        onRemove={(alias) => {
          change(unpick(spec, alias));
        }}
      />
      <Joins spec={spec} onSpec={change} />
      <Conditions spec={spec} onSpec={change} />
      <Order spec={spec} onSpec={change} />
      <pre className="value-text" aria-label="Query">
        {sql}
      </pre>
      {told !== "" && <p className="error">{told}</p>}
      <div className="dialog-buttons">
        <button type="button" onClick={close}>
          Done
        </button>
      </div>
    </Modal>
  );
}
