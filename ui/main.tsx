/**
 * The front end's entry: Studio's window, of a store of its own, in the
 * page's root, within the boundary that shows a failure in drawing it,
 * and failures of scripts and promises watched (RULES.md D49).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "dockview-react/dist/styles/dockview.css";
import "./styles.css";
import "./worksheet/worksheet.css";
import "./results/results.css";
import "./model/model.css";
import "./shell/menus.css";
import { App } from "./App";
import { FailureBoundary, watchFailures } from "./shell/Failure";
import { Store } from "./state/store";

// The prototype of every object is frozen here, once every module has run,
// not by Tauri before any has (D22): d3, which React Flow reads, sets
// `constructor` on objects of the prototype as its modules run, which a
// prototype frozen before refuses, so no module of the window ran at all.
Object.freeze(Object.prototype);

const store = new Store();
watchFailures((error) => {
  store.update((now) => ({ ...now, error }));
});
const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <FailureBoundary>
        <App store={store} />
      </FailureBoundary>
    </StrictMode>,
  );
}
