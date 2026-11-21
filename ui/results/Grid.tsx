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
  type EditableGridCell,
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
import type { Editing } from "../state/worksheets";
import { type Edits, writable } from "./edits";
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
  /** The rows' edits, while they are edited; and the cells of large objects not sent whole, which are not. */
  readonly editing: Editing | null;
  readonly lobs: readonly string[];
  /** A cell given a value, typed in its editor. */
  readonly onEdit: (cell: Item, value: string) => void;
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

/** The colours a cell is drawn in, of Studio's theme. */
export interface CellColours {
  readonly muted: string;
  /** A cell changed, or a row added. */
  readonly changed: string;
  /** A row removed. */
  readonly removed: string;
}

/** What the grid shows: the rows read, and, while they are edited, their edits. */
export interface Shown {
  readonly columns: readonly ColumnInfo[];
  readonly rows: readonly (readonly Cell[])[];
  readonly editing: Editing | null;
  readonly lobs: readonly string[];
}

/** A cell's value, and how it is marked: undefined for a row added's default. */
interface Valued {
  readonly value: Cell | undefined;
  readonly mark: "changed" | "removed" | null;
}

/** The value of a row read's cell `col`, `row`, staged in `edits` or as read. */
function readValue(rows: Shown["rows"], edits: Edits | undefined, [col, row]: Item): Valued {
  const read = rows[row]?.[col] ?? null;
  if (edits?.removed.includes(row) === true) {
    return { value: read, mark: "removed" };
  }
  const changed = edits?.changed[row];
  return changed !== undefined && col in changed
    ? { value: changed[col] ?? null, mark: "changed" }
    : { value: read, mark: null };
}

/** The value cell `col`, `row` shows, staged or read, and how it is marked. */
function valueAt({ rows, editing }: Shown, [col, row]: Item): Valued {
  const edits = editing?.edits;
  if (edits !== undefined && row >= rows.length) {
    const added = edits.added[row - rows.length] ?? {};
    return { value: col in added ? (added[col] ?? null) : undefined, mark: "changed" };
  }
  return readValue(rows, edits, [col, row]);
}

/** Whether cell `col`, `row` is edited in place: of a column written, of a row not removed, of no large object not sent whole. */
export function editable(shown: Shown, [col, row]: Item): boolean {
  const editing = shown.editing;
  if (editing === null || !writable(editing.target, col) || editing.edits.removed.includes(row)) {
    return false;
  }
  return row >= shown.rows.length || !shown.lobs.includes(`${String(row)}:${String(col)}`);
}

/** The cell the grid draws at `col`, `row`, in `colours`. */
export function gridCell(shown: Shown, cell: Item, colours: CellColours): GridCell {
  const { value, mark } = valueAt(shown, cell);
  const info = shown.columns[cell[0]];
  const right = info !== undefined && numeric(info);
  const text = value === undefined ? "DEFAULT" : (value ?? "NULL");
  const muted = value === null || value === undefined;
  const open = editable(shown, cell);
  const theme = {
    ...(muted ? { textDark: colours.muted } : {}),
    ...(mark === "changed" ? { bgCell: colours.changed } : {}),
    ...(mark === "removed" ? { textDark: colours.removed } : {}),
  };
  return {
    kind: GridCellKind.Text,
    data: value ?? "",
    displayData: text.length > 500 ? `${text.slice(0, 500)}…` : text,
    allowOverlay: open,
    readonly: !open,
    contentAlign: right ? "right" : "left",
    ...(Object.keys(theme).length > 0 ? { themeOverride: theme } : {}),
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

/** The grid's cells, of the theme `name`'s colours. */
function useContent(props: GridProps, name: ThemeName): (cell: Item) => GridCell {
  const { columns, rows, editing, lobs } = props;
  const palette = PALETTES[name];
  return useCallback(
    (cell: Item) =>
      gridCell({ columns, rows, editing, lobs }, cell, {
        muted: palette.textMuted,
        changed: palette.selection,
        removed: palette.danger,
      }),
    [columns, rows, editing, lobs, palette],
  );
}

/** What a cell's editor gives, staged as the cell's text. */
function edited(props: GridProps): (cell: Item, value: EditableGridCell) => void {
  return (cell, value) => {
    if (value.kind === GridCellKind.Text) {
      props.onEdit(cell, value.data);
    }
  };
}

/** A result's grid. */
export function Grid(props: GridProps) {
  const { columns, rows, complete, onMore, onHeader, onCellMenu } = props;
  const choice = useStudio((s) => s.settings.theme);
  const name = shownTheme();
  const grid = useGridColumns(props);
  const content = useContent(props, name);
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
        rows={rows.length + (props.editing?.edits.added.length ?? 0)}
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
        onCellEdited={edited(props)}
        onCellContextMenu={(cell, event) => {
          event.preventDefault();
          onCellMenu(cell, { x: event.bounds.x + event.localEventX, y: event.bounds.y + event.localEventY });
        }}
      />
    </div>
  );
}
