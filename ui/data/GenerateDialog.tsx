/**
 * A script generated of a schema's objects chosen (RULES.md D44): each
 * object's definition, as the explorer's definition writes it, the
 * types, domains and sequences first, then the base tables, the views
 * and the routines, opened in a worksheet of the connection.
 */
import { useEffect, useState } from "react";
import { catalogDefinition, catalogObjects, type DefinitionOf, type SchemaObjects } from "../ipc/catalog";
import { useStore } from "../state/store";
import { Modal } from "../shell/Modal";
import { openDdl } from "./ddlActions";

/** An object a script may define: its label, and what its definition is asked of. */
export interface Scripted {
  readonly label: string;
  readonly of: DefinitionOf;
}

/** The objects of `objects` of schema `schema`, in the order their definitions are written. */
export function scriptedObjects(schema: string, objects: SchemaObjects): Scripted[] {
  const table = (kinds: (k: string) => boolean, word: string) =>
    objects.tables
      .filter((t) => kinds(t.kind))
      .map((t) => ({
        label: `${word} ${t.name}`,
        of: { kind: "table", schema, name: t.name, script: "create" } as const,
      }));
  return [
    ...objects.types.map(([name]) => ({ label: `Type ${name}`, of: { kind: "type", schema, name } as const })),
    ...objects.domains.map((d) => ({
      label: `Domain ${d.name}`,
      of: { kind: "domain", schema, name: d.name } as const,
    })),
    ...objects.sequences.map((q) => ({
      label: `Sequence ${q.name}`,
      of: { kind: "sequence", schema, name: q.name } as const,
    })),
    ...table((k) => k !== "VIEW", "Table"),
    ...table((k) => k === "VIEW", "View"),
    ...objects.routines.map((r) => ({
      label: `${r.kind === "PROCEDURE" ? "Procedure" : "Function"} ${r.name}`,
      of: { kind: "routine", schema, specific: r.specific } as const,
    })),
  ];
}

/** The script of the definitions of `chosen`, a blank line between each, read in turn. */
export async function generatedScript(connection: number, chosen: readonly Scripted[]): Promise<string> {
  const parts: string[] = [];
  for (const c of chosen) {
    parts.push((await catalogDefinition(connection, c.of)).trimEnd());
  }
  return `${parts.join("\n\n")}\n`;
}

/** The objects of `schema` that may be scripted, every one chosen at first: null until they are read. */
function useObjects(connection: number, schema: string) {
  const [objects, setObjects] = useState<readonly Scripted[] | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => {
    let current = true;
    catalogObjects(connection, schema).then(
      (found) => {
        if (current) {
          const all = scriptedObjects(schema, found);
          setObjects(all);
          setChosen(new Set(all.map((_, i) => i)));
        }
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [connection, schema]);
  return { objects, chosen, setChosen };
}

/** The objects, each chosen or not. */
function ObjectList(props: {
  readonly objects: readonly Scripted[];
  readonly chosen: ReadonlySet<number>;
  readonly onChosen: (c: ReadonlySet<number>) => void;
}) {
  const toggle = (i: number) => {
    const next = new Set(props.chosen);
    if (!next.delete(i)) {
      next.add(i);
    }
    props.onChosen(next);
  };
  return (
    <ul className="generate-list" aria-label="Objects">
      {props.objects.map((o, i) => (
        <li key={o.label}>
          <label>
            <input
              type="checkbox"
              checked={props.chosen.has(i)}
              onChange={() => {
                toggle(i);
              }}
            />{" "}
            {o.label}
          </label>
        </li>
      ))}
    </ul>
  );
}

/** The dialog that generates a script of schema `schema`'s objects chosen. */
export function GenerateDialog({ connection, schema }: { readonly connection: number; readonly schema: string }) {
  const store = useStore();
  const { objects, chosen, setChosen } = useObjects(connection, schema);
  const [told, setTold] = useState("");
  const close = () => {
    store.update((now) => ({ ...now, dialog: null }));
  };
  const open = async () => {
    try {
      const script = await generatedScript(
        connection,
        (objects ?? []).filter((_, i) => chosen.has(i)),
      );
      await openDdl(store, connection, { sql: script, title: `${schema} script` }, false);
    } catch (thrown: unknown) {
      setTold(
        typeof thrown === "object" && thrown !== null && "message" in thrown ? String(thrown.message) : String(thrown),
      );
    }
  };
  const all = (objects ?? []).map((_, i) => i);
  return (
    <Modal title={`Generate Script of ${schema}`} onClose={close}>
      {objects === null ? (
        <p className="hint">Reading the schema…</p>
      ) : (
        <ObjectList objects={objects} chosen={chosen} onChosen={setChosen} />
      )}
      {told !== "" && <p className="error">{told}</p>}
      <div className="dialog-buttons">
        <button
          type="button"
          onClick={() => {
            setChosen(new Set(chosen.size === 0 ? all : []));
          }}
        >
          {chosen.size === 0 ? "Choose All" : "Choose None"}
        </button>
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button type="button" disabled={chosen.size === 0} onClick={() => void open()}>
          Open in Worksheet
        </button>
      </div>
    </Modal>
  );
}
