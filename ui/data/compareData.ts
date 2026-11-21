/**
 * Two tables' rows compared (RULES.md D45): each table read whole, of the
 * columns both have, in the order of the target's key; each row matched
 * by its key; and the statements that make the target's rows the
 * source's written: an INSERT of each row the target lacks, an UPDATE of
 * the columns that differ, a DELETE of each row the source lacks, each
 * value a literal of its column's type.
 */
import { type Column, catalogTable, type TableDetail } from "../ipc/catalog";
import { type Cell, closeResult, type ColumnInfo, fetchRows, runStatement } from "../ipc/connections";
import { literal, typeKind } from "../results/literals";
import { keyOf } from "../results/edits";
import { quoted, type TableOf, tableSql } from "./tasks";

/** The most rows a side of a comparison reads. */
export const MAX_COMPARED_ROWS = 100_000;
/** The rows each fetch of a side asks for. */
const FETCH = 5000;

/** A side's rows, of the columns compared. */
export type Rows = readonly (readonly Cell[])[];

/** A column compared: its name, delimited, and its type, for literals. */
export interface ComparedColumn {
  readonly name: string;
  readonly info: ColumnInfo;
  /** Its place among the columns compared. */
  readonly at: number;
}

/** What a comparison compares: the columns both tables have, but large objects, and the target's key among them. */
export interface Compared {
  readonly columns: readonly ComparedColumn[];
  /** The key's columns. */
  readonly key: readonly ComparedColumn[];
  /** The columns of large objects, not compared. */
  readonly skipped: readonly string[];
}

/** A table's column as a result's column, for literals. */
function info(c: Column): ColumnInfo {
  return { name: c.name, typeWritten: c.typeWritten, typeName: null, notNull: !c.nullable };
}

/** The columns `source` and `target` both have, by the target's types, the target's key among them; null if it has none, or the source lacks it. */
export function comparedColumns(source: TableDetail, target: TableDetail): Compared | null {
  const key = keyOf(target);
  const names = new Set(source.columns.map((c) => c.name));
  const both = target.columns.filter((c) => names.has(c.name));
  const columns = both
    .filter((c) => typeKind(info(c)) !== "lob")
    .map((c, at) => ({ name: quoted(c.name), info: info(c), at }));
  const keyed = (key ?? []).flatMap((k) => columns.filter((c) => c.info.name === k));
  if (keyed.length !== key?.length) {
    return null;
  }
  return { columns, key: keyed, skipped: both.filter((c) => typeKind(info(c)) === "lob").map((c) => c.name) };
}

/** A row's key, as one text. */
function keyText(row: readonly Cell[], key: readonly ComparedColumn[]): string {
  return JSON.stringify(key.map((k) => row[k.at]));
}

/** The value of `row` in column `c`, as a literal of its type: NULL where it has none, as a large object. */
function lit(row: readonly Cell[], c: ComparedColumn): string {
  return literal(row[c.at] ?? null, c.info) ?? "NULL";
}

/** The condition that finds a row by its key, of literals. */
function whereKey(compared: Compared, row: readonly Cell[]): string {
  return compared.key.map((k) => `${k.name} = ${lit(row, k)}`).join(" AND ");
}

/** What a comparison found, and the statements that make the target's rows the source's. */
export interface Difference {
  readonly inserts: number;
  readonly updates: number;
  readonly deletes: number;
  readonly same: number;
  readonly statements: readonly string[];
}

/** The rows of `source` and `target`, of `compared`'s columns, compared, and the statements that sync `table` to the source. */
export function difference(
  compared: Compared,
  table: string,
  { source, target }: { source: Rows; target: Rows },
): Difference {
  const theirs = new Map(target.map((r) => [keyText(r, compared.key), r]));
  const ours = new Set(source.map((r) => keyText(r, compared.key)));
  const names = compared.columns.map((c) => c.name).join(", ");
  const statements: string[] = [];
  let [inserts, updates, same] = [0, 0, 0];
  for (const row of source) {
    const other = theirs.get(keyText(row, compared.key));
    if (other === undefined) {
      inserts += 1;
      statements.push(
        `INSERT INTO ${table} (${names}) VALUES (${compared.columns.map((c) => lit(row, c)).join(", ")});`,
      );
      continue;
    }
    const changed = compared.columns.filter((c) => row[c.at] !== other[c.at]);
    if (changed.length === 0) {
      same += 1;
      continue;
    }
    updates += 1;
    const set = changed.map((c) => `${c.name} = ${lit(row, c)}`).join(", ");
    statements.push(`UPDATE ${table} SET ${set} WHERE ${whereKey(compared, row)};`);
  }
  const gone = target.filter((r) => !ours.has(keyText(r, compared.key)));
  for (const row of gone) {
    statements.push(`DELETE FROM ${table} WHERE ${whereKey(compared, row)};`);
  }
  return { inserts, updates, deletes: gone.length, same, statements };
}

/** Every row of `of`, of `compared`'s columns, in its key's order, read a page at a time, at most `MAX_COMPARED_ROWS`. */
export async function readSide(of: TableOf, compared: Compared): Promise<Rows> {
  const columns = compared.columns.map((c) => c.name).join(", ");
  const order = compared.key.map((k) => k.name).join(", ");
  const answer = await runStatement(
    of.connection,
    `SELECT ${columns} FROM ${tableSql(of)} ORDER BY ${order}`,
    false,
    [],
  );
  if (answer.kind !== "ran" || answer.answer.outcome.kind !== "rows") {
    throw new Error(`${of.schema}.${of.table} could not be read.`);
  }
  const outcome = answer.answer.outcome;
  let rows: Rows = outcome.page.rows;
  let complete = outcome.page.complete;
  while (!complete && rows.length <= MAX_COMPARED_ROWS) {
    const page = await fetchRows(of.connection, outcome.result, rows.length, FETCH);
    rows = [...rows, ...page.rows];
    complete = page.complete;
  }
  await closeResult(of.connection, outcome.result).catch(() => null);
  if (rows.length > MAX_COMPARED_ROWS) {
    throw new Error(`${of.schema}.${of.table} has more than ${String(MAX_COMPARED_ROWS)} rows: compare fewer.`);
  }
  return rows;
}

/** Compares the rows of `source` with those of `target`: what differs, and the statements that sync the target. */
export async function compareTables(
  source: TableOf,
  target: TableOf,
): Promise<Difference & { readonly skipped: readonly string[] }> {
  const [ours, theirs] = await Promise.all([
    catalogTable(source.connection, source.schema, source.table),
    catalogTable(target.connection, target.schema, target.table),
  ]);
  const compared = comparedColumns(ours, theirs);
  if (compared === null) {
    throw new Error(
      `${target.schema}.${target.table} has no key the two tables share: rows are matched by the target's key.`,
    );
  }
  const sourceRows = await readSide(source, compared);
  const targetRows = await readSide(target, compared);
  return {
    ...difference(compared, tableSql(target), { source: sourceRows, target: targetRows }),
    skipped: compared.skipped,
  };
}
