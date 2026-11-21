/**
 * A model's tab (RULES.md D46): its name, its toolbar, its diagram, and
 * beside it the table selected and the property graphs. The toolbar reads
 * tables of a live schema, adds, edits and removes a table, lays the
 * diagram out again, filters, searches and groups it, exports it as SVG
 * or PNG, saves the model, and compares it with a live schema.
 */
import { useState } from "react";
import { saveTextFile } from "../ipc/catalog";
import { saveBinaryFile } from "../ipc/model";
import { Icon, type IconName, LARGE } from "../icons/Icon";
import { useStore, useStudio } from "../state/store";
import { Diagram } from "./Diagram";
import { pngOf, svgSize } from "./image";
import { laidOut } from "./layout";
import { tableKey } from "./model";
import { CompareWithSchemaDialog, thrownText, ReadSchemaDialog } from "./ModelDialogs";
import { changeModel, editModel, type ModelDoc, modelOf, saveModel } from "./models";
import { modelSvg } from "./svg";
import { TableEditor } from "./TableEditor";
import { diagramMenu, tableNodeMenu } from "./menus";
import { openMenu } from "../shell/ContextMenu";

/** A dialog of a model open: which. */
type Open = "read" | "compare" | "add" | "edit" | null;

/** A button of the toolbar: its icon, and its name as its tooltip and accessible name. */
function Tool(props: {
  readonly icon: IconName;
  readonly name: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
}) {
  return (
    <button
      type="button"
      className="tool"
      title={props.name}
      aria-label={props.name}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size={LARGE} />
    </button>
  );
}

/** Exports `doc`'s diagram as SVG or PNG, told in the model's note. */
async function exportDiagram(store: ReturnType<typeof useStore>, doc: ModelDoc, as: "svg" | "png"): Promise<void> {
  const svg = modelSvg(doc.model);
  try {
    const path =
      as === "svg"
        ? await saveTextFile(`${doc.model.name}.svg`, svg)
        : await saveBinaryFile(`${doc.model.name}.png`, await pngOf(svg, svgSize(svg)));
    if (path !== null) {
      changeModel(store, doc.id, (d) => ({ ...d, told: `Exported to ${path}.` }));
    }
  } catch (thrown: unknown) {
    changeModel(store, doc.id, (d) => ({ ...d, told: thrownText(thrown) }));
  }
}

/** The toolbar's tools of the model's tables. */
function TableTools({ doc, open }: { readonly doc: ModelDoc; readonly open: (o: Open) => void }) {
  const store = useStore();
  const none = !doc.model.tables.some((t) => tableKey(t) === doc.selected);
  return (
    <span className="tool-group" role="group" aria-label="Tables">
      <Tool
        icon="schema"
        name="Read Tables of a Schema…"
        onClick={() => {
          open("read");
        }}
      />
      <Tool
        icon="addRow"
        name="Add Table…"
        onClick={() => {
          open("add");
        }}
      />
      <Tool
        icon="edit"
        name="Edit Table…"
        disabled={none}
        onClick={() => {
          open("edit");
        }}
      />
      <Tool
        icon="remove"
        name="Remove Table"
        disabled={none}
        onClick={() => {
          editModel(store, doc.id, (m) => ({ ...m, tables: m.tables.filter((t) => tableKey(t) !== doc.selected) }));
        }}
      />
      <Tool
        icon="layout"
        name="Lay Out Again"
        onClick={() => {
          editModel(store, doc.id, (m) => laidOut(m, true));
        }}
      />
    </span>
  );
}

/** The toolbar's tools of the model's file, its exports and its comparison. */
function FileTools({ doc, open }: { readonly doc: ModelDoc; readonly open: (o: Open) => void }) {
  const store = useStore();
  return (
    <span className="tool-group" role="group" aria-label="Model">
      <Tool icon="save" name="Save Model" onClick={() => void saveModel(store, doc.id)} />
      <Tool icon="saveAs" name="Save Model As…" onClick={() => void saveModel(store, doc.id, true)} />
      <Tool icon="export" name="Export as SVG…" onClick={() => void exportDiagram(store, doc, "svg")} />
      <Tool icon="image" name="Export as PNG…" onClick={() => void exportDiagram(store, doc, "png")} />
      <Tool
        icon="compare"
        name="Compare with a Schema…"
        onClick={() => {
          open("compare");
        }}
      />
    </span>
  );
}

