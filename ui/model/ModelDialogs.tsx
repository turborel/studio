/**
 * The dialogs of a model (RULES.md D46, D47): its tables read from a live
 * schema; a table designed; and the model compared with a live schema,
 * the script that takes the schema to it opened in a worksheet.
 */
import { useEffect, useState } from "react";
import { catalogSchemas } from "../ipc/catalog";
import { openDdl } from "../data/ddlActions";
import { namer } from "../data/ddl";
import { useStore, useStudio } from "../state/store";
import { Modal } from "../shell/Modal";
import { laidOut } from "./layout";
import { baseTables, merged, readModel } from "./live";
import { type Difference, migration } from "./migrate";
import { changeModel, editModel, type ModelDoc } from "./models";

/** What a failure says. */
export function thrownText(thrown: unknown): string {
  if (thrown instanceof Error) {
    return thrown.message;
  }
  return typeof thrown === "object" && thrown !== null && "message" in thrown ? String(thrown.message) : String(thrown);
}

/** The schemas of `connection`, read as it is chosen. */
function useSchemas(connection: number | null): readonly string[] {
  const [schemas, setSchemas] = useState<readonly string[]>([]);
  useEffect(() => {
    let current = true;
    if (connection !== null) {
      catalogSchemas(connection).then(
        (found) => {
          if (current) {
            setSchemas(found.map((s) => s.name));
          }
        },
        () => undefined,
      );
    }
    return () => {
      current = false;
    };
  }, [connection]);
  return schemas;
}

