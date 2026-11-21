/** The dock's panels: the explorer, the centre, and the details. */
import { CatalogTree } from "../explorer/CatalogTree";
import { Details } from "../explorer/Details";
import { Library } from "../explorer/Library";
import { useStore, useStudio } from "../state/store";
import { show } from "../state/actions";
import { openWorksheet } from "../state/worksheets";
import { Icon } from "../icons/Icon";
import { ConnectionsPanel } from "./ConnectionsPanel";

/** The Object Explorer: the connections, open and saved, the favourite queries and projects, then the active connection's catalog. */
export function ExplorerPanel() {
  const active = useStudio((s) => s.active);
  return (
    <div className="panel" role="region" aria-label="Object Explorer">
      <details className="explorer-connections" open>
        <summary>Connections</summary>
        <ConnectionsPanel />
      </details>
      <Library />
      {active !== null && <CatalogTree key={active} connection={active} />}
    </div>
  );
}

/** The centre, before any worksheet: a new connection or worksheet a click away. */
export function WelcomePanel() {
  const store = useStore();
  return (
    <div className="panel-empty">
      <h1>Turborel Studio</h1>
      <div className="welcome-actions">
        <button
          type="button"
          onClick={() => {
            show(store, { kind: "connection", editing: null });
          }}
        >
          <Icon name="newConnection" />
          New Connection…
        </button>
        <button
          type="button"
          onClick={() => {
            openWorksheet(store);
          }}
        >
          <Icon name="newWorksheet" />
          New Worksheet
        </button>
      </div>
      <p>Open a connection, then a worksheet to write SQL in and run it on the connection.</p>
    </div>
  );
}

/** Details of what is selected. */
export function DetailsPanel() {
  return <Details />;
}
