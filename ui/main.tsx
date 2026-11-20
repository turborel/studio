/** The front end's entry: Studio's window, in the page's root. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "dockview-react/dist/styles/dockview.css";
import "./styles.css";
import { App } from "./App";

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
