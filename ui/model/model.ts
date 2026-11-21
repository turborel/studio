/**
 * A schema model (RULES.md D46, CONFORMANCE.md S-FILE-1): its tables,
 * each with its columns, keys, checks, foreign keys and indexes, and its
 * place in the diagram; and its property graphs. A model is read from a
 * live schema, or designed, and kept as a file of its own, JSON of format
 * version 1, read back only if it is one.
 */
import type { Graph, TableDetail } from "../ipc/catalog";

/** The format a model's file names itself by. */
export const MODEL_FORMAT = "turborel-studio-model";
/** The version of the model's file this build writes and reads. */
export const MODEL_VERSION = 1;

/** A column of a table of a model. */
export interface ModelColumn {
  readonly name: string;
  /** Its type, as SQL writes it. */
  readonly type: string;
  readonly notNull: boolean;
  /** Its default, as SQL writes it; null for none. */
  readonly default: string | null;
}

/** A named list of columns: a key or a unique constraint. */
export interface ModelKey {
  readonly name: string | null;
  readonly columns: readonly string[];
}

/** A check. */
export interface ModelCheck {
  readonly name: string | null;
  readonly condition: string;
}

/** A foreign key. */
export interface ModelForeignKey {
  readonly name: string | null;
  readonly columns: readonly string[];
  readonly references: { readonly schema: string; readonly table: string; readonly columns: readonly string[] };
  readonly onDelete: string;
  readonly onUpdate: string;
}

/** An index made by CREATE INDEX: its name, its columns, and its method. */
export interface ModelIndex {
  readonly name: string;
  readonly columns: readonly string[];
  /** Its method, as INDEXES names it: btree, hash, rtree and the others. */
  readonly method: string;
}

/** A table of a model. */
export interface ModelTable {
  readonly schema: string;
  readonly name: string;
  readonly columns: readonly ModelColumn[];
  readonly primaryKey: ModelKey | null;
  readonly uniques: readonly ModelKey[];
  readonly checks: readonly ModelCheck[];
  readonly foreignKeys: readonly ModelForeignKey[];
  readonly indexes: readonly ModelIndex[];
  /** Its place in the diagram, if it has been placed. */
  readonly position: { readonly x: number; readonly y: number } | null;
}

/** A model. */
export interface Model {
  readonly name: string;
  readonly tables: readonly ModelTable[];
  readonly graphs: readonly ModelGraph[];
}

/** A property graph of a model, as it is drawn. */
export interface ModelGraph {
  readonly schema: string;
  readonly name: string;
  readonly elements: Graph["elements"];
}

/** An empty model named `name`. */
export function emptyModel(name: string): Model {
  return { name, tables: [], graphs: [] };
}

/** The key of a table of a model: its schema and name. */
export function tableKey(t: { readonly schema: string; readonly table?: string; readonly name?: string }): string {
  return `${t.schema}.${t.table ?? t.name ?? ""}`;
}

/** A table of a model, of `detail` read from a live schema. */
export function modelTable(detail: TableDetail): ModelTable {
  const constraints = detail.constraints;
  const notNullChecks = new Set(
    constraints.filter((c) => c.kind === "CHECK" && c.check?.endsWith(" IS NOT NULL") === true).map((c) => c.name),
  );
  const primary = constraints.find((c) => c.kind === "PRIMARY KEY");
  return {
    schema: detail.schema,
    name: detail.name,
    columns: detail.columns.map((c) => ({
      name: c.name,
      type: c.typeWritten,
      notNull: !c.nullable,
      default: c.default,
    })),
    primaryKey: primary === undefined ? null : { name: primary.name, columns: primary.columns },
    uniques: constraints.filter((c) => c.kind === "UNIQUE").map((c) => ({ name: c.name, columns: c.columns })),
    checks: constraints
      .filter((c) => c.kind === "CHECK" && c.check !== null && !notNullChecks.has(c.name))
      .map((c) => ({ name: c.name, condition: c.check ?? "" })),
    foreignKeys: constraints.flatMap((c) =>
      c.kind === "FOREIGN KEY" && c.references !== null
        ? [
            {
              name: c.name,
              columns: c.columns,
              references: { schema: c.references.schema, table: c.references.table, columns: c.references.columns },
              onDelete: c.references.onDelete,
              onUpdate: c.references.onUpdate,
            },
          ]
        : [],
    ),
    indexes: detail.indexes
      .filter((i) => !i.implied)
      .map((i) => ({ name: i.name, columns: i.columns, method: i.method })),
    position: null,
  };
}

