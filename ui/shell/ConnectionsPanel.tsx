/**
 * The connections in the explorer (RULES.md D28, R-UI-1, R-UI-3): those
 * open, each with its colour, made active by a click; then the saved ones,
 * the pinned first, then by folder, then the recent; each connected,
 * edited, pinned or deleted from its own buttons.
 */
import { useState } from "react";
import type { SavedConnection, SavedView } from "../ipc/saved";
import { activate, connectSaved, disconnect, forget, save, show } from "../state/actions";
import { type OpenConnection, useStore, useStudio } from "../state/store";
import { type Folder, tree } from "./connectionsTree";
import { tint } from "./environment";

/** A colour's swatch. */
function Swatch({ colour }: { readonly colour: string | null }) {
  return <span className="swatch" aria-hidden="true" style={{ background: colour ?? "transparent" }} />;
}

/** A saved connection's item, with its actions. */
function SavedItem({ view }: { readonly view: SavedView }) {
  const store = useStore();
  const [deleting, setDeleting] = useState(false);
  const c: SavedConnection = view.connection;
  const connect = () => void connectSaved(store, c, null);
  return (
    <li role="treeitem" aria-selected="false" className="tree-item">
      <Swatch colour={tint(c.environment, c.colour)} />
      <span className="tree-name" onDoubleClick={connect}>
        {c.name}
      </span>
      <button type="button" aria-label={`Connect to ${c.name}`} onClick={connect}>
        Connect
      </button>
      <button
        type="button"
        aria-label={`Edit ${c.name}`}
        onClick={() => {
          show(store, { kind: "connection", editing: c });
        }}
      >
        Edit
      </button>
      <button
        type="button"
        aria-label={`${c.pinned ? "Unpin" : "Pin"} ${c.name}`}
        onClick={() => void save(store, { ...c, pinned: !c.pinned }, { kind: "keep" })}
      >
        {c.pinned ? "Unpin" : "Pin"}
      </button>
      {deleting ? (
        <button type="button" aria-label={`Confirm deleting ${c.name}`} onClick={() => void forget(store, c.id)}>
          Delete {c.name}?
        </button>
      ) : (
        <button
          type="button"
          aria-label={`Delete ${c.name}`}
          onClick={() => {
            setDeleting(true);
          }}
        >
          Delete
        </button>
      )}
    </li>
  );
}

/** A folder, its folders and its connections. */
function FolderItems({ folder }: { readonly folder: Folder }) {
  return (
    <>
      {folder.folders.map((child) => (
        <li key={child.name} role="treeitem" aria-expanded="true" aria-selected="false">
          <span className="tree-folder">{child.name}</span>
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
  return (
    <li role="treeitem" aria-selected={active} className={active ? "tree-item tree-active" : "tree-item"}>
      <Swatch colour={tint(connection.guards.environment, connection.colour)} />
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
        aria-label={`Disconnect ${connection.name}`}
        onClick={() => void disconnect(store, connection.id)}
      >
        Disconnect
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
        onClick={() => {
          show(store, { kind: "connection", editing: null });
        }}
      >
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
