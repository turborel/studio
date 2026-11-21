/**
 * The context menus of a model's diagram (RULES.md D53): of a table, edit
 * it, add the tables its foreign keys reference, hide it, script it, and
 * remove it from the model; of the diagram, add a table, lay it out
 * again, and show the tables hidden.
 */
import { namer } from "../data/ddl";
import { attempt } from "../state/actions";
import type { Store } from "../state/store";
import { changeWorksheet, openWorksheet } from "../state/worksheets";
import type { MenuItem } from "../shell/ContextMenu";
import { copyText } from "../explorer/menus";
import { laidOut } from "./layout";
import { merged, readModel } from "./live";
import { createSql } from "./migrate";
import { tableKey } from "./model";
import { changeModel, editModel, type ModelDoc } from "./models";

/** What a model's tab opens, of its dialogs. */
export interface ModelOpens {
  readonly add: () => void;
  readonly edit: (key: string) => void;
}

/** Adds to `doc` the tables the foreign keys of table `key` reference, each read whole of its connection. */
async function addReferenced(store: Store, doc: ModelDoc, key: string): Promise<void> {
  const t = doc.model.tables.find((x) => tableKey(x) === key);
  const connection = doc.connection;
  if (t === undefined || connection === null) {
    return;
  }
  const have = new Set(doc.model.tables.map(tableKey));
  const wanted = t.foreignKeys.map((f) => f.references).filter((r) => !have.has(`${r.schema}.${r.table}`));
  await attempt(store, async () => {
    let model = doc.model;
    for (const schema of new Set(wanted.map((r) => r.schema))) {
      const tables = [...new Set(wanted.filter((r) => r.schema === schema).map((r) => r.table))];
      model = merged(model, await readModel(connection, schema, { tables, name: model.name }));
    }
    editModel(store, doc.id, () => laidOut(model));
  });
}

/** The menu of table `key` of model `doc`. */
export function tableNodeMenu(store: Store, doc: ModelDoc, key: string, opens: ModelOpens): MenuItem[] {
  const t = doc.model.tables.find((x) => tableKey(x) === key);
  const sql = () => (t === undefined ? "" : createSql(t, namer(store.current().reservedWords)));
  return [
    {
      label: "Edit Table…",
      icon: "edit",
      run: () => {
        opens.edit(key);
      },
    },
    {
      label: "Add Referenced Tables",
      icon: "foreignKey",
      disabled: doc.connection === null || t === undefined || t.foreignKeys.length === 0,
      run: () => addReferenced(store, doc, key),
    },
    {
      label: "Hide from Diagram",
      icon: "close",
      run: () => {
        changeModel(store, doc.id, (d) => ({ ...d, hidden: [...d.hidden, key], selected: null }));
      },
    },
    {
      label: "Script As CREATE",
      icon: "definition",
      items: [
        {
          label: "To Worksheet",
          icon: "worksheet",
          run: () => {
            const id = openWorksheet(store, sql(), key);
            changeWorksheet(store, id, (w) => ({ ...w, connection: doc.connection ?? w.connection }));
          },
        },
        { label: "To Clipboard", icon: "copy", run: () => copyText(store, sql()) },
      ],
    },
    "separator",
    {
      label: "Remove from Model",
      icon: "remove",
      destructive: true,
      run: () => {
        editModel(store, doc.id, (m) => ({ ...m, tables: m.tables.filter((x) => tableKey(x) !== key) }));
      },
    },
  ];
}

/** The menu of model `doc`'s diagram. */
export function diagramMenu(store: Store, doc: ModelDoc, opens: ModelOpens): MenuItem[] {
  return [
    { label: "Add Table…", icon: "table", run: opens.add },
    {
      label: "Lay Out Again",
      icon: "layout",
      run: () => {
        editModel(store, doc.id, (m) => laidOut(m, true));
      },
    },
    {
      label: "Show Hidden Tables",
      disabled: doc.hidden.length === 0,
      run: () => {
        changeModel(store, doc.id, (d) => ({ ...d, hidden: [] }));
      },
    },
  ];
}
