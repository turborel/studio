/**
 * Sorting and filtering a result (RULES.md D39): its query run again
 * within one that sorts and filters it, on the server, so every row is
 * sorted and filtered, not only those read.
 */
import type { Cell, ColumnInfo } from "../ipc/connections";
import { delimited, literal } from "./literals";

/** A column a result is sorted by. */
export interface SortKey {
  /** Its place, from 0. */
  readonly column: number;
  readonly descending: boolean;
}

/** A result's query, as written, and how it is sorted and filtered. */
export interface Query {
  readonly sql: string;
  readonly sort: readonly SortKey[];
  /** A search condition of the result's columns; empty for none. */
  readonly filter: string;
}

/** Comments and white space before a statement's first word. */
const LEADING = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/u;

/** Whether `sql` is a query, which may be run within another: a SELECT, VALUES, TABLE, WITH or one in parentheses. */
export function sortable(sql: string): boolean {
  return /^(?:\(|(?:SELECT|VALUES|TABLE|WITH)\b)/iu.test(sql.replace(LEADING, ""));
}

/**
 * The names a result's columns are given within the query that sorts it: each its own, but one of no name, or of a
 * name another has, its place, from 1.
 */
export function derivedNames(columns: readonly ColumnInfo[]): string[] {
  const counts = new Map<string, number>();
  for (const c of columns) {
    if (c.name !== null) {
      counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
    }
  }
  return columns.map((c, i) => (c.name !== null && counts.get(c.name) === 1 ? c.name : String(i + 1)));
}

/** Whether `query` is its statement as written, neither sorted nor filtered. */
export function plain(query: Query): boolean {
  return query.sort.length === 0 && query.filter.trim() === "";
}

/** The statement that runs `query`, of a result of `columns`. */
export function wrapped(query: Query, columns: readonly ColumnInfo[]): string {
  if (plain(query)) {
    return query.sql;
  }
  const names = derivedNames(columns);
  const list = names.map(delimited).join(", ");
  const where = query.filter.trim() === "" ? "" : `\nWHERE ${query.filter.trim()}`;
  const keys = query.sort
    .map((k) => `${delimited(names[k.column] ?? String(k.column + 1))}${k.descending ? " DESC" : ""}`)
    .join(", ");
  const order = keys === "" ? "" : `\nORDER BY ${keys}`;
  return `SELECT * FROM (\n${query.sql}\n) AS "Q" (${list})${where}${order}`;
}

/** The sort after a click on column `column`'s header: ascending, then descending, then not; with `adding`, a key added. */
export function nextSort(sort: readonly SortKey[], column: number, adding: boolean): SortKey[] {
  const now = sort.find((k) => k.column === column);
  const rest = adding ? sort.filter((k) => k.column !== column) : [];
  if (now === undefined) {
    return [...rest, { column, descending: false }];
  }
  if (!now.descending) {
    return adding
      ? sort.map((k) => (k.column === column ? { column, descending: true } : k))
      : [{ column, descending: true }];
  }
  return rest;
}

/**
 * A condition that keeps the rows whose column `column` is `cell`, or, `excluding`, those that are not: null for a
 * value no comparison takes, as a large object.
 */
export function valueCondition(
  columns: readonly ColumnInfo[],
  column: number,
  cell: Cell,
  excluding: boolean,
): string | null {
  const info = columns[column];
  if (info === undefined) {
    return null;
  }
  const name = delimited(derivedNames(columns)[column] ?? String(column + 1));
  if (cell === null) {
    return `${name} IS ${excluding ? "NOT " : ""}NULL`;
  }
  const value = literal(cell, info);
  if (value === null) {
    return null;
  }
  return excluding ? `(${name} <> ${value} OR ${name} IS NULL)` : `${name} = ${value}`;
}

/** `filter` with `condition` added to it by AND. */
export function narrowed(filter: string, condition: string): string {
  return filter.trim() === "" ? condition : `(${filter.trim()}) AND ${condition}`;
}
