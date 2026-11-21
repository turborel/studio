/**
 * A DDL script imported into a model (RULES.md D64): the `.sql` file the
 * platform's dialog chooses, its definitions run by the backend in an
 * in-memory database, its unqualified names of the schema the user
 * names; the model read of that database's catalog as of a live schema,
 * schema by schema; the database closed; and the statements left out
 * kept with the model, to be read.
 */
import { closeConnection } from "../ipc/connections";
import { chooseSqlFile } from "../ipc/data";
import { ddlModel } from "../ipc/model";
import { prompted } from "../shell/PromptDialog";
import type { Store } from "../state/store";
import { baseTables, merged, readModel } from "./live";
import { emptyModel } from "./model";
import { openModel } from "./models";

/** The schema a script's unqualified names go into at first: the active connection's, else PUBLIC. */
function firstSchema(store: Store): string {
  const now = store.current();
  const active = now.open.find((c) => c.id === now.active);
  return active?.session.schema ?? "PUBLIC";
}

/** Imports a DDL script the user chooses into a new model: its identifier, or null if none was chosen. */
export async function importDdl(store: Store): Promise<string | null> {
  const path = await chooseSqlFile();
  if (path === null) {
    return null;
  }
  const schema = await prompted(
    store,
    "Import DDL into Model",
    "Schema of the names not qualified",
    firstSchema(store),
  );
  if (schema === null || schema.trim() === "") {
    return null;
  }
  const made = await ddlModel(path, schema.trim());
  const name =
    path
      .split(/[\\/]/u)
      .at(-1)
      ?.replace(/\.sql$/iu, "") ?? "Model";
  try {
    let model = emptyModel(name);
    for (const s of made.schemas) {
      const tables = await baseTables(made.connection, s);
      model = merged(model, await readModel(made.connection, s, { tables, name }));
    }
    const left = made.leftOutCount;
    const told = `Imported ${String(made.statements)} statements; ${left === 0 ? "none" : String(left)} left out.`;
    return openModel(store, model, { leftOut: made.leftOut, told });
  } finally {
    await closeConnection(made.connection);
  }
}
