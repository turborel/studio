/**
 * Studio's window (RULES.md D1, D14, D30, D32): the toolbar, the dock of
 * panels and the status bar, in the theme and zoom the settings say,
 * tinted by the active connection's colour; the keys, the menus and the
 * backend's events each running what they name.
 */
import { listen } from "@tauri-apps/api/event";
import type { DockviewApi } from "dockview-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type CommandContext, defaultKeys, runCommand } from "./commands/commands";
import { bindings, keyOf } from "./commands/keys";
import { onStudioEvent } from "./ipc/events";
import { ConnectionDialog } from "./shell/ConnectionDialog";
import { CommandPalette } from "./shell/CommandPalette";
import { Dock, resetLayout } from "./shell/Dock";
import { tint } from "./shell/environment";
import { ErrorBanner } from "./shell/ErrorBanner";
import { AboutDialog, ShortcutsDialog } from "./shell/HelpDialogs";
import { SettingsDialog } from "./shell/SettingsDialog";
import { StatusBar } from "./shell/StatusBar";
import { Toolbar } from "./shell/Toolbar";
import { checkAfterWake, loadAll, told } from "./state/actions";
import { openConnection, type Store, StoreContext, useStudio } from "./state/store";
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
  const keyBindings = useStudio((s) => s.settings.keyBindings);
  useEffect(() => {
    void loadAll(store);
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
    };
  }, [store, context]);
  useEffect(() => {
    const keys = bindings(defaultKeys(), keyBindings);
    const pressed = (event: KeyboardEvent) => {
      const key = keyOf(event);
      const id = key === null ? undefined : keys.get(key);
      if (id !== undefined) {
        event.preventDefault();
        void runCommand(id, context);
      }
    };
    window.addEventListener("keydown", pressed);
    return () => {
      window.removeEventListener("keydown", pressed);
    };
  }, [keyBindings, context]);
}

/** The dialog shown, if any. */
function Dialogs({ context }: { readonly context: CommandContext }) {
  const dialog = useStudio((s) => s.dialog);
  switch (dialog?.kind) {
    case "connection":
      return <ConnectionDialog editing={dialog.editing} />;
    case "palette":
      return <CommandPalette context={context} />;
    case "settings":
      return <SettingsDialog />;
    case "about":
      return <AboutDialog />;
    case "shortcuts":
      return <ShortcutsDialog />;
    case undefined:
      return null;
  }
}

/** The window's parts, within its store. */
function Window({ store }: { readonly store: Store }) {
  const dock = useRef<DockviewApi | null>(null);
  const context = useMemo<CommandContext>(
    () => ({
      store,
      resetLayout: () => {
        if (dock.current !== null) {
          resetLayout(dock.current);
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
  const style = { zoom: settings.zoomPercent / PERCENT, ...(colour === null ? {} : { "--env-colour": colour }) };
  return (
    <div className={colour === null ? "app" : "app app-tinted"} style={style}>
      <Toolbar context={context} />
      <ErrorBanner />
      <main className="dock">
        <Dock theme={theme} onApi={(api) => (dock.current = api)} />
      </main>
      <StatusBar />
      <Dialogs context={context} />
    </div>
  );
}

/** The window, of `store`. */
export function App({ store }: { readonly store: Store }) {
  return (
    <StoreContext.Provider value={store}>
      <Window store={store} />
    </StoreContext.Provider>
  );
}
