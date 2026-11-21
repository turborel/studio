/**
 * Two results compared (RULES.md D39): their rows matched whole, each
 * row of one either in the other as often, or only in one; of the rows
 * read of each.
 */
import type { Cell, ColumnInfo } from "../ipc/connections";

/** A row of a comparison: its cells, and where it is. */
export interface Compared {
  readonly cells: readonly Cell[];
  readonly side: "both" | "left" | "right";
}

/** What a comparison found. */
export interface Comparison {
  /** Whether the two have the same columns, by name and type. */
  readonly sameColumns: boolean;
  readonly rows: readonly Compared[];
  readonly both: number;
  readonly left: number;
  readonly right: number;
}

/** A row as one key: its cells, a null told from any text. */
function key(row: readonly Cell[]): string {
  return JSON.stringify(row);
}

/** Whether `a` and `b` are the same columns, by name and type, in order. */
function sameColumns(a: readonly ColumnInfo[], b: readonly ColumnInfo[]): boolean {
  return a.length === b.length && a.every((c, i) => c.name === b[i]?.name && c.typeWritten === b[i].typeWritten);
}

/** The rows of `left` compared with those of `right`: those of both first, in left's order, then left's alone, then right's. */
export function compare(
  left: { readonly columns: readonly ColumnInfo[]; readonly rows: readonly (readonly Cell[])[] },
  right: { readonly columns: readonly ColumnInfo[]; readonly rows: readonly (readonly Cell[])[] },
): Comparison {
  const remaining = new Map<string, number>();
  for (const row of right.rows) {
    remaining.set(key(row), (remaining.get(key(row)) ?? 0) + 1);
  }
  const both: Compared[] = [];
  const onlyLeft: Compared[] = [];
  for (const row of left.rows) {
    const n = remaining.get(key(row)) ?? 0;
    if (n > 0) {
      remaining.set(key(row), n - 1);
      both.push({ cells: row, side: "both" });
    } else {
      onlyLeft.push({ cells: row, side: "left" });
    }
  }
  const onlyRight: Compared[] = [];
  for (const row of right.rows) {
    const n = remaining.get(key(row)) ?? 0;
    if (n > 0) {
      remaining.set(key(row), n - 1);
      onlyRight.push({ cells: row, side: "right" });
    }
  }
  return {
    sameColumns: sameColumns(left.columns, right.columns),
    rows: [...both, ...onlyLeft, ...onlyRight],
    both: both.length,
    left: onlyLeft.length,
    right: onlyRight.length,
  };
}
