/**
 * The dock (RULES.md D14, R-FMT-1): its panels laid out as they were left,
 * the layout saved as it changes, and laid out afresh on Reset Layout.
 */
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type DockviewTheme } from "dockview-react";
import type { ThemeName } from "../theme/tokens";
import { loadLayout, saveLayout } from "../ipc/preferences";
import { defaultLayout, PANELS } from "./layout";
import { DetailsPanel, ExplorerPanel, WelcomePanel } from "./panels";

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

/** How long the layout waits, unchanged, before it is saved, in milliseconds. */
export const SAVE_AFTER_MS = 500;

/** Lays `api` out as it was left, or afresh, and saves it as it changes. */
export async function restore(api: DockviewApi): Promise<void> {
  const saved = await loadLayout().catch(() => null);
  try {
    if (saved === null || saved === undefined) {
      defaultLayout(api);
    } else {
      api.fromJSON(saved as Parameters<DockviewApi["fromJSON"]>[0]);
    }
  } catch {
    // A layout of panels this build has not is laid out afresh.
    api.clear();
    defaultLayout(api);
  }
  let pending: ReturnType<typeof setTimeout> | undefined;
  api.onDidLayoutChange(() => {
    clearTimeout(pending);
    pending = setTimeout(() => void saveLayout(api.toJSON()).catch(() => undefined), SAVE_AFTER_MS);
  });
}

/** Lays `api` out afresh, and saves that. */
export function resetLayout(api: DockviewApi): void {
  api.clear();
  defaultLayout(api);
  void saveLayout(api.toJSON()).catch(() => undefined);
}

/** The dock, in `theme`, telling `onApi` its API once it is ready. */
export function Dock({ theme, onApi }: { readonly theme: ThemeName; readonly onApi: (api: DockviewApi) => void }) {
  const ready = (event: DockviewReadyEvent) => {
    onApi(event.api);
    void restore(event.api);
  };
  return <DockviewReact components={COMPONENTS} onReady={ready} theme={DOCK_THEMES[theme]} />;
}
