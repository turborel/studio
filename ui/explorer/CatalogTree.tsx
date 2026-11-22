/**
 * The catalog's tree of the active connection (RULES.md D33, R-UI-1,
 * R-UI-3): schemas, their tables, views, routines, sequences and domains,
 * a table's columns, keys, indexes and triggers, the users and roles; read
 * as it opens. The arrow keys move through it, Right opens a node, Left
 * closes it, and Enter selects; its search, shown by the explorer's
 * Filter or Ctrl+F, filters it by name as typed, or finds definitions on
 * the server.
 */
import { type KeyboardEvent, useEffect, useState } from "react";
import {
  filterTree,
  loadSchemas,
  scriptChosen,
  searchCatalog,
  select,
  showSearch,
  toggle,
  toggleChosen,
} from "../state/catalog";
import { openWorksheet } from "../state/worksheets";
import { TABLE_DRAG } from "../worksheet/editor/extensions";
import type { ObjectRef } from "../ipc/catalog";
import { type Store, useStore, useStudio } from "../state/store";
import { EMPTY_CATALOG, type Selected } from "./catalogState";
import { Favourites } from "./Favourites";
import { iconOf, type TreeRow, treeRows, nodeId } from "./tree";
import { Icon } from "../icons/Icon";
import { type MenuItem, useMenu } from "../shell/ContextMenu";
import { objectMenu, type PartOf, partMenu, schemaMenu, tableMenu } from "./menus";
import { accountMenu, securityMenu } from "../admin/menus";
import { SEP } from "./tree";

/** The rows of the tree, each focused in turn by the arrow keys. */
function moveFocus(event: KeyboardEvent<HTMLElement>, step: number): void {
  const tree = event.currentTarget.closest("[role='tree']");
  const items = [...(tree?.querySelectorAll<HTMLElement>("[role='treeitem']") ?? [])];
  const at = items.indexOf(event.currentTarget);
  items[Math.max(0, Math.min(items.length - 1, at + step))]?.focus();
}

/** What a row's keys do: the arrows move and open or close, Enter chooses. */
function rowKeys(row: TreeRow, open: () => void, choose: () => void): (event: KeyboardEvent<HTMLDivElement>) => void {
  return (event) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => {
        moveFocus(event, 1);
      },
      ArrowUp: () => {
        moveFocus(event, -1);
      },
      ArrowRight: () => {
        if (row.expandable && !row.expanded) {
          open();
        }
      },
      ArrowLeft: () => {
        if (row.expandable && row.expanded) {
          open();
        }
      },
      Enter: choose,
    };
    const act = keys[event.key];
    if (act !== undefined) {
      event.preventDefault();
      act();
    }
  };
}

/** A row's icon, of its kind, if it has one. */
function RowIcon({ row }: { row: TreeRow }) {
  const icon = iconOf(row);
  return icon === null ? null : <Icon name={icon} />;
}

/** Carries a table dragged from the tree, for the editor to write a query of it where it is dropped. */
function dragged(event: React.DragEvent, row: TreeRow): void {
  const table = row.select?.kind === "table" ? row.select : null;
  if (table !== null) {
    event.dataTransfer.setData(TABLE_DRAG, JSON.stringify({ schema: table.schema, name: table.name }));
    event.dataTransfer.effectAllowed = "copy";
  }
}

/** A row's triangle, which opens or closes it, or its place where it has none. */
function Twisty({ row, open }: { row: TreeRow; open: () => void }) {
  if (!row.expandable) {
    return <span className="tree-twisty" />;
  }
  return (
    <button
      type="button"
      className="tree-twisty"
      aria-label={row.expanded ? `Close ${row.label}` : `Open ${row.label}`}
      tabIndex={-1}
      onClick={open}
    >
      {row.expanded ? "▾" : "▸"}
    </button>
  );
}

/** The kinds of a table's parts, which have menus of their own. */
const PARTS: readonly string[] = ["column", "constraint", "index", "trigger"];