/** The choice of an open connection. */
function ConnectionSelect({
  value,
  onValue,
}: {
  readonly value: number | null;
  readonly onValue: (id: number) => void;
}) {
  const open = useStudio((s) => s.open);
  return (
    <label className="field">
      Connection{" "}
      <select
        value={String(value ?? "")}
        onChange={(e) => {
          onValue(Number(e.target.value));
        }}
      >
        {open.map((c) => (
          <option key={c.id} value={String(c.id)}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The choice of an open connection, and of one of its schemas. */
export function SchemaChoice(props: {
  readonly connection: number | null;
  readonly schema: string;
  readonly onChoice: (connection: number, schema: string) => void;
}) {
  const first = useStudio((s) => s.open[0]?.id ?? null);
  const connection = props.connection ?? first;
  const schemas = useSchemas(connection);
  return (
    <>
      <ConnectionSelect
        value={connection}
        onValue={(id) => {
          props.onChoice(id, props.schema);
        }}
      />
      <label className="field">
        Schema{" "}
        <select
          value={props.schema}
          onChange={(e) => {
            if (connection !== null) {
              props.onChoice(connection, e.target.value);
            }
          }}
        >
          <option value="">Choose a schema</option>
          {schemas.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** The tables of `schema` on `connection`, each chosen at first. */
function useTables(connection: number | null, schema: string) {
  const [tables, setTables] = useState<readonly string[]>([]);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let current = true;
    if (connection !== null && schema !== "") {
      baseTables(connection, schema).then(
        (found) => {
          if (current) {
            setTables(found);
            setChosen(new Set(found));
          }
        },
        () => undefined,
      );
    }
    return () => {
      current = false;
    };
  }, [connection, schema]);
  return { tables, chosen, setChosen };
}

/** The tables, each chosen or not. */
function TableChecklist(props: {
  readonly tables: readonly string[];
  readonly chosen: ReadonlySet<string>;
  readonly onChosen: (c: ReadonlySet<string>) => void;
}) {
  return (
    <ul className="generate-list" aria-label="Tables">
      {props.tables.map((t) => (
        <li key={t}>
          <label>
            <input
              type="checkbox"
              checked={props.chosen.has(t)}
              onChange={() => {
                const next = new Set(props.chosen);
                if (!next.delete(t)) {
                  next.add(t);
                }
                props.onChosen(next);
              }}
            />{" "}
            {t}
          </label>
        </li>
      ))}
    </ul>
  );
}

/** The dialog that reads tables of a live schema into model `doc`. */
export function ReadSchemaDialog({ doc, onClose }: { readonly doc: ModelDoc; readonly onClose: () => void }) {
  const store = useStore();
  const [at, setAt] = useState<{ connection: number | null; schema: string }>({
    connection: doc.connection,
    schema: "",
  });
  const { tables, chosen, setChosen } = useTables(at.connection, at.schema);
  const [told, setTold] = useState("");
  const read = async () => {
    if (at.connection === null) {
      return;
    }
    try {
      const more = await readModel(at.connection, at.schema, {
        tables: tables.filter((t) => chosen.has(t)),
        name: doc.model.name,
      });
      editModel(store, doc.id, (m) => laidOut(merged(m, more)));
      changeModel(store, doc.id, (d) => ({ ...d, connection: at.connection }));
      onClose();
    } catch (thrown: unknown) {
      setTold(thrownText(thrown));
    }
  };
  return (
    <Modal title="Read Tables of a Schema" onClose={onClose}>
      <SchemaChoice
        connection={at.connection}
        schema={at.schema}
        onChoice={(connection, schema) => {
          setAt({ connection, schema });
        }}
      />
      <TableChecklist tables={tables} chosen={chosen} onChosen={setChosen} />
      {told !== "" && <p className="error">{told}</p>}
      <div className="dialog-buttons">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" disabled={chosen.size === 0} onClick={() => void read()}>
          Read
        </button>
      </div>
    </Modal>
  );
}

/** A comparison's differences, listed. */
export function Differences({ found }: { readonly found: readonly Difference[] }) {
  if (found.length === 0) {
    return <p role="status">The two are the same.</p>;
  }
  return (
    <ul className="differences" aria-label="Differences">
      {found.map((d, i) => (
        <li key={`${String(i)}.${d.table}`}>
          <strong>{d.table}</strong>: {d.what}
        </li>
      ))}
    </ul>
  );
}

/** What a comparison found: its migration, or why it could not be made. */
type Compared = { readonly statements: readonly string[]; readonly differences: readonly Difference[] } | string | null;

/** A comparison of model `doc` with the schema `at`, and its running. */
function useCompare(doc: ModelDoc, at: { connection: number | null; schema: string }) {
  const reserved = useStudio((s) => s.reservedWords);
  const [found, setFound] = useState<Compared>(null);
  const compare = async () => {
    if (at.connection === null) {
      return;
    }
    try {
      const live = await readModel(at.connection, at.schema, {
        tables: await baseTables(at.connection, at.schema),
        name: "live",
      });
      const desired = { ...doc.model, tables: doc.model.tables.filter((t) => t.schema === at.schema) };
      setFound(migration(desired, live, namer(reserved)));
    } catch (thrown: unknown) {
      setFound(thrownText(thrown));
    }
  };
  return { found, compare };
}

/** The dialog that compares model `doc` with a live schema, and writes the script that takes the schema to the model. */
export function CompareWithSchemaDialog({ doc, onClose }: { readonly doc: ModelDoc; readonly onClose: () => void }) {
  const store = useStore();
  const [at, setAt] = useState<{ connection: number | null; schema: string }>({
    connection: doc.connection,
    schema: doc.model.tables[0]?.schema ?? "",
  });
  const { found, compare } = useCompare(doc, at);
  const script = typeof found === "object" && found !== null ? found.statements.join("\n") : "";
  return (
    <Modal title="Compare with a Schema" onClose={onClose}>
      <SchemaChoice
        connection={at.connection}
        schema={at.schema}
        onChoice={(connection, schema) => {
          setAt({ connection, schema });
        }}
      />
      {typeof found === "string" && <p className="error">{found}</p>}
      {typeof found === "object" && found !== null && <Differences found={found.differences} />}
      <div className="dialog-buttons">
        <button type="button" onClick={onClose}>
          Close
        </button>
        <button type="button" disabled={at.connection === null || at.schema === ""} onClick={() => void compare()}>
          Compare
        </button>
        <button
          type="button"
          disabled={script === ""}
          onClick={() => void openDdl(store, at.connection ?? 0, { sql: script, title: `Migrate ${at.schema}` }, false)}
        >
          Open Script in Worksheet
        </button>
      </div>
    </Modal>
  );
}
