/** The dock's panels: the explorer, the centre, and the details. */
import { CatalogTree } from "../explorer/CatalogTree";
import { Details } from "../explorer/Details";
import { Library } from "../explorer/Library";
import { useStore, useStudio } from "../state/store";
import { OpenButtons } from "./OpenButtons";
import { openWorksheet } from "../state/worksheets";
import { Icon } from "../icons/Icon";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { ExplorerToolbar } from "../explorer/ExplorerToolbar";

/** The Object Explorer: its toolbar; the connections, open and saved, the favourite queries and projects; then the active connection's catalog. */
export function ExplorerPanel() {
  const active = useStudio((s) => s.active);
  return (
    <div className="panel explorer" role="region" aria-label="Object Explorer">
      <ExplorerToolbar />
      <ConnectionsPanel />
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
        <OpenButtons />
        <button
          type="button"
          className="welcome-card"
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