/** The menu of a row that selects nothing: a part of a table's, or the users and roles'. */
function partRowMenu(store: Store, connection: number, row: TreeRow): MenuItem[] {
  if (row.id === nodeId("security")) {
    return securityMenu(store, connection);
  }
  const [kind = "", schema = "", table = "", name = ""] = row.id.split(SEP);
  return PARTS.includes(kind) ? partMenu(store, connection, { kind: kind as PartOf["kind"], schema, table, name }) : [];
}

/** The menu of `row`, by its kind: none of a folder or a note. */
export function rowMenu(store: Store, connection: number, row: TreeRow): MenuItem[] {
  const select = row.select;
  switch (select?.kind) {
    case "schema":
      return schemaMenu(store, connection, select.schema);
    case "table":
      return tableMenu(store, connection, select.schema, select.name, row.icon === "view");
    case "routine":
    case "sequence":
    case "domain":
    case "type":
      return objectMenu(store, connection, select);
    case "user":
    case "role":
      return accountMenu(store, connection, select);
    default:
      return partRowMenu(store, connection, row);
  }
}

/** The handlers of a row's keys: its menu's first, then the tree's. */
function useRowHandlers(store: Store, connection: number, row: TreeRow, open: () => void, choose: () => void) {
  const menu = useMenu(() => rowMenu(store, connection, row));
  const keys = rowKeys(row, open, choose);
  return {
    onContextMenu: menu.onContextMenu,
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      menu.onKeyDown(e);
      if (!e.defaultPrevented) {
        keys(e);
      }
    },
  };
}

/** A row of the tree. */
function Row({ row, connection, selected }: { row: TreeRow; connection: number; selected: boolean }) {
  const store = useStore();
  const open = () => void toggle(store, connection, row.id);
  const choose = (event?: { metaKey: boolean; ctrlKey: boolean }) => {
    if (row.select === undefined) {
      return;
    }
    if (event !== undefined && (event.metaKey || event.ctrlKey)) {
      toggleChosen(store, connection, row.select);
    } else {
      void select(store, connection, row.select);
    }
  };
  const chosen = useStudio(
    (s) => s.catalogs[connection]?.chosen.some((c) => JSON.stringify(c) === JSON.stringify(row.select)) === true,
  );
  const handlers = useRowHandlers(store, connection, row, open, () => {
    choose();
  });
  const className = ["tree-row", selected ? "tree-active" : "", chosen ? "tree-chosen" : ""]
    .filter((c) => c !== "")
    .join(" ");
  return (
    <div
      role="treeitem"
      tabIndex={0}
      draggable={row.select?.kind === "table"}
      onDragStart={(e) => {
        dragged(e, row);
      }}
      aria-level={row.depth + 1}
      aria-expanded={row.expandable ? row.expanded : undefined}
      aria-selected={selected}
      className={className}
      style={{ paddingLeft: `${String(row.depth * 14 + 4)}px` }}
      {...handlers}
      onClick={(e) => {
        choose(e);
      }}
      onDoubleClick={open}
    >
      <Twisty row={row} open={open} />
      <RowIcon row={row} />
      <span>{row.label}</span>
      {row.note !== undefined && <span className="tree-note">{row.note}</span>}
    </div>
  );
}