/** `model` as its file's text: JSON of its format and version, indented. */
export function modelText(model: Model): string {
  return `${JSON.stringify({ format: MODEL_FORMAT, version: MODEL_VERSION, ...model }, null, 2)}\n`;
}

/** Whether `value` is a list of strings. */
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Whether `value` is an object. */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `value` is a string, or null. */
function maybe(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/** Whether `columns` are a model table's columns. */
function areColumns(columns: unknown): boolean {
  return (
    Array.isArray(columns) &&
    columns.every(
      (c) =>
        record(c) &&
        typeof c["name"] === "string" &&
        typeof c["type"] === "string" &&
        typeof c["notNull"] === "boolean" &&
        maybe(c["default"]),
    )
  );
}

/** Whether `keys` are keys: each a name or none, and columns. */
function areKeys(keys: unknown): boolean {
  return Array.isArray(keys) && keys.every((u) => record(u) && maybe(u["name"]) && strings(u["columns"]));
}

/** Whether `checks` are checks. */
function areChecks(checks: unknown): boolean {
  return (
    Array.isArray(checks) && checks.every((c) => record(c) && maybe(c["name"]) && typeof c["condition"] === "string")
  );
}

/** Whether `keys` are foreign keys. */
function areForeignKeys(keys: unknown): boolean {
  return (
    Array.isArray(keys) &&
    keys.every((f) => {
      const to = record(f) ? f["references"] : null;
      return (
        record(f) &&
        maybe(f["name"]) &&
        strings(f["columns"]) &&
        record(to) &&
        typeof to["schema"] === "string" &&
        typeof to["table"] === "string" &&
        strings(to["columns"]) &&
        typeof f["onDelete"] === "string" &&
        typeof f["onUpdate"] === "string"
      );
    })
  );
}

/** Whether `indexes` are indexes. */
function areIndexes(indexes: unknown): boolean {
  return (
    Array.isArray(indexes) &&
    indexes.every(
      (i) => record(i) && typeof i["name"] === "string" && strings(i["columns"]) && typeof i["method"] === "string",
    )
  );
}

/** Whether `position` is a place, or none. */
function isPosition(position: unknown): boolean {
  return (
    position === null || (record(position) && typeof position["x"] === "number" && typeof position["y"] === "number")
  );
}

/** Whether `t` is a table of a model. */
function isTable(t: unknown): t is ModelTable {
  return (
    record(t) &&
    typeof t["schema"] === "string" &&
    typeof t["name"] === "string" &&
    areColumns(t["columns"]) &&
    (t["primaryKey"] === null || areKeys([t["primaryKey"]])) &&
    areKeys(t["uniques"]) &&
    areChecks(t["checks"]) &&
    areForeignKeys(t["foreignKeys"]) &&
    areIndexes(t["indexes"]) &&
    isPosition(t["position"])
  );
}

/** The model of a file's `text`: refused, with why, if it is not a model of this format and version. */
export function parseModel(text: string): Model {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The file is not JSON: it is no model.");
  }
  if (!record(value) || value["format"] !== MODEL_FORMAT) {
    throw new Error("The file is no Turborel Studio model.");
  }
  if (value["version"] !== MODEL_VERSION) {
    throw new Error(
      `The model is of version ${String(value["version"])}; this Studio reads version ${String(MODEL_VERSION)}.`,
    );
  }
  const tables = value["tables"];
  const graphs = value["graphs"];
  if (typeof value["name"] !== "string" || !Array.isArray(tables) || !tables.every(isTable) || !Array.isArray(graphs)) {
    throw new Error("The model's tables are not as a model writes them.");
  }
  return { name: value["name"], tables, graphs: graphs as ModelGraph[] };
}
