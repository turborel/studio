/**
 * A result's values written back as SQL (RULES.md D39): each cell a
 * literal of its column's type, as a filter compares it and a copy of
 * INSERT statements writes it, so it reads back as the value it showed.
 */
import type { Cell, ColumnInfo } from "../ipc/connections";

/** The kinds of type a literal is written for. */
export type TypeKind = "exact" | "approximate" | "boolean" | "character" | "binary" | "lob" | "other";

/** The first words of each kind's types, as SQL writes them. */
const KINDS: readonly (readonly [TypeKind, RegExp])[] = [
  [
    "lob",
    /^(?:CHARACTER LARGE OBJECT|CHAR LARGE OBJECT|CLOB|BINARY LARGE OBJECT|BLOB|NATIONAL CHARACTER LARGE OBJECT|NCLOB)\b/u,
  ],
  ["exact", /^(?:INTEGER|INT|SMALLINT|BIGINT|NUMERIC|DECIMAL|DEC)\b/u],
  ["approximate", /^(?:REAL|DOUBLE PRECISION|DOUBLE|FLOAT|DECFLOAT)\b/u],
  ["boolean", /^BOOLEAN\b/u],
  ["character", /^(?:CHARACTER|CHAR|VARCHAR|NATIONAL CHARACTER|NATIONAL CHAR|NCHAR)\b/u],
  ["binary", /^(?:BINARY|VARBINARY)\b/u],
];

/** The kind of `column`'s type, by the type it was declared as. */
export function typeKind(column: ColumnInfo): TypeKind {
  const written = column.typeWritten.trim().toUpperCase();
  return KINDS.find(([, starts]) => starts.test(written))?.[0] ?? "other";
}

/** Whether `column`'s values are numbers. */
export function numeric(column: ColumnInfo): boolean {
  const kind = typeKind(column);
  return kind === "exact" || kind === "approximate";
}

/** A number as Turborel writes one, which SQL reads back as written. */
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:E[-+]?\d+)?$/iu;

/** `text` as a character string literal. */
export function stringLiteral(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

/** A name as a delimited identifier, which reads back as the name it is. */
export function delimited(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** `cell` of `column` as a literal of its type: null if a value of its type has none, as a large object's. */
export function literal(cell: Cell, column: ColumnInfo): string | null {
  if (cell === null) {
    return "NULL";
  }
  switch (typeKind(column)) {
    case "lob":
      return null;
    case "exact":
    case "approximate":
      return NUMBER.test(cell) ? cell : `CAST(${stringLiteral(cell)} AS ${column.typeWritten})`;
    case "boolean":
      return cell.toUpperCase() === "TRUE" ? "TRUE" : "FALSE";
    case "character":
      return stringLiteral(cell);
    case "binary":
      return /^[0-9A-F]*$/iu.test(cell) ? `X'${cell}'` : null;
    case "other":
      return `CAST(${stringLiteral(cell)} AS ${column.typeWritten})`;
  }
}