/** Whether `a` and `b` name the same object. */
function same(a: Selected | undefined, b: Selected | undefined): boolean {
  return a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

/** What a found or favourite object selects: a table of a table, view or column, a routine, a sequence, a domain or a type; else nothing. */
export function selectable(object: ObjectRef): Selected | null {
  switch (object.kind) {
    case "TABLE":
    case "VIEW":
    case "COLUMN":
      return { kind: "table", schema: object.schema, name: object.name };
    case "ROUTINE":
      return { kind: "routine", schema: object.schema, specific: object.name, name: object.name };
    case "SEQUENCE":
    case "DOMAIN":
    case "TYPE":
      return {
        kind: object.kind === "SEQUENCE" ? "sequence" : object.kind === "DOMAIN" ? "domain" : "type",
        schema: object.schema,
        name: object.name,
      };
    default:
      return null;
  }
}

/** What the explorer's search looks in: the tree's names as they are typed, or the definitions as asked. */
type Scope = "names" | "definitions";

/** What the definitions' search found, each a link to it. */
function Found({ connection }: { connection: number }) {
  const store = useStore();
  const found = useStudio((s) => s.catalogs[connection]?.found ?? null);
  if (found === null) {
    return null;
  }
  return (
    <ul className="found" aria-label="Found">
      {found.length === 0 && <li className="hint">Nothing found.</li>}
      {found.map((f) => {
        const target = selectable(f.object);
        const label = `${f.object.kind} ${f.object.schema}.${f.object.name}${f.inDefinition ? " (in its definition)" : ""}`;
        return (
          <li key={`${f.object.kind}.${f.object.schema}.${f.object.name}.${String(f.inDefinition)}`}>
            {target === null ? (
              label
            ) : (
              <button type="button" className="link" onClick={() => void select(store, connection, target)}>
                {label}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The search's scope: pressed, the definitions too; else the names alone. */
function ScopeToggle({ scope, onScope }: { readonly scope: Scope; readonly onScope: (scope: Scope) => void }) {
  return (
    <button
      type="button"
      className="tool"
      aria-label="Search definitions too"
      title={scope === "names" ? "Names: filtered as typed" : "Definitions: searched by Enter"}
      aria-pressed={scope === "definitions"}
      onClick={() => {
        onScope(scope === "names" ? "definitions" : "names");
      }}
    >
      <Icon name="definition" />
    </button>
  );
}

/** The explorer's search, shown by its toolbar's Filter or Ctrl+F: one field, of a scope of names, filtered as typed, or of definitions, searched by Enter; Escape hides it. */
function Search({ connection }: { connection: number }) {
  const store = useStore();
  const [text, setText] = useState("");
  const [scope, setScope] = useState<Scope>("names");
  const run = (value: string, of: Scope) => {
    if (of === "names") {
      void filterTree(store, connection, value);
    } else if (value.trim() !== "") {
      void searchCatalog(store, connection, value);
    }
  };
  return (
    <div className="catalog-search" role="search">
      <input
        type="search"
        aria-label="Search the catalog"
        placeholder={scope === "names" ? "Filter by name" : "Search definitions, Enter"}
        value={text}
        autoFocus
        onChange={(e) => {
          setText(e.target.value);
          if (scope === "names") {
            run(e.target.value, scope);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            run(text, scope);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            showSearch(store, false);
          }
        }}
      />
      <ScopeToggle
        scope={scope}
        onScope={(next) => {
          setScope(next);
          if (next === "definitions") {
            void filterTree(store, connection, "");
          }
          run(text, next);
        }}
      />
      <Found connection={connection} />
    </div>
  );
}

/** The catalog's tree of connection `connection`. */
export function CatalogTree({ connection }: { readonly connection: number }) {
  const store = useStore();
  const catalog = useStudio((s) => s.catalogs[connection] ?? EMPTY_CATALOG);
  const selected = useStudio((s) => (s.selected?.connection === connection ? s.selected.object : undefined));
  useEffect(() => {
    if (catalog.schemas === null) {
      void loadSchemas(store, connection);
    }
  }, [store, connection, catalog.schemas]);
  const searching = useStudio((s) => s.explorerSearch);
  const rows = treeRows(catalog);
  return (
    <div className="catalog">
      {catalog.chosen.length > 0 && (
        <div className="catalog-bar">
          <button
            type="button"
            onClick={() =>
              void scriptChosen(store, connection).then((text) => text !== null && openWorksheet(store, text, "Script"))
            }
          >
            Script {String(catalog.chosen.length)} Chosen
          </button>
        </div>
      )}
      {searching && <Search connection={connection} />}
      <Favourites connection={connection} />
      <div role="tree" aria-label="Catalog">
        {rows.map((row) => (
          <Row key={row.id} row={row} connection={connection} selected={same(row.select, selected)} />
        ))}
      </div>
    </div>
  );
}
