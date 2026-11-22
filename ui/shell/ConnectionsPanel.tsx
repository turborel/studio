/**
 * The connections in the explorer (RULES.md D28, D59, R-UI-1, R-UI-3), as
 * a tree of sections, each folded or not: those open, each with its
 * colour and its state, made active by a click or Enter, an in-memory
 * database's marked as not saved; then the saved ones, the pinned first,
 * then by folder, then the recent, each with its host or folder muted and
 * whether it is open, connected by a double click or Enter. Each row's
 * actions are of its context menu, by the pointer's second button or
 * Shift+F10: connect, disconnect, edit, pin, duplicate and delete.
 */
import type { KeyboardEvent } from "react";
import type { SavedConnection, SavedView } from "../ipc/saved";
import { activate, connectSaved, disconnect, forget, reconnectOpen, save, show } from "../state/actions";
import { loadSchemas } from "../state/catalog";
import { type OpenConnection, type Store, useStore, useStudio } from "../state/store";
import { copyText, newWorksheetOn, uriOf } from "../explorer/menus";
import { type MenuItem, useMenu } from "./ContextMenu";
import { prompted } from "./PromptDialog";
import { type Folder, tree } from "./connectionsTree";
import { tint } from "./environment";
import { Icon } from "../icons/Icon";
import "./embedded.css";

/** A colour's swatch. */
function Swatch({ colour }: { readonly colour: string | null }) {
  return <span className="swatch" aria-hidden="true" style={{ background: colour ?? "transparent" }} />;
}

/** Shows the dialog that edits saved connection `c`: of an embedded database, or of a server. */
export function editSaved(store: Store, c: SavedConnection): void {
  show(store, c.embedded == null ? { kind: "connection", editing: c } : { kind: "embedded", mode: "open", editing: c });
}

/** The items of saved connection `c`'s menu that edit it, and copy its URI or its database's folder. */
function savedItems(store: Store, c: SavedConnection): MenuItem[] {
  const copy: MenuItem =
    c.embedded == null
      ? { label: "Copy URI", icon: "copy", run: () => copyText(store, uriOf(c.spec)) }
      : { label: "Copy Folder Path", icon: "copy", run: () => copyText(store, c.embedded?.directory ?? "") };
  return [
    {
      label: "Edit Connection…",
      icon: "edit",
      run: () => {
        editSaved(store, c);
      },
    },
    copy,
  ];
}

/** The menu of saved connection `c`. */
export function savedMenu(store: Store, c: SavedConnection): MenuItem[] {
  return [
    { label: "Connect", icon: "connect", run: () => connectSaved(store, c, null) },
    ...savedItems(store, c),
    {
      label: c.pinned ? "Unpin" : "Pin",
      icon: "pin",
      run: () => save(store, { ...c, pinned: !c.pinned }, { kind: "keep" }),
    },
    {
      label: "Duplicate",
      icon: "copy",
      // A copy of its settings, new and of a name of its own; its password stays the original's alone.
      run: () => save(store, { ...c, id: "", name: `${c.name} (copy)`, pinned: false }, { kind: "keep" }),
    },
    "separator",
    {
      label: "Delete…",
      icon: "remove",
      destructive: true,
      run: async () => {
        const typed = await prompted(store, `Delete ${c.name}`, `Type ${c.name} to delete the saved connection`);
        if (typed === c.name) {
          await forget(store, c.id);
        }
      },
    },
  ];
}

/** The menu of open connection `connection`. */
export function openMenuOf(store: Store, connection: OpenConnection): MenuItem[] {
  const saved = store.current().saved.connections.find((v) => v.connection.id === connection.savedId)?.connection;
  return [
    {
      label: "New Worksheet",
      icon: "newWorksheet",
      run: () => newWorksheetOn(store, connection.id, null).then(() => undefined),
    },
    {
      label: "Run SQL File…",
      icon: "runScript",
      run: () => {
        show(store, { kind: "data", task: { kind: "runSqlFile", connection: connection.id } });
      },
    },
    { label: "Refresh Catalog", icon: "reconnect", run: () => loadSchemas(store, connection.id) },
    {
      label: "Analyze Schema…",
      icon: "analyze",
      run: () => {
        show(store, {
          kind: "analyzer",
          connection: connection.id,
          schema: connection.session.schema ?? connection.session.authorization,
        });
      },
    },
    "separator",
    ...(saved === undefined ? [] : savedItems(store, saved)),
    { label: "Reconnect", icon: "reconnect", run: () => reconnectOpen(store, connection.id) },
    { label: "Disconnect", icon: "disconnect", run: () => disconnect(store, connection.id) },
  ];
}

/** The state of an open connection, or of a saved one open, as a dot: open, lost, or none of one not open. */
function StateDot({ state }: { readonly state: "open" | "lost" | null }) {
  if (state === null) {
    return null;
  }
  return (
    <span
      className={`state-dot state-${state}`}
      role="img"
      aria-label={state === "open" ? "open" : "lost"}
      title={state}
    />
  );
}

