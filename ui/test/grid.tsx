/**
 * The results grid as the tests see it (RULES.md R-TEST-7): Glide Data
 * Grid draws on a canvas, which jsdom has not, so the tests are given a
 * table in its place that asks for its cells as the grid does and calls
 * its handlers as a person's clicks would, the rest of the package as it
 * is.
 */
import type {
  CellClickedEventArgs,
  DataEditorProps,
  GridSelection,
  HeaderClickedEventArgs,
} from "@glideapps/glide-data-grid";
import { CompactSelection, GridCellKind } from "@glideapps/glide-data-grid";
import { useEffect } from "react";

/** The most rows the table shows. */
const SHOWN = 200;

/** A selection of cell `col`, `row`. */
export function cellSelection(col: number, row: number): GridSelection {
  return {
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
    current: { cell: [col, row], range: { x: col, y: row, width: 1, height: 1 }, rangeStack: [] },
  };
}

/** A click's event, of Shift or not. */
function headerClick(shiftKey: boolean): HeaderClickedEventArgs {
  return { shiftKey } as unknown as HeaderClickedEventArgs;
}

/** A context menu's event, at a place. */
function menuEvent(): CellClickedEventArgs {
  return {
    preventDefault: () => undefined,
    bounds: { x: 10, y: 20, width: 80, height: 26 },
    localEventX: 4,
    localEventY: 6,
  } as unknown as CellClickedEventArgs;
}

/** A cell of the grid as a table: a button that selects it, and, if it may be edited, a field that edits it. */
function TableCell({
  props,
  col,
  row,
}: {
  readonly props: DataEditorProps;
  readonly col: number;
  readonly row: number;
}) {
  const cell = props.getCellContent([col, row]);
  const shown = "displayData" in cell ? String(cell.displayData) : "";
  return (
    <td>
      <button
        type="button"
        aria-label={`Cell ${String(col)},${String(row)}`}
        onClick={() => props.onGridSelectionChange?.(cellSelection(col, row))}
        onContextMenu={() => props.onCellContextMenu?.([col, row], menuEvent())}
      >
        {shown}
      </button>
      {"readonly" in cell && !cell.readonly && (
        <input
          aria-label={`Edit ${String(col)},${String(row)}`}
          onChange={(e) =>
            props.onCellEdited?.([col, row], {
              kind: GridCellKind.Text,
              data: e.target.value,
              displayData: e.target.value,
              allowOverlay: true,
            })
          }
        />
      )}
    </td>
  );
}

/** The grid, as a table: each header a button that sorts, each cell one that selects it. */
export function TableGrid(props: DataEditorProps) {
  const { columns, rows, onVisibleRegionChanged } = props;
  useEffect(() => {
    onVisibleRegionChanged?.({ x: 0, y: 0, width: columns.length, height: rows }, 0, 0, {});
  }, [rows, columns.length, onVisibleRegionChanged]);
  return (
    <table aria-label="Result grid" data-frozen={props.freezeColumns}>
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={c.id ?? c.title} scope="col">
              <button type="button" onClick={(e) => props.onHeaderClicked?.(i, headerClick(e.shiftKey))}>
                {c.title}
              </button>
              <button
                type="button"
                aria-label={`Widen ${c.title}`}
                onClick={() => props.onColumnResize?.(c, 200, i, 200)}
              >
                ↔
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: Math.min(rows, SHOWN) }, (_, r) => (
          <tr key={String(r)}>
            {columns.map((c, col) => (
              <TableCell key={c.id ?? c.title} props={props} col={col} row={r} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
