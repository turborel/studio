/** The dock's panels, before the milestones that fill them. */

/** The Object Explorer: empty until a connection is opened. */
export function ExplorerPanel() {
  return (
    <div className="panel-empty" role="tree" aria-label="Object Explorer">
      No connection is open.
    </div>
  );
}

/** The centre, before any worksheet. */
export function WelcomePanel() {
  return (
    <div className="panel-empty">
      <h1>Turborel Studio</h1>
      <p>Open a connection to begin.</p>
    </div>
  );
}

/** Details of what is selected. */
export function DetailsPanel() {
  return <div className="panel-empty">Nothing is selected.</div>;
}
