/**
 * The dock (RULES.md D14, R-FMT-1): its panels laid out as they were left,
 * the layout saved as it changes, and laid out afresh on Reset Layout; a
 * tab of each worksheet and of each model open.
 */
import {
  DockviewDefaultTab,
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import { Icon, type IconName } from "../icons/Icon";
import { type Store, useStore, useStudio } from "../state/store";
import {
  activateWorksheet,
  closeWorksheet,
  openWorksheet,
  type WorksheetState,
  worksheetOf,
} from "../state/worksheets";
import { tint } from "./environment";
import { Worksheet } from "../worksheet/Worksheet";
import type { ThemeName } from "../theme/tokens";
import { loadLayout, saveLayout } from "../ipc/preferences";
import { defaultLayout, PANELS } from "./layout";
import { DetailsPanel, ExplorerPanel, WelcomePanel } from "./panels";
import { activateModel, closeModel, type ModelDoc } from "../model/models";
import { ModelView } from "../model/ModelView";
import { AssistantPanel } from "../assistant/AssistantPanel";
import { LivePanel } from "../live/LivePanel";
import { MonitorPanel } from "../admin/MonitorPanel";
import { useMenu } from "./ContextMenu";
import { tabMenu } from "../worksheet/menus";

/** The dock's theme of each of Studio's, its colours from Studio's own. */
const DOCK_THEMES: Readonly<Record<ThemeName, DockviewTheme>> = {
  light: { name: "studio-light", className: "dockview-theme-studio", colorScheme: "light" },
  dark: { name: "studio-dark", className: "dockview-theme-studio", colorScheme: "dark" },
};

/** A worksheet's panel, by the identifier its parameters give. */
function WorksheetPanel({ params }: IDockviewPanelProps<{ id: string }>) {
  return <Worksheet id={params.id} />;
}

/** A model's panel, by the identifier its parameters give. */
function ModelPanel({ params }: IDockviewPanelProps<{ id: string }>) {
  return <ModelView id={params.id} />;
}

const COMPONENTS = {
  [PANELS.explorer.id]: ExplorerPanel,
  [PANELS.welcome.id]: WelcomePanel,
  [PANELS.details.id]: DetailsPanel,
  [PANELS.worksheet.id]: WorksheetPanel,
  [PANELS.model.id]: ModelPanel,
  [PANELS.assistant.id]: AssistantPanel,
  [PANELS.live.id]: LivePanel,
  [PANELS.monitor.id]: MonitorPanel,
};

/** The icon of each panel's tab, by its component. */
export const TAB_ICONS: Readonly<Record<string, IconName>> = {
  [PANELS.explorer.id]: "explorer",
  [PANELS.welcome.id]: "start",
  [PANELS.details.id]: "details",
  [PANELS.worksheet.id]: "worksheet",
  [PANELS.model.id]: "graph",
  [PANELS.assistant.id]: "assistant",
  [PANELS.live.id]: "present",
  [PANELS.monitor.id]: "monitor",
};

/** A panel's tab: its icon, then dockview's own tab of its title. */
export function Tab(props: IDockviewPanelHeaderProps) {
  const icon = TAB_ICONS[props.api.component];
  const params = props.params as { id?: unknown };
  const colour = useStudio((s) => {
    const sheet = worksheetOf(s, typeof params.id === "string" ? params.id : null);
    const open = s.open.find((c) => c.id === sheet?.connection);
    return open === undefined ? null : tint(open.guards.environment, open.colour);
  });
  const store = useStore();
  const worksheet = typeof params.id === "string" && props.api.component === PANELS.worksheet.id ? params.id : null;
  const shared = useStudio(
    (s) => typeof params.id === "string" && s.live.status.hosted !== null && s.live.shared.includes(params.id),
  );
  const menu = useMenu(() =>
    worksheet === null
      ? []
      : tabMenu(
          store,
          worksheet,
          props.api.group.panels
            .filter((p) => p.id.startsWith(WORKSHEET_PANEL))
            .map((p) => p.id.slice(WORKSHEET_PANEL.length)),
        ),
  );
  return (
    <div
      className="dock-tab"
      style={colour === null ? undefined : { boxShadow: `inset 0 -3px 0 ${colour}` }}
      {...(worksheet === null ? {} : menu)}
    >
      {icon !== undefined && <Icon name={icon} />}
      <DockviewDefaultTab {...props} />
      {shared && (
        <span className="dock-shared" title="Shared in the Live Session" aria-label="shared">
          <Icon name="shared" />
        </span>
      )}
    </div>
  );
}

/** The "+" at the end of a group's tabs of worksheets, models or the start, which opens a new worksheet there. */
export function NewWorksheetAction({ panels }: IDockviewHeaderActionsProps) {
  const store = useStore();
  const centre = panels.some(
    (p) => p.id.startsWith(WORKSHEET_PANEL) || p.id.startsWith(MODEL_PANEL) || p.id === PANELS.welcome.id,
  );
  if (!centre) {
    return null;
  }
  return (
    <button
      type="button"
      className="tool dock-new"
      title="New Worksheet"
      aria-label="New Worksheet"
      onClick={() => {
        openWorksheet(store);
      }}
    >
      <Icon name="newWorksheet" />
    </button>
  );
}

/** The prefix of a worksheet's panel's identifier. */
export const WORKSHEET_PANEL = "worksheet:";

/** The title of worksheet `w`'s tab: its title, marked if changed since saved, or pinned. */
export function tabTitle(w: WorksheetState): string {
  return `${w.title}${w.modified ? " •" : ""}${w.pinned ? " (pinned)" : ""}`;
}

/** Keeps `api`'s worksheet panels as `store`'s worksheets are: each opened, titled, shown when active, and closed: what stops it. */
export function syncWorksheets(api: DockviewApi, store: Store): () => void {
  let closing = false;
  const sync = () => {
    const now = store.current();
    const ids = new Set(now.worksheets.map((w) => WORKSHEET_PANEL + w.id));
    closing = true;
    for (const panel of api.panels.filter((p) => p.id.startsWith(WORKSHEET_PANEL) && !ids.has(p.id))) {
      api.removePanel(panel);
    }
    closing = false;
    for (const w of now.worksheets) {
      const id = WORKSHEET_PANEL + w.id;
      const panel = api.getPanel(id);
      if (panel === undefined) {
        const beside = api.panels.find((p) => p.id.startsWith(WORKSHEET_PANEL)) ?? api.getPanel(PANELS.welcome.id);
        api.addPanel({
          id,
          component: PANELS.worksheet.id,
          title: tabTitle(w),
          params: { id: w.id },
          ...(beside === undefined ? {} : { position: { referencePanel: beside.id, direction: "within" as const } }),
        });
      } else if (panel.title !== tabTitle(w)) {
        panel.api.setTitle(tabTitle(w));
      }
    }
    const shown = now.activeWorksheet === null ? undefined : api.getPanel(WORKSHEET_PANEL + now.activeWorksheet);
    if (shown !== undefined && api.activePanel?.id !== shown.id) {
      shown.api.setActive();
    }
  };
  const removed = api.onDidRemovePanel((panel) => {
    if (!closing && panel.id.startsWith(WORKSHEET_PANEL)) {
      closeWorksheet(store, panel.id.slice(WORKSHEET_PANEL.length));
    }
  });
  const activated = api.onDidActivePanelChange(({ panel }) => {
    if (panel?.id.startsWith(WORKSHEET_PANEL) === true) {
      activateWorksheet(store, panel.id.slice(WORKSHEET_PANEL.length));
    }
  });
  sync();
  const stop = store.subscribe(sync);
  return () => {
    stop();
    removed.dispose();
    activated.dispose();
  };
}

/** The prefix of a model's panel's identifier. */
export const MODEL_PANEL = "model:";

/** The title of model `m`'s tab: its name, marked if changed since saved. */
export function modelTitle(m: ModelDoc): string {
  return `${m.model.name}${m.modified ? " •" : ""}`;
}

/** Adds model `m`'s panel to `api` beside the worksheets and models, or titles it anew. */
function placeModel(api: DockviewApi, m: ModelDoc): void {
  const id = MODEL_PANEL + m.id;
  const panel = api.getPanel(id);
  if (panel !== undefined) {
    if (panel.title !== modelTitle(m)) {
      panel.api.setTitle(modelTitle(m));
    }
    return;
  }
  const beside =
    api.panels.find((p) => p.id.startsWith(WORKSHEET_PANEL) || p.id.startsWith(MODEL_PANEL)) ??
    api.getPanel(PANELS.welcome.id);
  api.addPanel({
    id,
    component: PANELS.model.id,
    title: modelTitle(m),
    params: { id: m.id },
    ...(beside === undefined ? {} : { position: { referencePanel: beside.id, direction: "within" as const } }),
  });
}

/** Keeps `api`'s model panels as `store`'s models are: each opened, titled, shown when active, and closed: what stops it. */
export function syncModels(api: DockviewApi, store: Store): () => void {
  let closing = false;
  let shownBefore: string | null = null;
  const sync = () => {
    const now = store.current();
    const ids = new Set(now.models.map((m) => MODEL_PANEL + m.id));
    closing = true;
    for (const panel of api.panels.filter((p) => p.id.startsWith(MODEL_PANEL) && !ids.has(p.id))) {
      api.removePanel(panel);
    }
    closing = false;
    for (const m of now.models) {
      placeModel(api, m);
    }
    if (now.activeModel !== shownBefore) {
      shownBefore = now.activeModel;
      api.getPanel(MODEL_PANEL + (now.activeModel ?? ""))?.api.setActive();
    }
  };
  const removed = api.onDidRemovePanel((panel) => {
    if (!closing && panel.id.startsWith(MODEL_PANEL)) {
      closeModel(store, panel.id.slice(MODEL_PANEL.length));
    }
  });
  const activated = api.onDidActivePanelChange(({ panel }) => {
    if (panel?.id.startsWith(MODEL_PANEL) === true) {
      shownBefore = panel.id.slice(MODEL_PANEL.length);
      activateModel(store, shownBefore);
    }
  });
  sync();
  const stop = store.subscribe(sync);
  return () => {
    stop();
    removed.dispose();
    activated.dispose();
  };
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
  const store = useStore();
  const ready = (event: DockviewReadyEvent) => {
    onApi(event.api);
    void restore(event.api).then(() => {
      syncWorksheets(event.api, store);
      syncModels(event.api, store);
    });
  };
  return (
    <DockviewReact
      components={COMPONENTS}
      defaultTabComponent={Tab}
      leftHeaderActionsComponent={NewWorksheetAction}
      onReady={ready}
      theme={DOCK_THEMES[theme]}
    />
  );
}
