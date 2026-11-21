/**
 * Comparing a table's rows with another's (RULES.md D45): the target, of
 * any open connection, chosen; the two read and compared by the target's
 * key; what differs told; and the statements that make the target's rows
 * the source's opened in a worksheet of the target's connection, to be
 * read and run there.
 */
import { useState } from "react";
import { useStore, useStudio } from "../state/store";
import { Modal } from "../shell/Modal";
import { openDdl } from "./ddlActions";
import { compareTables, type Difference } from "./compareData";
import { Field } from "./TableDialogs";
import type { TableOf } from "./tasks";

/** What a comparison found, or why it could not be made. */
type Found = (Difference & { readonly skipped: readonly string[] }) | { readonly failed: string } | null;

/** What a comparison found, told. */
function Told({ found }: { readonly found: Found }) {
  if (found === null) {
    return null;
  }
  if ("failed" in found) {
    return <p className="error">{found.failed}</p>;
  }
  return (
    <div role="status">
      <p>
        {String(found.same)} rows the same; {String(found.inserts)} to insert, {String(found.updates)} to update and{" "}
        {String(found.deletes)} to delete in the target.
      </p>
      {found.skipped.length > 0 && <p className="hint">Large objects are not compared: {found.skipped.join(", ")}.</p>}
    </div>
  );
}

/** The choice of the target's connection, among those open. */
function ConnectionChoice({ value, onValue }: { readonly value: number; readonly onValue: (id: number) => void }) {
  const open = useStudio((s) => s.open);
  return (
    <label className="field">
      Connection{" "}
      <select
        value={String(value)}
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

/** The target's fields: its connection, schema and table. */
function TargetFields({ target, onTarget }: { readonly target: TableOf; readonly onTarget: (t: TableOf) => void }) {
  return (
    <>
      <ConnectionChoice
        value={target.connection}
        onValue={(connection) => {
          onTarget({ ...target, connection });
        }}
      />
      <Field
        label="Schema"
        value={target.schema}
        onValue={(schema) => {
          onTarget({ ...target, schema });
        }}
      />
      <Field
        label="Table"
        value={target.table}
        onValue={(table) => {
          onTarget({ ...target, table });
        }}
      />
    </>
  );
}

/** What a failure says. */
function failureOf(thrown: unknown): string {
  if (thrown instanceof Error) {
    return thrown.message;
  }
  return typeof thrown === "object" && thrown !== null && "message" in thrown ? String(thrown.message) : String(thrown);
}

/** The dialog that compares `of`'s rows with a target's. */
export function CompareDialog({ of }: { readonly of: TableOf }) {
  const store = useStore();
  const [target, setTarget] = useState<TableOf>(of);
  const [found, setFound] = useState<Found>(null);
  const close = () => {
    store.update((now) => ({ ...now, dialog: null }));
  };
  const compare = async () => {
    setFound(null);
    try {
      setFound(await compareTables(of, target));
    } catch (thrown: unknown) {
      setFound({ failed: failureOf(thrown) });
    }
  };
  const script = found !== null && !("failed" in found) ? found.statements.join("\n") : "";
  return (
    <Modal title={`Compare Rows of ${of.schema}.${of.table}`} onClose={close}>
      <p>With the target, whose rows are made the source's:</p>
      <TargetFields target={target} onTarget={setTarget} />
      <Told found={found} />
      <div className="dialog-buttons">
        <button type="button" onClick={close}>
          Close
        </button>
        <button type="button" onClick={() => void compare()}>
          Compare
        </button>
        <button
          type="button"
          disabled={script === ""}
          onClick={() => void openDdl(store, target.connection, { sql: script, title: `Sync ${target.table}` }, false)}
        >
          Open Script in Worksheet
        </button>
      </div>
    </Modal>
  );
}
