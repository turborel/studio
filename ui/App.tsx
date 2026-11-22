/**
 * Studio's window (RULES.md D1, D14, D30, D32): the toolbar, the dock of
 * panels and the status bar, in the theme and zoom the settings say,
 * tinted by the active connection's colour; the keys, the menus and the
 * backend's events each running what they name.
 */
import { showSearch } from "./state/catalog";
import { listen } from "@tauri-apps/api/event";
import type { DockviewApi } from "dockview-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type CommandContext, command, defaultKeys, runCommand } from "./commands/commands";
import { bindings, keyOf } from "./commands/keys";
import { onStudioEvent } from "./ipc/events";
import { AnalyzeChangeDialog } from "./worksheet/AnalyzeChangeDialog";
import { EmbeddedDialog } from "./shell/EmbeddedDialog";
import { OpenTransactionsDialog } from "./shell/OpenTransactionsDialog";
import { ConnectionDialog } from "./shell/ConnectionDialog";
import { CommandPalette } from "./shell/CommandPalette";
import { Dock, resetLayout } from "./shell/Dock";
import { tint } from "./shell/environment";
import { ErrorBanner, NoticeBanner } from "./shell/ErrorBanner";
import { AboutDialog, ShortcutsDialog } from "./shell/HelpDialogs";
import { SettingsDialog } from "./shell/SettingsDialog";
import { StatusBar } from "./shell/StatusBar";
import { Toolbar } from "./shell/Toolbar";
import { checkAfterWake, loadAll, told } from "./state/actions";
import { keepAsChanged, restoreWorksheets } from "./state/worksheets";
import { BuilderDialog } from "./builder/BuilderDialog";
import { DataDialog } from "./data/DataDialog";
import { FavouriteDialog, FoldersDialog, GuardDialog, HistoryDialog, ValuesDialog } from "./worksheet/dialogs";
import { type Dialog, openConnection, type Store, StoreContext, useStudio } from "./state/store";
import { AnalyzerDialog } from "./analyzer/AnalyzerDialog";
import { WhatIfDialog } from "./analyzer/PlanFindings";
import { SaveReportDialog } from "./analyzer/Reports";
import { PromptDialog } from "./shell/PromptDialog";
import { AssistantSettingsDialog } from "./assistant/AssistantSettings";
import { JoinDialog, LiveSettingsDialog } from "./live/LiveDialogs";
import { RecordsDialog } from "./live/RecordsDialog";
import { takeLink } from "./live/live";
import { SecurityDialog } from "./admin/SecurityDialog";
import { useLiveSync } from "./live/sync";
import { showPanel } from "./shell/layout";
import { CommandContextOf, ContextMenu } from "./shell/ContextMenu";
import { applyTheme, DARK_QUERY, resolveTheme } from "./theme/theme";
import type { ThemeName } from "./theme/tokens";

/** The event a menu item of Studio's is told as. */
export const MENU_EVENT = "studio:menu";
/** The percent of a whole. */
const PERCENT = 100;

/** Whether the system prefers dark, followed as it changes. */
function useSystemDark(): boolean {
  const query = useMemo(() => window.matchMedia(DARK_QUERY), []);
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
  return dark;
}

/** Loads the state, and runs what the backend, the menus, the keys and waking tell. */
function useWiring(context: CommandContext): void {
  const { store } = context;
  useEffect(() => {
    void loadAll(store);
    void takeLink(store);
    void restoreWorksheets(store);
    const keeping = keepAsChanged(store);
    const events = onStudioEvent((event) => {
      told(store, event);
    });
    const menus = listen<string>(MENU_EVENT, (event) => void runCommand(event.payload, context));
    const woke = () => {
      if (document.visibilityState === "visible") {
        void checkAfterWake(store);
      }
    };
    document.addEventListener("visibilitychange", woke);
    window.addEventListener("online", woke);
    return () => {
      void events.then((stop) => {
        stop();
      });
      void menus.then((stop) => {
        stop();
      });
      document.removeEventListener("visibilitychange", woke);
      window.removeEventListener("online", woke);
      keeping();
    };
  }, [store, context]);
  useKeys(context);
}

/** Runs the command each key pressed is bound to, as the settings bind them. */
function useKeys(context: CommandContext): void {
  const { store } = context;
  const keyBindings = useStudio((s) => s.settings.keyBindings);
  const keyScheme = useStudio((s) => s.settings.keyScheme);
  useEffect(() => {
    const keys = bindings(defaultKeys(keyScheme), keyBindings);
    const pressed = (event: KeyboardEvent) => {
      const key = keyOf(event);
      const id = key === null ? undefined : keys.get(key);
      if (explorerFind(store, event, id)) {
        return;
      }
      // A dialog takes the keys while it is open: Escape closes it.
      if (id !== undefined && store.current().dialog === null && command(id)?.enabled(context) === true) {
        event.preventDefault();
        event.stopPropagation();
        void runCommand(id, context);
      }
    };
    // Taken before the editor sees the key, so Studio's keys are Studio's everywhere.
    window.addEventListener("keydown", pressed, { capture: true });
    return () => {
      window.removeEventListener("keydown", pressed, { capture: true });
    };
  }, [keyBindings, keyScheme, context, store]);
}

