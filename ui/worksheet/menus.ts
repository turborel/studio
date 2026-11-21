/**
 * The context menus of a worksheet (RULES.md D53): of its editor, the
 * worksheet's commands of the registry; of its tab, close it, the others
 * or those to its right, pin, rename, duplicate, and show its connection.
 */
import type { MenuEntry, MenuItem } from "../shell/ContextMenu";
import { prompted } from "../shell/PromptDialog";
import { activate } from "../state/actions";
import type { Store } from "../state/store";
import { changeWorksheet, closeWorksheet, openWorksheet, type WorksheetState, worksheetOf } from "../state/worksheets";

/** The menu of a worksheet's editor, of the commands `entry` gives. */
export function editorMenu(entry: (id: string) => MenuEntry): MenuItem[] {
  return [
    entry("worksheet.run"),
    entry("worksheet.runScript"),
    entry("worksheet.explain"),
    entry("worksheet.explainAnalyze"),
    "separator",
    entry("worksheet.format"),
    entry("worksheet.comment"),
    entry("worksheet.upperCase"),
    entry("worksheet.lowerCase"),
    "separator",
    entry("worksheet.definition"),
    entry("worksheet.describe"),
    entry("worksheet.find"),
    entry("worksheet.favourite"),
  ];
}

/** The items that rename worksheet `w` and make a copy of it. */
function copyItems(store: Store, w: WorksheetState): MenuItem[] {
  return [
    {
      label: "Rename…",
      icon: "edit",
      run: async () => {
        const title = await prompted(store, "Rename Worksheet", "Title", w.title);
        if (title !== null) {
          changeWorksheet(store, w.id, (x) => ({ ...x, title }));
        }
      },
    },
    {
      label: "Duplicate",
      icon: "copy",
      run: () => {
        const copy = openWorksheet(store, w.text, `${w.title} (copy)`);
        changeWorksheet(store, copy, (x) => ({ ...x, connection: w.connection }));
      },
    },
  ];
}

/** The menu of worksheet `id`'s tab, of the worksheets of its group, `group`, in order. */
export function tabMenu(store: Store, id: string, group: readonly string[]): MenuItem[] {
  const w = worksheetOf(store.current(), id);
  if (w === undefined) {
    return [];
  }
  const closeAll = (ids: readonly string[]) => () => {
    for (const other of ids) {
      if (worksheetOf(store.current(), other)?.pinned === false) {
        closeWorksheet(store, other);
      }
    }
  };
  const at = group.indexOf(id);
  return [
    {
      label: "Close",
      icon: "close",
      run: () => {
        closeWorksheet(store, id);
      },
    },
    { label: "Close Others", icon: "closeOthers", run: closeAll(group.filter((g) => g !== id)) },
    { label: "Close to the Right", run: closeAll(at === -1 ? [] : group.slice(at + 1)) },
    "separator",
    {
      label: w.pinned ? "Unpin Tab" : "Pin Tab",
      icon: w.pinned ? "unpin" : "pin",
      run: () => {
        changeWorksheet(store, id, (x) => ({ ...x, pinned: !x.pinned }));
      },
    },
    ...copyItems(store, w),
    {
      label: "Reveal Connection",
      icon: "connection",
      disabled: w.connection === null,
      run: () => {
        if (w.connection !== null) {
          activate(store, w.connection);
        }
      },
    },
  ];
}
