/**
 * Two schemas compared (RULES.md D47): of two connections, or of one, the
 * source's tables read and the target's, their differences listed, and
 * the script that makes the target match the source opened in a
 * worksheet of the target's connection, never run by the comparison.
 */
import { useState } from "react";
import { namer } from "../data/ddl";
import { openDdl } from "../data/ddlActions";
import { useStore, useStudio } from "../state/store";
import { Modal } from "../shell/Modal";
import { baseTables, readModel } from "./live";
import { type Difference, migration } from "./migrate";
import type { Model } from "./model";
import { Differences, thrownText, SchemaChoice } from "./ModelDialogs";

/** `model`'s tables moved to schema `to`, its foreign keys within schema `from` with them. */
export function moved(model: Model, from: string, to: string): Model {
  return {
    ...model,
    tables: model.tables.map((t) => ({
      ...t,
      schema: to,
      foreignKeys: t.foreignKeys.map((f) =>
        f.references.schema === from ? { ...f, references: { ...f.references, schema: to } } : f,
      ),
    })),
  };
}

/** Where a schema is: its connection and its name. */
interface At {
  readonly connection: number | null;
  readonly schema: string;
}

/** The comparison of the schema `source` with `target`: its migration, or why it could not be made. */
async function compared(
  source: At,
  target: At,
  reserved: readonly string[],
): Promise<{ statements: readonly string[]; differences: readonly Difference[] }> {
  if (source.connection === null || target.connection === null) {
    throw new Error("Choose the two schemas.");
  }
  const ours = await readModel(source.connection, source.schema, {
    tables: await baseTables(source.connection, source.schema),
    name: "source",
  });
  const theirs = await readModel(target.connection, target.schema, {
    tables: await baseTables(target.connection, target.schema),
    name: "target",
  });
  return migration(moved(ours, source.schema, target.schema), theirs, namer(reserved));
}

/** The buttons of a comparison: Close, Compare, and Open Script in Worksheet once there is one. */
function CompareButtons(props: {
  readonly close: () => void;
  readonly compare: () => void;
  readonly ready: boolean;
  readonly script: string;
  readonly open: () => void;
}) {
  return (
    <div className="dialog-buttons">
      <button type="button" onClick={props.close}>
        Close
      </button>
      <button type="button" disabled={!props.ready} onClick={props.compare}>
        Compare
      </button>
      <button type="button" disabled={props.script === ""} onClick={props.open}>
        Open Script in Worksheet
      </button>
    </div>
  );
}

/** The dialog that compares schema `schema` of `connection` with another. */
export function SchemaCompareDialog({ connection, schema }: { readonly connection: number; readonly schema: string }) {
  const store = useStore();
  const reserved = useStudio((s) => s.reservedWords);
  const [target, setTarget] = useState<At>({ connection, schema: "" });
  const [found, setFound] = useState<
    { statements: readonly string[]; differences: readonly Difference[] } | string | null
  >(null);
  const close = () => {
    store.update((now) => ({ ...now, dialog: null }));
  };
  const compare = async () => {
    try {
      setFound(await compared({ connection, schema }, target, reserved));
    } catch (thrown: unknown) {
      setFound(thrownText(thrown));
    }
  };
  const script = typeof found === "object" && found !== null ? found.statements.join("\n") : "";
  return (
    <Modal title={`Compare Schema ${schema}`} onClose={close}>
      <p>With the target, made to match {schema}:</p>
      <SchemaChoice
        connection={target.connection}
        schema={target.schema}
        onChoice={(c, s) => {
          setTarget({ connection: c, schema: s });
        }}
      />
      {typeof found === "string" && <p className="error">{found}</p>}
      {typeof found === "object" && found !== null && <Differences found={found.differences} />}
      <CompareButtons
        close={close}
        compare={() => void compare()}
        ready={target.schema !== ""}
        script={script}
        open={() =>
          void openDdl(store, target.connection ?? connection, { sql: script, title: `Match ${target.schema}` }, false)
        }
      />
    </Modal>
  );
}