/** The dialog shown, if any. */
function Dialogs({ context }: { readonly context: CommandContext }) {
  const dialog = useStudio((s) => s.dialog);
  switch (dialog?.kind) {
    case "connection":
      return (
        <ConnectionDialog editing={dialog.editing} {...(dialog.spec === undefined ? {} : { spec: dialog.spec })} />
      );
    case "palette":
      return <CommandPalette context={context} />;
    case "settings":
      return <SettingsDialog />;
    case "about":
      return <AboutDialog />;
    case "shortcuts":
      return <ShortcutsDialog />;
    case "guard":
      return <GuardDialog confirm={dialog.confirm} answer={dialog.answer} />;
    case "values":
      return <ValuesDialog {...dialog} />;
    case "history":
      return <HistoryDialog />;
    case "folders":
      return <FoldersDialog />;
    case "favourite":
      return <FavouriteDialog sql={dialog.sql} />;
    case "liveRecords":
      return <RecordsDialog />;
    default:
      return <TaskDialogs dialog={dialog ?? null} />;
  }
}

/** The dialog of a task shown, if any: of data, the builder, the analyzer and reports. */
function TaskDialogs({ dialog }: { readonly dialog: Dialog | null }) {
  switch (dialog?.kind) {
    case "data":
      return <DataDialog task={dialog.task} />;
    case "builder":
      return <BuilderDialog worksheet={dialog.worksheet} connection={dialog.connection} schema={dialog.schema} />;
    case "analyzer":
      return <AnalyzerDialog {...dialog} />;
    case "whatIf":
      return <WhatIfDialog whatIf={dialog.whatIf} />;
    case "report":
      return <SaveReportDialog sql={dialog.sql} chart={dialog.chart} />;
    case "prompt":
      return <PromptDialog {...dialog} />;
    case "assistantSettings":
      return <AssistantSettingsDialog />;
    case "liveSettings":
      return <LiveSettingsDialog />;
    case "liveJoin":
      return <JoinDialog opened={dialog.opened} />;
    case "security":
      return <SecurityDialog connection={dialog.connection} form={dialog.form} />;
    case "embedded":
      return <EmbeddedDialog mode={dialog.mode} editing={dialog.editing} />;
    case "openTransactions":
      return <OpenTransactionsDialog connections={dialog.connections} quitting={dialog.quitting} />;
    case "analyzeChange":
      return <AnalyzeChangeDialog sql={dialog.sql} answer={dialog.answer} />;
    default:
      return null;
  }
}

/** The webview's own menu, of reloading and inspecting, left out but in a field of text, where it cuts and pastes. */
function nativeMenuOnlyInText(event: React.MouseEvent): void {
  const target = event.target as HTMLElement;
  if (!target.closest("input, textarea")) {
    event.preventDefault();
  }
}

/** The window's parts, within its store. */
function Window({ store }: { readonly store: Store }) {
  const dock = useRef<DockviewApi | null>(null);
  useLiveSync(store);
  const context = useMemo<CommandContext>(
    () => ({
      store,
      resetLayout: () => {
        if (dock.current !== null) {
          resetLayout(dock.current);
        }
      },
      showPanel: (id) => {
        if (dock.current !== null) {
          showPanel(dock.current, id);
        }
      },
    }),
    [store],
  );
  useWiring(context);
  const settings = useStudio((s) => s.settings);
  const theme: ThemeName = resolveTheme(settings.theme, useSystemDark());
  useEffect(() => {
    applyTheme(document.documentElement, theme);
  }, [theme]);
  const active = useStudio((s) => openConnection(s, s.active));
  const colour = active === undefined ? null : tint(active.guards.environment, active.colour);
  const style = {
    zoom: settings.zoomPercent / PERCENT,
    "--editor-size": `${String(settings.editorFontPoints)}pt`,
    ...(settings.editorFontFamily === "" ? {} : { "--editor-font": settings.editorFontFamily }),
    ...(colour === null ? {} : { "--env-colour": colour }),
  };
  return (
    <CommandContextOf.Provider value={context}>
      <div className={colour === null ? "app" : "app app-tinted"} style={style} onContextMenu={nativeMenuOnlyInText}>
        <Toolbar context={context} />
        <ErrorBanner />
        <NoticeBanner />
        <main className="dock">
          <Dock theme={theme} onApi={(api) => (dock.current = api)} />
        </main>
        <StatusBar />
        <Dialogs context={context} />
        <ContextMenu />
      </div>
    </CommandContextOf.Provider>
  );
}

/** The window, of `store`. */
/** Find, of `id`, pressed within the explorer, is the explorer's own search of the catalog: shown, and the key taken. */
function explorerFind(store: Store, event: KeyboardEvent, id: string | undefined): boolean {
  const target = event.target;
  const inExplorer =
    target instanceof Element && target.closest("[role='region'][aria-label='Object Explorer']") !== null;
  if (id !== "worksheet.find" || !inExplorer || store.current().active === null) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  showSearch(store, true);
  return true;
}

export function App({ store }: { readonly store: Store }) {
  return (
    <StoreContext.Provider value={store}>
      <Window store={store} />
    </StoreContext.Provider>
  );
}
