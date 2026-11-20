/** The dock's panels: the explorer's connections, the centre, and details. */
import { ConnectionsPanel } from "./ConnectionsPanel";

/** The Object Explorer: the connections, open and saved. */
export function ExplorerPanel() {
  return (
    <div className="panel" role="region" aria-label="Object Explorer">
      <ConnectionsPanel />
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
  return <div className="panel-empty">Nothing is selected.</div>;
}
