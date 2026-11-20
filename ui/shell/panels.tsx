/** The dock's panels: the explorer, the centre, and the details. */
import { CatalogTree } from "../explorer/CatalogTree";
import { Details } from "../explorer/Details";
import { useStudio } from "../state/store";
import { ConnectionsPanel } from "./ConnectionsPanel";

/** The Object Explorer: the connections, open and saved, then the active connection's catalog. */
export function ExplorerPanel() {
  const active = useStudio((s) => s.active);
  return (
    <div className="panel" role="region" aria-label="Object Explorer">
      <details className="explorer-connections" open>
        <summary>Connections</summary>
        <ConnectionsPanel />
      </details>
      {active !== null && <CatalogTree key={active} connection={active} />}
    </div>
  );
}

/** The centre, before any worksheet. */
export function WelcomePanel() {
  return (
    <div className="panel-empty">
      <h1>Turborel Studio</h1>
      <p>Open a connection to begin: New Connection, in the explorer or the File menu.</p>
    </div>
  );
}

/** Details of what is selected. */
export function DetailsPanel() {
  return <Details />;
}
