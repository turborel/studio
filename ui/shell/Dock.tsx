/**
 * The dock (RULES.md D14, R-FMT-1): its panels laid out as they were left,
 * the layout saved as it changes, and laid out afresh on Reset Layout.
 */
import {
  DockviewDefaultTab,
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewPanelHeaderProps,
} from "dockview-react";
import { Icon, type IconName } from "../icons/Icon";
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

/** The icon of each panel's tab, by its component. */
export const TAB_ICONS: Readonly<Record<string, IconName>> = {
  [PANELS.explorer.id]: "explorer",
  [PANELS.welcome.id]: "start",
  [PANELS.details.id]: "details",
};

/** A panel's tab: its icon, then dockview's own tab of its title. */
export function Tab(props: IDockviewPanelHeaderProps) {
  const icon = TAB_ICONS[props.api.component];
  return (
    <div className="dock-tab">
      {icon !== undefined && <Icon name={icon} />}
      <DockviewDefaultTab {...props} />
    </div>
  );
}

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
  return <DockviewReact components={COMPONENTS} defaultTabComponent={Tab} onReady={ready} theme={DOCK_THEMES[theme]} />;
}
