/**
 * Studio's window (RULES.md D1, D14): the dock of panels and the status
 * bar, in the theme the system prefers.
 */
import { DockviewReact, type DockviewReadyEvent, type DockviewTheme } from "dockview-react";
import { useEffect, useState } from "react";
import { defaultLayout, PANELS } from "./shell/layout";
import { DetailsPanel, ExplorerPanel, WelcomePanel } from "./shell/panels";
import { applyTheme, DARK_QUERY, resolveTheme } from "./theme/theme";
import type { ThemeName } from "./theme/tokens";

/** The dock's theme of each of Studio's, its colours from Studio's own. */
const DOCK_THEMES: Readonly<Record<ThemeName, DockviewTheme>> = {
  light: { name: "studio-light", className: "dockview-theme-studio", colorScheme: "light" },
  dark: { name: "studio-dark", className: "dockview-theme-studio", colorScheme: "dark" },
};

const COMPONENTS = {
  [PANELS.explorer.id]: ExplorerPanel,
  [PANELS.welcome.id]: WelcomePanel,
  [PANELS.details.id]: DetailsPanel,
};

/** The theme the system prefers, followed as it changes. */
function useSystemTheme(): ThemeName {
  const query = window.matchMedia(DARK_QUERY);
  const [dark, setDark] = useState(query.matches);
  useEffect(() => {
    const changed = (event: MediaQueryListEvent) => {
      setDark(event.matches);
    };
    query.addEventListener("change", changed);
    return () => {
      query.removeEventListener("change", changed);
    };
  }, [query]);
  return resolveTheme("system", dark);
}

/** The window. */
export function App() {
  const theme = useSystemTheme();
  useEffect(() => {
    applyTheme(document.documentElement, theme);
  }, [theme]);
  const ready = (event: DockviewReadyEvent) => {
    defaultLayout(event.api);
  };
  return (
    <div className="app">
      <main className="dock">
        <DockviewReact components={COMPONENTS} onReady={ready} theme={DOCK_THEMES[theme]} />
      </main>
      <footer className="status-bar" role="status" aria-label="Status bar">
        Not connected
      </footer>
    </div>
  );
}