/** Runs `act` as Enter is pressed on a row, its menu's keys first. */
function enterTo(act: () => void, keys: (e: KeyboardEvent<HTMLElement>) => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    keys(e);
    if (!e.defaultPrevented && e.key === "Enter") {
      e.preventDefault();
      act();
    }
  };
}

/** A saved connection's row: connected by a double click or Enter, its actions of its menu. */
function SavedItem({ view }: { readonly view: SavedView }) {
  const store = useStore();
  const c: SavedConnection = view.connection;
  const open = useStudio((s) => s.open.find((o) => o.savedId === c.id));
  const connect = () => void connectSaved(store, c, null);
  const menu = useMenu(() => savedMenu(store, c));
  const detail = c.embedded?.directory ?? c.spec.host ?? c.spec.uri ?? c.spec.service ?? undefined;
  const state = open === undefined ? null : open.session.lost ? "lost" : "open";
  return (
    <li
      role="treeitem"
      aria-selected="false"
      aria-label={c.name}
      className="tree-item"
      tabIndex={0}
      title={detail === undefined ? c.name : `${c.name}: ${detail}`}
      onContextMenu={menu.onContextMenu}
      onKeyDown={enterTo(connect, menu.onKeyDown)}
      onDoubleClick={connect}
    >
      <Swatch colour={tint(c.environment, c.colour)} />
      <Icon name={c.embedded == null ? "connection" : "embedded"} />
      <span className="tree-name">{c.name}</span>
      {detail !== undefined && <span className="tree-detail">{detail}</span>}
      <StateDot state={state} />
    </li>
  );
}

/** A folder, its folders and its connections. */
function FolderItems({ folder }: { readonly folder: Folder }) {
  return (
    <>
      {folder.folders.map((child) => (
        <li key={child.name} role="treeitem" aria-expanded="true" aria-selected="false">
          <span className="tree-folder with-icon">
            <Icon name="folder" />
            {child.name}
          </span>
          <ul role="group">
            <FolderItems folder={child} />
          </ul>
        </li>
      ))}
      {folder.connections.map((view) => (
        <SavedItem key={view.connection.id} view={view} />
      ))}
    </>
  );
}

/** The icon of an open connection, by what it is of. */
const ICON_OF = {
  tls: "connection",
  local: "connection",
  plain: "connection",
  embedded: "embedded",
  inMemory: "inMemory",
} as const;

/** An open connection's row: made active by a click or Enter, its actions of its menu. */
function OpenItem({ connection, active }: { readonly connection: OpenConnection; readonly active: boolean }) {
  const store = useStore();
  const menu = useMenu(() => openMenuOf(store, connection));
  const choose = () => {
    activate(store, connection.id);
  };
  const memory = connection.session.transport === "inMemory";
  return (
    <li
      role="treeitem"
      aria-selected={active}
      aria-label={connection.name}
      className={active ? "tree-item tree-active" : "tree-item"}
      tabIndex={0}
      onClick={choose}
      onContextMenu={menu.onContextMenu}
      onKeyDown={enterTo(choose, menu.onKeyDown)}
    >
      <Swatch colour={tint(connection.guards.environment, connection.colour)} />
      <Icon name={ICON_OF[connection.session.transport]} />
      <span className="tree-name">{connection.name}</span>
      {memory ? (
        <span className="badge-unsaved">not saved</span>
      ) : (
        <StateDot state={connection.session.lost ? "lost" : "open"} />
      )}
    </li>
  );
}

/** A section of the connections, folded or not, of heading `title`. */
function Section({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <details className="explorer-section" open>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

/** The connections' panel of the explorer: open, pinned, saved and recent. */
export function ConnectionsPanel() {
  const saved = useStudio((s) => s.saved);
  const open = useStudio((s) => s.open);
  const active = useStudio((s) => s.active);
  const { pinned, root, recent } = tree(saved);
  return (
    <div className="connections-panel">
      <Section title="Open">
        <ul role="tree" aria-label="Open connections">
          {open.length === 0 && <li className="hint">No connection is open.</li>}
          {open.map((c) => (
            <OpenItem key={c.id} connection={c} active={c.id === active} />
          ))}
        </ul>
      </Section>
      {pinned.length > 0 && (
        <Section title="Pinned">
          <ul role="tree" aria-label="Pinned connections">
            {pinned.map((view) => (
              <SavedItem key={view.connection.id} view={view} />
            ))}
          </ul>
        </Section>
      )}
      <Section title="Saved">
        <ul role="tree" aria-label="Saved connections">
          <FolderItems folder={root} />
        </ul>
      </Section>
      {recent.length > 0 && (
        <Section title="Recent">
          <ul role="tree" aria-label="Recent connections">
            {recent.map((view) => (
              <SavedItem key={view.connection.id} view={view} />
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
