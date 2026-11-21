/**
 * A result's rows edited (RULES.md D42): each change staged, as a cell
 * given a value, a row added or a row removed, and written as the
 * statements that make it, an UPDATE or DELETE of each row by its key,
 * an INSERT of each row added, each value a parameter.
 */
import type { Cell, ColumnInfo } from "../ipc/connections";
import type { TableDetail } from "../ipc/catalog";
import { delimited } from "./literals";

/** The table a result's rows are edited in, and how its columns are its table's. */
export interface EditTarget {
  readonly schema: string;
  readonly table: string;
  /** The table's column each of the result's columns is, by name, or null if it is none. */
  readonly columns: readonly (string | null)[];
  /** The result's columns of the table's key, which find each row. */
  readonly key: readonly number[];
  /** The result's columns that take no value written: generated, or always an identity's. */
  readonly fixed: readonly number[];
}

/** A row added: the values given, by column; a column given none takes its default. */
export type AddedRow = Readonly<Record<number, Cell>>;

/** What is staged. */
export interface Edits {
  /** Cells given a value, by row read, then by column. */
  readonly changed: Readonly<Record<number, Readonly<Record<number, Cell>>>>;
  readonly added: readonly AddedRow[];
  /** Rows read that are removed. */
  readonly removed: readonly number[];
}

/** Nothing staged. */
export const NO_EDITS: Edits = { changed: {}, added: [], removed: [] };

/** A statement that makes a change: its text, and its parameters' values. */
export interface EditStatement {
  readonly sql: string;
  readonly values: readonly Cell[];
  /** Whether it must change exactly one row, as an UPDATE or DELETE of one by its key must. */
  readonly one: boolean;
}

/** The key that finds each row of `table`: its primary key, else a unique key of columns none of which takes null. */
export function keyOf(table: TableDetail): readonly string[] | null {
  const primary = table.constraints.find((c) => c.kind === "PRIMARY KEY");
  if (primary !== undefined) {
    return primary.columns;
  }
  const notNull = new Set(table.columns.filter((c) => !c.nullable).map((c) => c.name));
  return table.constraints.find((c) => c.kind === "UNIQUE" && c.columns.every((n) => notNull.has(n)))?.columns ?? null;
}

/**
 * How a result of `columns` is edited in `table`: each column its table's of its name; null if the table is no base
 * table, has no key, or the result lacks a column of the key.
 */
export function editTarget(table: TableDetail, columns: readonly ColumnInfo[]): EditTarget | null {
  const key = keyOf(table);
  if (key === null || table.kind !== "BASE TABLE") {
    return null;
  }
  const names = new Set(table.columns.map((c) => c.name));
  const mapped = columns.map((c) => (c.name !== null && names.has(c.name) ? c.name : null));
  const keyAt = key.map((k) => mapped.indexOf(k));
  if (
    keyAt.some((i) => i === -1) ||
    new Set(mapped.filter((m) => m !== null)).size !== mapped.filter((m) => m !== null).length
  ) {
    return null;
  }
  const fixed = mapped.flatMap((name, i) => {
    const column = table.columns.find((c) => c.name === name);
    return column !== undefined && (column.generated !== null || column.identity === "ALWAYS") ? [i] : [];
  });
  return { schema: table.schema, table: table.name, columns: mapped, key: keyAt, fixed };
}

/** Whether column `col` of `target` takes a value written. */
export function writable(target: EditTarget, col: number): boolean {
  return target.columns[col] !== null && target.columns[col] !== undefined && !target.fixed.includes(col);
}

/** `edits` with cell `row`, `col` given `value`: a row read's, or, past the `read` rows read, a row added's. */
export function editCell(edits: Edits, [col, row]: readonly [number, number], value: Cell, read: number): Edits {
  if (row >= read) {
    return { ...edits, added: edits.added.map((r, i) => (i === row - read ? { ...r, [col]: value } : r)) };
  }
  return { ...edits, changed: { ...edits.changed, [row]: { ...edits.changed[row], [col]: value } } };
}

/** `edits` with an empty row added, each of its columns taking its default. */
export function addRow(edits: Edits): Edits {
  return { ...edits, added: [...edits.added, {}] };
}

/** `edits` with `rows` removed: a row read marked removed, or unmarked if it is; a row added let go. */
export function removeRows(edits: Edits, rows: readonly number[], read: number): Edits {
  const removed = new Set(edits.removed);
  for (const row of rows.filter((r) => r < read)) {
    if (removed.has(row)) {
      removed.delete(row);
    } else {
      removed.add(row);
    }
  }
  const dropped = new Set(rows.filter((r) => r >= read).map((r) => r - read));
  return {
    ...edits,
    removed: [...removed].sort((a, b) => a - b),
    added: edits.added.filter((_, i) => !dropped.has(i)),
  };
}

/** How many changes `edits` stages: cells changed, rows added and rows removed. */
export function staged(edits: Edits): number {
  const cells = Object.values(edits.changed).reduce((n, row) => n + Object.keys(row).length, 0);
  return cells + edits.added.length + edits.removed.length;
}

/** The table's name, qualified. */
function tableName(target: EditTarget): string {
  return `${delimited(target.schema)}.${delimited(target.table)}`;
}

/** The condition that finds row `row` by its key, and its values. */
function byKey(target: EditTarget, row: readonly Cell[]): { where: string; values: Cell[] } {
  const where = target.key.map((k) => `${delimited(target.columns[k] ?? "")} = ?`).join(" AND ");
  return { where, values: target.key.map((k) => row[k] ?? null) };
}

/**
 * The statements that make `edits` of the rows read `rows`: each row removed deleted, each row changed updated,
 * each row added inserted, in that order, a row both changed and removed only deleted.
 */
export function editStatements(target: EditTarget, rows: readonly (readonly Cell[])[], edits: Edits): EditStatement[] {
  const table = tableName(target);
  const found: EditStatement[] = [];
  for (const row of edits.removed) {
    const { where, values } = byKey(target, rows[row] ?? []);
    found.push({ sql: `DELETE FROM ${table} WHERE ${where}`, values, one: true });
  }
  for (const [at, cells] of Object.entries(edits.changed)) {
    const row = Number(at);
    const set = Object.entries(cells).filter(([col]) => writable(target, Number(col)));
    if (edits.removed.includes(row) || set.length === 0) {
      continue;
    }
    const { where, values } = byKey(target, rows[row] ?? []);
    const assignments = set.map(([col]) => `${delimited(target.columns[Number(col)] ?? "")} = ?`).join(", ");
    found.push({
      sql: `UPDATE ${table} SET ${assignments} WHERE ${where}`,
      values: [...set.map(([, v]) => v), ...values],
      one: true,
    });
  }
  for (const added of edits.added) {
    const given = Object.entries(added).filter(([col]) => writable(target, Number(col)));
    if (given.length === 0) {
      found.push({ sql: `INSERT INTO ${table} DEFAULT VALUES`, values: [], one: false });
      continue;
    }
    const names = given.map(([col]) => delimited(target.columns[Number(col)] ?? "")).join(", ");
    const marks = given.map(() => "?").join(", ");
    found.push({
      sql: `INSERT INTO ${table} (${names}) VALUES (${marks})`,
      values: given.map(([, v]) => v),
      one: false,
    });
  }
  return found;
}