/** The toolbar's fields of the model's name, its filter and search, and whether it is grouped. */
function ShowTools({
  doc,
  search,
  onSearch,
}: {
  readonly doc: ModelDoc;
  readonly search: string;
  readonly onSearch: (s: string) => void;
}) {
  const store = useStore();
  return (
    <span className="tool-group model-fields" role="group" aria-label="Show">
      <input
        aria-label="Model name"
        value={doc.model.name}
        onChange={(e) => {
          editModel(store, doc.id, (m) => ({ ...m, name: e.target.value }));
        }}
      />
      <input
        aria-label="Filter tables"
        placeholder="Filter"
        value={doc.filter}
        onChange={(e) => {
          changeModel(store, doc.id, (d) => ({ ...d, filter: e.target.value }));
        }}
      />
      <input
        aria-label="Search tables"
        placeholder="Search"
        value={search}
        onChange={(e) => {
          onSearch(e.target.value);
        }}
      />
      <Tool
        icon="folder"
        name="Group by Schema"
        pressed={doc.grouped}
        onClick={() => {
          changeModel(store, doc.id, (d) => ({ ...d, grouped: !d.grouped }));
        }}
      />
    </span>
  );
}

/** The property graphs of the model, each its element tables. */
function Graphs({ doc }: { readonly doc: ModelDoc }) {
  if (doc.model.graphs.length === 0) {
    return null;
  }
  return (
    <section aria-label="Property graphs">
      <h4>Property graphs</h4>
      <ul>
        {doc.model.graphs.map((g) => (
          <li key={`${g.schema}.${g.name}`}>
            {g.schema}.{g.name}: {g.elements.map((e) => `${e.alias} (${e.kind.toLowerCase()})`).join(", ")}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The menu of table `key` of `doc`, or of its diagram where `key` is null, its dialogs opened by `setOpen`. */
function modelMenu(store: ReturnType<typeof useStore>, doc: ModelDoc, key: string | null, setOpen: (o: Open) => void) {
  const opens = {
    add: () => {
      setOpen("add");
    },
    edit: (k: string) => {
      changeModel(store, doc.id, (d) => ({ ...d, selected: k }));
      setOpen("edit");
    },
  };
  return key === null ? diagramMenu(store, doc, opens) : tableNodeMenu(store, doc, key, opens);
}

/** Model `id`'s tab. */
export function ModelView({ id }: { readonly id: string }) {
  const store = useStore();
  const doc = useStudio((s) => modelOf(s, id));
  const [open, setOpen] = useState<Open>(null);
  const [search, setSearch] = useState("");
  if (doc === undefined) {
    return null;
  }
  const close = () => {
    setOpen(null);
  };
  const selected = doc.model.tables.find((t) => tableKey(t) === doc.selected) ?? null;
  return (
    <div className="model-view">
      <div className="result-toolbar" role="toolbar" aria-label="Model">
        <TableTools doc={doc} open={setOpen} />
        <FileTools doc={doc} open={setOpen} />
        <ShowTools doc={doc} search={search} onSearch={setSearch} />
      </div>
      <div className="model-body">
        <Diagram
          doc={doc}
          search={search}
          onMove={(key, at) => {
            editModel(store, id, (m) => ({
              ...m,
              tables: m.tables.map((t) => (tableKey(t) === key ? { ...t, position: at } : t)),
            }));
          }}
          onSelect={(key) => {
            changeModel(store, id, (d) => ({ ...d, selected: key }));
          }}
          onMenu={(key, at) => {
            openMenu(store, at, modelMenu(store, doc, key, setOpen));
          }}
        />
        <Graphs doc={doc} />
      </div>
      <p className="hint" role="status">
        {String(doc.model.tables.length)} tables{doc.modified ? ", changed since saved" : ""}. {doc.told}
      </p>
      {open === "read" && <ReadSchemaDialog doc={doc} onClose={close} />}
      {open === "compare" && <CompareWithSchemaDialog doc={doc} onClose={close} />}
      {open === "add" && <TableEditor doc={doc} old={null} onClose={close} />}
      {open === "edit" && selected !== null && <TableEditor doc={doc} old={selected} onClose={close} />}
    </div>
  );
}
