/**
 * A result's cells copied as text (RULES.md D39): as CSV, as the export
 * writes it, as tab-separated values, as JSON, as a Markdown table, or as
 * INSERT statements, with the columns' names as a header or without.
 */
import type { Cell, ColumnInfo } from "../ipc/connections";
import { delimited, literal, typeKind } from "./literals";
import { derivedNames } from "./requery";

/** How cells are copied. */
export type CopyFormat = "csv" | "tsv" | "json" | "markdown" | "insert";

/** The formats, as the menu names them. */
export const COPY_FORMATS: readonly (readonly [CopyFormat, string])[] = [
  ["csv", "CSV"],
  ["tsv", "Tab-Separated"],
  ["json", "JSON"],
  ["markdown", "Markdown"],
  ["insert", "INSERT Statements"],
];

/** Cells to copy: their columns, and their rows. */
export interface Cells {
  readonly columns: readonly ColumnInfo[];
  readonly rows: readonly (readonly Cell[])[];
}

/** How a copy is written. */
export interface CopyOptions {
  /** Whether the columns' names head the text, where the format has a header. */
  readonly headers: boolean;
  /** The table INSERT statements insert into. */
  readonly table: string;
}

/** A CSV field: quoted where it must be, as RFC 4180 and the export write it. */
export function csvField(field: string): string {
  const quoted = field === "" || /[,"\r\n]/u.test(field) || /^\s|\s$/u.test(field);
  return quoted ? `"${field.replaceAll('"', '""')}"` : field;
}

/** A tab-separated field: quoted, as a CSV field is, where it holds a tab, a quote or a line's end. */
function tsvField(field: string): string {
  return /[\t"\r\n]/u.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

/** A column's name as a header shows it. */
function heading(column: ColumnInfo, i: number): string {
  return column.name ?? String(i + 1);
}

/** Lines of `cells` of fields joined by `between`, each written by `field`, a null written as nothing. */
function separated(cells: Cells, options: CopyOptions, field: (text: string) => string, between: string): string {
  const lines = cells.rows.map((row) => row.map((c) => (c === null ? "" : field(c))).join(between));
  if (options.headers) {
    lines.unshift(cells.columns.map((c, i) => field(heading(c, i))).join(between));
  }
  return lines.map((l) => `${l}\r\n`).join("");
}

/** `cell` of `column` as a JSON value: a number or truth value as one, a JSON value as itself, else a string. */
function jsonValue(cell: Cell, column: ColumnInfo): unknown {
  if (cell === null) {
    return null;
  }
  const kind = typeKind(column);
  if (kind === "boolean") {
    return cell.toUpperCase() === "TRUE";
  }
  if ((kind === "exact" || kind === "approximate" || column.typeWritten.toUpperCase() === "JSON") && parses(cell)) {
    return new RawJson(cell);
  }
  return cell;
}

/** Whether `text` is JSON's text. */
function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** JSON text kept as written, so a number keeps every digit. */
class RawJson {
  /** JSON text. */
  constructor(readonly text: string) {}
}

/** `value` as JSON text, raw JSON as written. */
function jsonText(value: unknown): string {
  if (value instanceof RawJson) {
    return value.text;
  }
  return JSON.stringify(value);
}

/** The rows of `cells` as a JSON array of objects, each keyed by its columns' names. */
function json(cells: Cells): string {
  const names = derivedNames(cells.columns);
  const rows = cells.rows.map(
    (row) =>
      `  {${row.map((c, i) => `${JSON.stringify(names[i])}: ${jsonText(jsonValue(c, must(cells.columns[i])))}`).join(", ")}}`,
  );
  return rows.length === 0 ? "[]\n" : `[\n${rows.join(",\n")}\n]\n`;
}

/** `value`, which is there. */
function must<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("a row has more cells than its result has columns");
  }
  return value;
}

/** A Markdown table cell: its bars escaped and its lines joined. */
function markdownCell(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll(/\r?\n/gu, " ");
}

/** `cells` as a Markdown table; without headers, the columns' places head it, as a table must have a head. */
function markdown(cells: Cells, options: CopyOptions): string {
  const head = cells.columns.map((c, i) => markdownCell(options.headers ? heading(c, i) : String(i + 1)));
  const lines = [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`];
  for (const row of cells.rows) {
    lines.push(`| ${row.map((c) => (c === null ? "NULL" : markdownCell(c))).join(" | ")} |`);
  }
  return `${lines.join("\n")}\n`;
}

/** `cells` as INSERT statements into `options.table`, one a row; a large object not read whole stops the copy. */
function inserts(cells: Cells, options: CopyOptions): string {
  const names = cells.columns.map((c, i) => delimited(c.name ?? String(i + 1))).join(", ");
  return cells.rows
    .map((row) => {
      const values = row.map((c, i) => {
        const written = literal(c, must(cells.columns[i]));
        if (written === null) {
          throw new Error("A large object is not copied as a value: view it to read it whole.");
        }
        return written;
      });
      return `INSERT INTO ${options.table} (${names}) VALUES (${values.join(", ")});\n`;
    })
    .join("");
}

/** `cells` as `format` writes them. */
export function copied(format: CopyFormat, cells: Cells, options: CopyOptions): string {
  switch (format) {
    case "csv":
      return separated(cells, options, csvField, ",");
    case "tsv":
      return separated(cells, options, tsvField, "\t");
    case "json":
      return json(cells);
    case "markdown":
      return markdown(cells, options);
    case "insert":
      return inserts(cells, options);
  }
}
