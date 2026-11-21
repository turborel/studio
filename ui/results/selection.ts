/**
 * The cells of a result the grid's selection chooses (RULES.md D39):
 * rows chosen by their markers, columns by their headers, or a range of
 * cells.
 */
import type { GridSelection } from "@glideapps/glide-data-grid";
import type { Chosen } from "./actions";

/** The numbers from `from`, `count` of them. */
function range(from: number, count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => from + i);
}

/** The cells `selection` chooses of a result of `rows` rows read and `columns` columns: null of none. */
export function chosenOf(selection: GridSelection, rows: number, columns: number): Chosen | null {
  if (selection.rows.length > 0) {
    return { rows: selection.rows.toArray().filter((r) => r < rows), columns: range(0, columns) };
  }
  if (selection.columns.length > 0) {
    return { rows: range(0, rows), columns: selection.columns.toArray().filter((c) => c < columns) };
  }
  const box = selection.current?.range;
  if (box === undefined) {
    return null;
  }
  return {
    rows: range(box.y, Math.min(box.height, rows - box.y)),
    columns: range(box.x, Math.min(box.width, columns - box.x)),
  };
}

/** Every cell read of a result of `rows` rows and `columns` columns. */
export function allOf(rows: number, columns: number): Chosen {
  return { rows: range(0, rows), columns: range(0, columns) };
}
