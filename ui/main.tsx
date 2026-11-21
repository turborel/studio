/** The front end's entry: Studio's window, of a store of its own, in the page's root. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "dockview-react/dist/styles/dockview.css";
import "./styles.css";
import "./worksheet/worksheet.css";
import "./results/results.css";
import { App } from "./App";
import { Store } from "./state/store";

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App store={new Store()} />
    </StrictMode>,
  );
}
