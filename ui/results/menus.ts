/**
 * The context menus of a result's grid (RULES.md D53): of a cell, copy in
 * each format, filter by its value, sort by its column, hide or freeze
 * columns, view its value or its row, edit the rows, set it to NULL, and
 * export the cells selected; of a header, sort, hide and freeze.
 */
import { CompactSelection, type GridSelection, type Item } from "@glideapps/glide-data-grid";
import { saveTextFile } from "../ipc/catalog";
import { attempt } from "../state/actions";
import type { Store } from "../state/store";
import type { RunResult } from "../state/worksheets";
import type { MenuEntry, MenuItem } from "../shell/ContextMenu";
import { type Chosen, chosenCells, copyCells, insertTable, queryOf, requery, requeryable } from "./actions";
import { COPY_FORMATS, copied, type CopyFormat } from "./copy";
import { editCell } from "./edits";
import { beginEditing, stage } from "./editing";
import { editable } from "./Grid";
import { narrowed, valueCondition } from "./requery";
import { allOf, chosenOf } from "./selection";

/** What a result's view is, as its menus change it. */
export interface MenuView {
  readonly selection: GridSelection;
  readonly freeze: number;
  readonly hidden: readonly number[];
}

/** What a result's menus are of: the worksheet, the run, the view, and its change. */
export interface MenuParts {
  readonly id: string;
  readonly run: RunResult;
  readonly view: MenuView;
  readonly change: (next: Partial<MenuView> & { viewing?: boolean; record?: number; mode?: "record" }) => void;
}

/** The selection of cell `cell` alone. */
export function oneCell(cell: Item): GridSelection {
  return {
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
    current: { cell, range: { x: cell[0], y: cell[1], width: 1, height: 1 }, rangeStack: [] },
  };
}

/** The cells a menu acts on: those selected, if `cell` is among them, else `cell` alone. */
function acted({ run, view }: MenuParts, cell: Item): Chosen {
  const chosen = chosenOf(view.selection, run.rows.length, run.columns.length);
  const holds = chosen !== null && chosen.rows.includes(cell[1]) && chosen.columns.includes(cell[0]);
  return holds ? chosen : { rows: [cell[1]], columns: [cell[0]] };
}

/** The items that copy the cells acted on: as text, with headers, and in each format. */
function copyItems(store: Store, parts: MenuParts, chosen: Chosen): MenuItem[] {
  const copy = (format: CopyFormat, headers: boolean) => () =>
    copyCells(store, parts.id, parts.run.id, { format, headers }, chosen);
  return [
    { label: "Copy", icon: "copy", key: "Mod+C", run: copy("tsv", false) },
    { label: "Copy with Headers", icon: "copy", run: copy("tsv", true) },
    {
      label: "Copy As",
      icon: "copy",
      items: COPY_FORMATS.map(([format, name]) => ({ label: name, run: copy(format, true) })),
    },
  ];
}

/** The items that sort by column `column` on the server. */
function sortItems(store: Store, { id, run }: MenuParts, column: number): MenuItem[] {
  const can = !requeryable(run);
  const sort = (descending: boolean) => () =>
    requery(store, id, run.id, (q) => ({ ...q, sort: [{ column, descending }] }));
  return [
    { label: "Sort Ascending", icon: "sort", disabled: can, run: sort(false) },
    { label: "Sort Descending", icon: "sort", disabled: can, run: sort(true) },
  ];
}

/** The items that hide column `column`, freeze up to it, and let both go. */
function columnItems(parts: MenuParts, column: number): MenuItem[] {
  const { view, change } = parts;
  return [
    {
      label: "Hide Column",
      icon: "close",
      run: () => {
        change({ hidden: [...view.hidden, column] });
      },
    },
    {
      label: "Show Hidden Columns",
      disabled: view.hidden.length === 0,
      run: () => {
        change({ hidden: [] });
      },
    },
    {
      label: "Freeze Up to This Column",
      run: () => {
        change({ freeze: column + 1 });
      },
    },
    {
      label: "Unfreeze Columns",
      disabled: view.freeze === 0,
      run: () => {
        change({ freeze: 0 });
      },
    },
  ];
}

/** The item that filters to `cell`'s value, or out of it; disabled of a value no comparison takes, or of no query. */
function filterItem(store: Store, { id, run }: MenuParts, cell: Item, excluding: boolean): MenuEntry {
  const condition = valueCondition(run.columns, cell[0], run.rows[cell[1]]?.[cell[0]] ?? null, excluding);
  return {
    label: excluding ? "Filter Out This Value" : "Filter to This Value",
    icon: "filter",
    disabled: condition === null || !requeryable(run),
    run: () => requery(store, id, run.id, (q) => ({ ...q, filter: narrowed(q.filter, condition ?? "") })),
  };
}

/** Saves the cells `chosen` of `run` as CSV, with headers, where the platform's dialog says. */
async function exportChosen(store: Store, run: RunResult, chosen: Chosen): Promise<void> {
  await attempt(store, () =>
    saveTextFile(
      "selection.csv",
      copied("csv", chosenCells(run, chosen), { headers: true, table: insertTable(queryOf(run).sql) }),
    ),
  );
}

/** The menu of cell `cell` of a result. */
export function cellMenu(store: Store, parts: MenuParts, cell: Item): MenuItem[] {
  const { id, run, change } = parts;
  const chosen = acted(parts, cell);
  const nullable = editable({ columns: run.columns, rows: run.rows, editing: run.editing, lobs: run.lobs }, cell);
  return [
    ...copyItems(store, parts, chosen),
    "separator",
    filterItem(store, parts, cell, false),
    filterItem(store, parts, cell, true),
    ...sortItems(store, parts, cell[0]),
    ...columnItems(parts, cell[0]),
    "separator",
    {
      label: "View Value",
      icon: "details",
      run: () => {
        change({ selection: oneCell(cell), viewing: true });
      },
    },
    {
      label: "Show in Record View",
      icon: "record",
      run: () => {
        change({ record: cell[1], mode: "record" });
      },
    },
    { label: "Edit Rows", icon: "edit", disabled: run.editing !== null, run: () => beginEditing(store, id, run.id) },
    {
      label: "Set to NULL",
      disabled: !nullable,
      run: () => {
        stage(store, id, run.id, (e) => editCell(e, cell, null, run.rows.length));
      },
    },
    "separator",
    { label: "Export Selection…", icon: "export", run: () => exportChosen(store, run, chosen) },
  ];
}

/** The menu of column `column`'s header. */
export function headerMenu(store: Store, parts: MenuParts, column: number): MenuItem[] {
  const { run } = parts;
  const all = allOf(run.rows.length, run.columns.length);
  const columnOnly: Chosen = { rows: all.rows, columns: [column] };
  return [
    ...sortItems(store, parts, column),
    ...columnItems(parts, column),
    "separator",
    ...copyItems(store, parts, columnOnly),
  ];
}
