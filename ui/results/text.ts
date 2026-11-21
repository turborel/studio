/**
 * A result as text (RULES.md D39): its columns' names over a rule, and
 * its rows, each column as wide as its widest value, numbers to the
 * right, in the manner of Turborel's command-line client.
 */
import type { Cell, ColumnInfo } from "../ipc/connections";
import { numeric } from "./literals";

/** The widest a column is written, in characters; a longer value is cut, with an ellipsis. */
export const MAX_TEXT_WIDTH = 60;

/** `text` cut to `MAX_TEXT_WIDTH`, its lines joined. */
function fitted(text: string): string {
  const line = text.replaceAll(/\r?\n/gu, " ");
  return line.length > MAX_TEXT_WIDTH ? `${line.slice(0, MAX_TEXT_WIDTH - 1)}…` : line;
}

/** The rows of a result of `columns` as text, a null written NULL, and how many rows there are below. */
export function resultText(columns: readonly ColumnInfo[], rows: readonly (readonly Cell[])[]): string {
  const head = columns.map((c, i) => fitted(c.name ?? String(i + 1)));
  const body = rows.map((row) => row.map((c) => fitted(c ?? "NULL")));
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => (r[i] ?? "").length)));
  const right = columns.map(numeric);
  const line = (cells: readonly string[]) =>
    ` ${cells.map((c, i) => (right[i] === true ? c.padStart(widths[i] ?? 0) : c.padEnd(widths[i] ?? 0))).join(" | ")}`.trimEnd();
  const rule = widths.map((w) => "-".repeat(w + 2)).join("+");
  const count = `(${String(rows.length)} ${rows.length === 1 ? "row" : "rows"})`;
  return [line(head), rule, ...body.map(line), count].join("\n");
}
