/**
 * The catalog's tree of the active connection (RULES.md D33, R-UI-1,
 * R-UI-3): schemas, their tables, views, routines, sequences and domains,
 * a table's columns, keys, indexes and triggers, the users and roles; read
 * as it opens. The arrow keys move through it, Right opens a node, Left
 * closes it, and Enter selects; typing filters it; a search finds names
 * and definitions on the server.
 */
import { type KeyboardEvent, useEffect, useState } from "react";
import { filterTree, loadSchemas, searchCatalog, select, toggle } from "../state/catalog";
import type { ObjectRef } from "../ipc/catalog";
import { useStore, useStudio } from "../state/store";
import { EMPTY_CATALOG, type Selected } from "./catalogState";
import { Favourites } from "./Favourites";
import { type TreeRow, treeRows } from "./tree";

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

/** A row of the tree. */
function Row({ row, connection, selected }: { row: TreeRow; connection: number; selected: boolean }) {
  const store = useStore();
  const open = () => void toggle(store, connection, row.id);
  const choose = () => {
    if (row.select !== undefined) {
      void select(store, connection, row.select);
    }
  };
  const keyDown = rowKeys(row, open, choose);
  return (
    <div
      role="treeitem"
      tabIndex={0}
      aria-level={row.depth + 1}
      aria-expanded={row.expandable ? row.expanded : undefined}
      aria-selected={selected}
      className={selected ? "tree-row tree-active" : "tree-row"}
      style={{ paddingLeft: `${String(row.depth * 14 + 4)}px` }}
      onKeyDown={keyDown}
      onClick={choose}
      onDoubleClick={open}
    >
      {row.expandable ? (
        <button
          type="button"
          className="tree-twisty"
          aria-label={row.expanded ? `Close ${row.label}` : `Open ${row.label}`}
          tabIndex={-1}
          onClick={open}
        >
          {row.expanded ? "▾" : "▸"}
        </button>
      ) : (
        <span className="tree-twisty" />
      )}
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

/** The search of names and definitions, and what it found. */
function Search({ connection }: { connection: number }) {
  const store = useStore();
  const [text, setText] = useState("");
  const found = useStudio((s) => s.catalogs[connection]?.found ?? null);
  return (
    <div className="catalog-search">
      <input
        aria-label="Filter the tree"
        placeholder="Filter"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          void filterTree(store, connection, e.target.value);
        }}
      />
      <button type="button" disabled={text.trim() === ""} onClick={() => void searchCatalog(store, connection, text)}>
        Search definitions
      </button>
      {found !== null && (
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
      )}
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
  const rows = treeRows(catalog);
  return (
    <div className="catalog">
      <div className="catalog-bar">
        <button type="button" onClick={() => void loadSchemas(store, connection)}>
          Refresh
        </button>
      </div>
      <Search connection={connection} />
      <Favourites connection={connection} />
      <div role="tree" aria-label="Catalog">
        {rows.map((row) => (
          <Row key={row.id} row={row} connection={connection} selected={same(row.select, selected)} />
        ))}
      </div>
    </div>
  );
}
