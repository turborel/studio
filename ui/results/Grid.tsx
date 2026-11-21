/**
 * A result's grid (RULES.md D13, D39): Glide Data Grid, which asks for the
 * cells it draws, so only those in view are drawn, and more rows are read
 * as it scrolls near the last read. Each column's header gives its name,
 * its sort, and its declared type; numbers are set to the right, and a
 * null is written NULL, in the muted colour.
 */
import {
  DataEditor,
  type DrawHeaderCallback,
  type GridCell,
  GridCellKind,
  type GridColumn,
  type GridSelection,
  type Item,
  type Rectangle,
  type Theme,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { useCallback, useMemo, useState } from "react";
import type { Cell, ColumnInfo } from "../ipc/connections";
import { useStudio } from "../state/store";
import { PALETTES, type ThemeName } from "../theme/tokens";
import { numeric } from "./literals";
import type { SortKey } from "./requery";

/** How near the last row read the grid scrolls before more are read. */
export const READ_AHEAD = 100;
/** A column's widths, in pixels. */
const MIN_WIDTH = 60;
const MAX_WIDTH = 320;
/** The pixels of a character, near enough to size a column. */
const CHARACTER = 7.5;
/** The rows a column is sized by. */
const SIZED_BY = 100;
/** The grid's font, the editor's: a canvas reads no CSS variable. */
const MONOSPACE = "ui-monospace, Menlo, Consolas, monospace";

/** What the grid is given. */
export interface GridProps {
  readonly columns: readonly ColumnInfo[];
  readonly rows: readonly (readonly Cell[])[];
  readonly complete: boolean;
  readonly sort: readonly SortKey[];
  /** The columns kept in view as it scrolls across. */
  readonly freeze: number;
  readonly selection: GridSelection;
  readonly onSelection: (selection: GridSelection) => void;
  /** Asks for more rows. */
  readonly onMore: () => void;
  /** A click on a column's header: `adding` with Shift, to sort by it too. */
  readonly onHeader: (column: number, adding: boolean) => void;
  /** The context menu of a cell, at a place in the window. */
  readonly onCellMenu: (cell: Item, at: { x: number; y: number }) => void;
}

/** The grid's colours, of Studio's theme. */
export function gridTheme(name: ThemeName): Partial<Theme> {
  const p = PALETTES[name];
  return {
    accentColor: p.accentText,
    accentFg: p.onAccent,
    accentLight: p.selection,
    textDark: p.text,
    textMedium: p.textMuted,
    textLight: p.textMuted,
    textHeader: p.text,
    textHeaderSelected: p.onAccent,
    bgCell: p.background,
    bgCellMedium: p.surface,
    bgHeader: p.surfaceRaised,
    bgHeaderHasFocus: p.surfaceRaised,
    bgHeaderHovered: p.surface,
    borderColor: p.border,
    linkColor: p.accentText,
    fontFamily: MONOSPACE,
  };
}

/** The mark of column `column`'s sort in its header: its direction, and its place where several sort. */
export function sortMark(sort: readonly SortKey[], column: number): string {
  const at = sort.findIndex((k) => k.column === column);
  const key = sort[at];
  if (key === undefined) {
    return "";
  }
  return ` ${key.descending ? "▼" : "▲"}${sort.length > 1 ? String(at + 1) : ""}`;
}

/** The width of a column of `info` and of the cells `rows` give it. */
export function columnWidth(info: ColumnInfo, index: number, rows: readonly (readonly Cell[])[]): number {
  const longest = Math.max(
    (info.name ?? String(index + 1)).length + 3,
    info.typeWritten.length,
    ...rows.slice(0, SIZED_BY).map((r) => (r[index] ?? "NULL").length),
  );
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, longest * CHARACTER + 16)));
}

