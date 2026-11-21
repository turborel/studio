/**
 * A model read from a live schema (RULES.md D46): its base tables, all or
 * those chosen, each read whole from the Information Schema, and its
 * property graphs.
 */
import { catalogGraphs, catalogObjects, catalogTable } from "../ipc/catalog";
import { type Model, type ModelGraph, modelTable, type ModelTable } from "./model";

/** The most tables a model is read of at once. */
export const MAX_MODEL_TABLES = 500;

/** The base tables of `schema` on `connection`, by name. */
export async function baseTables(connection: number, schema: string): Promise<string[]> {
  const objects = await catalogObjects(connection, schema);
  return objects.tables.filter((t) => t.kind !== "VIEW").map((t) => t.name);
}

/** The model of `schema`'s tables `tables` on `connection`, and its property graphs, named `name`. */
export async function readModel(
  connection: number,
  schema: string,
  { tables, name }: { tables: readonly string[]; name: string },
): Promise<Model> {
  if (tables.length > MAX_MODEL_TABLES) {
    throw new Error(`A model is read of at most ${String(MAX_MODEL_TABLES)} tables: choose fewer.`);
  }
  const read: ModelTable[] = [];
  for (const table of tables) {
    read.push(modelTable(await catalogTable(connection, schema, table)));
  }
  const graphs: ModelGraph[] = (await catalogGraphs(connection, schema)).map((g) => ({
    schema,
    name: g.name,
    elements: g.elements,
  }));
  return { name, tables: read, graphs };
}

/** `model` with the tables of `more` added, or put in place of those of their names, kept where they were drawn. */
export function merged(model: Model, more: Model): Model {
  const placed = new Map(model.tables.map((t) => [`${t.schema}.${t.name}`, t.position]));
  const names = new Set(more.tables.map((t) => `${t.schema}.${t.name}`));
  const graphs = new Set(more.graphs.map((g) => `${g.schema}.${g.name}`));
  return {
    ...model,
    tables: [
      ...model.tables.filter((t) => !names.has(`${t.schema}.${t.name}`)),
      ...more.tables.map((t) => ({ ...t, position: placed.get(`${t.schema}.${t.name}`) ?? t.position })),
    ],
    graphs: [...model.graphs.filter((g) => !graphs.has(`${g.schema}.${g.name}`)), ...more.graphs],
  };
}
