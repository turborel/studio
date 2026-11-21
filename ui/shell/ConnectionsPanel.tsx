/**
 * The connections in the explorer (RULES.md D28, R-UI-1, R-UI-3): those
 * open, each with its colour, made active by a click; then the saved ones,
 * the pinned first, then by folder, then the recent; each connected,
 * edited, pinned or deleted from its own buttons.
 */
import { useState } from "react";
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

/** A colour's swatch. */
function Swatch({ colour }: { readonly colour: string | null }) {
  return <span className="swatch" aria-hidden="true" style={{ background: colour ?? "transparent" }} />;
}

/** A saved connection's delete button, which asks again before it deletes it. */
function DeleteButton({ connection: c }: { readonly connection: SavedConnection }) {
  const store = useStore();
  const [deleting, setDeleting] = useState(false);
  return deleting ? (
    <button type="button" aria-label={`Confirm deleting ${c.name}`} onClick={() => void forget(store, c.id)}>
      Delete {c.name}?
    </button>
  ) : (
    <button
      type="button"
      className="tool"
      aria-label={`Delete ${c.name}`}
      title="Delete"
      onClick={() => {
        setDeleting(true);
      }}
    >
      <Icon name="remove" />
    </button>
  );
}

/** The items of saved connection `c`'s menu that edit it, copy its URI, and delete it. */
function savedItems(store: Store, c: SavedConnection): MenuItem[] {
  return [
    {
      label: "Edit Connection…",
      icon: "edit",
      run: () => {
        show(store, { kind: "connection", editing: c });
      },
    },
    { label: "Copy URI", icon: "copy", run: () => copyText(store, uriOf(c.spec)) },
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

/** A saved connection's item, with its actions. */
function SavedItem({ view }: { readonly view: SavedView }) {
  const store = useStore();
  const c: SavedConnection = view.connection;
  const connect = () => void connectSaved(store, c, null);
  const menu = useMenu(() => savedMenu(store, c));
  return (
    <li role="treeitem" aria-selected="false" className="tree-item" tabIndex={0} {...menu}>
      <Swatch colour={tint(c.environment, c.colour)} />
      <Icon name="connection" />
      <span className="tree-name" onDoubleClick={connect}>
        {c.name}
      </span>
      <button type="button" className="tool" aria-label={`Connect to ${c.name}`} title="Connect" onClick={connect}>
        <Icon name="connect" />
      </button>
      <button
        type="button"
        className="tool"
        aria-label={`Edit ${c.name}`}
        title="Edit"
        onClick={() => {
          show(store, { kind: "connection", editing: c });
        }}
      >
        <Icon name="edit" />
      </button>
      <button
        type="button"
        className="tool"
        aria-label={`${c.pinned ? "Unpin" : "Pin"} ${c.name}`}
        aria-pressed={c.pinned}
        title={c.pinned ? "Unpin" : "Pin"}
        onClick={() => void save(store, { ...c, pinned: !c.pinned }, { kind: "keep" })}
      >
        <Icon name="pin" emphasis={c.pinned} />
      </button>
      <DeleteButton connection={c} />
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

/** An open connection's item. */
function OpenItem({ connection, active }: { readonly connection: OpenConnection; readonly active: boolean }) {
  const store = useStore();
  const menu = useMenu(() => openMenuOf(store, connection));
  return (
    <li
      role="treeitem"
      aria-selected={active}
      className={active ? "tree-item tree-active" : "tree-item"}
      tabIndex={0}
      {...menu}
    >
      <Swatch colour={tint(connection.guards.environment, connection.colour)} />
      <Icon name="connection" />
      <button
        type="button"
        className="tree-name"
        onClick={() => {
          activate(store, connection.id);
        }}
      >
        {connection.name}
        {connection.session.lost ? " (lost)" : ""}
      </button>
      <button
        type="button"
        className="tool"
        aria-label={`Disconnect ${connection.name}`}
        title="Disconnect"
        onClick={() => void disconnect(store, connection.id)}
      >
        <Icon name="disconnect" />
      </button>
    </li>
  );
}

/** The connections' panel of the explorer. */
export function ConnectionsPanel() {
  const store = useStore();
  const saved = useStudio((s) => s.saved);
  const open = useStudio((s) => s.open);
  const active = useStudio((s) => s.active);
  const { pinned, root, recent } = tree(saved);
  return (
    <div className="connections-panel">
      <button
        type="button"
        className="tool"
        onClick={() => {
          show(store, { kind: "connection", editing: null });
        }}
      >
        <Icon name="newConnection" />
        New Connection…
      </button>
      <h3>Open</h3>
      <ul role="tree" aria-label="Open connections">
        {open.length === 0 && <li className="hint">No connection is open.</li>}
        {open.map((c) => (
          <OpenItem key={c.id} connection={c} active={c.id === active} />
        ))}
      </ul>
      {pinned.length > 0 && <h3>Pinned</h3>}
      <ul role="tree" aria-label="Pinned connections">
        {pinned.map((view) => (
          <SavedItem key={view.connection.id} view={view} />
        ))}
      </ul>
      <h3>Saved</h3>
      <ul role="tree" aria-label="Saved connections">
        <FolderItems folder={root} />
      </ul>
      {recent.length > 0 && <h3>Recent</h3>}
      <ul role="tree" aria-label="Recent connections">
        {recent.map((view) => (
          <SavedItem key={view.connection.id} view={view} />
        ))}
      </ul>
    </div>
  );
}