/** The cell the grid draws at `col`, `row`, a null in colour `muted`. */
export function gridCell(
  columns: readonly ColumnInfo[],
  rows: readonly (readonly Cell[])[],
  [col, row]: Item,
  muted: string,
): GridCell {
  const value = rows[row]?.[col] ?? null;
  const info = columns[col];
  const right = info !== undefined && numeric(info);
  const text = value ?? "NULL";
  return {
    kind: GridCellKind.Text,
    data: text,
    displayData: text.length > 500 ? `${text.slice(0, 500)}…` : text,
    allowOverlay: false,
    readonly: true,
    contentAlign: right ? "right" : "left",
    ...(value === null ? { themeOverride: { textDark: muted } } : {}),
  };
}

/** Draws a header: its name and sort on one line, its declared type below. */
export function headerDrawer(columns: readonly ColumnInfo[]): DrawHeaderCallback {
  return ({ ctx, column, columnIndex, theme, rect }) => {
    ctx.save();
    ctx.fillStyle = theme.textHeader;
    ctx.font = `600 12px ${theme.fontFamily}`;
    ctx.fillText(column.title, rect.x + 8, rect.y + 17);
    ctx.fillStyle = theme.textLight;
    ctx.font = `11px ${theme.fontFamily}`;
    ctx.fillText(columns[columnIndex]?.typeWritten ?? "", rect.x + 8, rect.y + 33);
    ctx.restore();
  };
}

/** The grid's columns, each as wide as it was made or its values need. */
function useGridColumns(props: GridProps): { columns: GridColumn[]; resize: (col: number, width: number) => void } {
  const { columns, rows, sort } = props;
  const [widths, setWidths] = useState<Readonly<Record<number, number>>>({});
  const gridColumns = useMemo<GridColumn[]>(
    () =>
      columns.map((c, i) => ({
        id: String(i),
        title: `${c.name ?? `(${String(i + 1)})`}${sortMark(sort, i)}`,
        width: widths[i] ?? columnWidth(c, i, rows),
      })),
    [columns, rows, sort, widths],
  );
  const resize = useCallback((col: number, width: number) => {
    setWidths((w) => ({ ...w, [col]: width }));
  }, []);
  return { columns: gridColumns, resize };
}

/** The theme the window shows. */
function shownTheme(): ThemeName {
  return document.documentElement.dataset["theme"] === "dark" ? "dark" : "light";
}

/** A result's grid. */
export function Grid(props: GridProps) {
  const { columns, rows, complete, onMore, onHeader, onCellMenu } = props;
  const choice = useStudio((s) => s.settings.theme);
  const name = shownTheme();
  const muted = PALETTES[name].textMuted;
  const grid = useGridColumns(props);
  const content = useCallback((cell: Item) => gridCell(columns, rows, cell, muted), [columns, rows, muted]);
  const visible = useCallback(
    (range: Rectangle) => {
      if (!complete && range.y + range.height >= rows.length - READ_AHEAD) {
        onMore();
      }
    },
    [complete, rows.length, onMore],
  );
  return (
    <div className="result-grid" data-theme-choice={choice}>
      <DataEditor
        columns={grid.columns}
        rows={rows.length}
        getCellContent={content}
        getCellsForSelection={true}
        freezeColumns={props.freeze}
        headerHeight={42}
        rowHeight={26}
        rowMarkers="number"
        columnSelect="none"
        rangeSelect="rect"
        rowSelect="multi"
        theme={gridTheme(name)}
        width="100%"
        height="100%"
        drawHeader={headerDrawer(columns)}
        gridSelection={props.selection}
        onGridSelectionChange={props.onSelection}
        onVisibleRegionChanged={visible}
        onHeaderClicked={(col, event) => {
          onHeader(col, event.shiftKey);
        }}
        onColumnResize={(_column, width, col) => {
          grid.resize(col, width);
        }}
        onCellContextMenu={(cell, event) => {
          event.preventDefault();
          onCellMenu(cell, { x: event.bounds.x + event.localEventX, y: event.bounds.y + event.localEventY });
        }}
      />
    </div>
  );
}
