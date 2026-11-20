/**
 * Studio's commands (RULES.md D30): each a name, a title, a category, a
 * default key and what it does. The menus, the keys and the command
 * palette all run them by name, so each is in one place.
 */
import { ZOOM } from "../ipc/preferences";
import { cancel, changeSettings, disconnect, endTransaction, reconnectOpen, show } from "../state/actions";
import type { IconName } from "../icons/Icon";
import type { Store } from "../state/store";
import type { ThemeChoice } from "../theme/theme";

/** What a command is run with: the window's store, and its dock's layout reset. */
export interface CommandContext {
  readonly store: Store;
  readonly resetLayout: () => void;
}

/** A command. */
export interface Command {
  /** Its name, as the menus, keys and settings name it. */
  readonly id: string;
  /** What the palette and the shortcuts list call it. */
  readonly title: string;
  /** Its menu, which the palette names it by. */
  readonly category: string;
  /** Its key by default, written as `Mod+Shift+P`, if it has one. */
  readonly key?: string;
  /** Its icon, in the toolbar, the palette and the list of keys. */
  readonly icon?: IconName;
  /** Whether it can run now. */
  readonly enabled: (context: CommandContext) => boolean;
  /** Runs it. */
  readonly run: (context: CommandContext) => void | Promise<void>;
}

/** Always. */
const always = (): boolean => true;
/** Whether a connection is active. */
const connected = (context: CommandContext): boolean => context.store.current().active !== null;

/** Runs `act` on the active connection, if there is one. */
function onActive(act: (store: Store, id: number) => Promise<void>): (context: CommandContext) => Promise<void> {
  return async ({ store }) => {
    const id = store.current().active;
    if (id !== null) {
      await act(store, id);
    }
  };
}

/** The command that chooses theme `choice`. */
function theme(choice: ThemeChoice, title: string): Command {
  const icons: Readonly<Record<ThemeChoice, IconName>> = {
    system: "themeSystem",
    light: "themeLight",
    dark: "themeDark",
  };
  return {
    id: `theme.${choice}`,
    title,
    icon: icons[choice],
    category: "View",
    enabled: always,
    run: ({ store }) => changeSettings(store, (s) => ({ ...s, theme: choice })),
  };
}

/** The command that changes the zoom by `step` percent, or to 100 % for 0. */
function zoom(id: string, title: string, step: number, key: string): Command {
  const icon: IconName = step > 0 ? "zoomIn" : step < 0 ? "zoomOut" : "zoomReset";
  const zoomed = (now: number): number => (step === 0 ? 100 : Math.min(ZOOM.most, Math.max(ZOOM.least, now + step)));
  return {
    id,
    title,
    category: "View",
    key,
    icon,
    enabled: always,
    run: ({ store }) => changeSettings(store, (s) => ({ ...s, zoomPercent: zoomed(s.zoomPercent) })),
  };
}

/** Every command, in the order the palette lists them. */
export const COMMANDS: readonly Command[] = [
  {
    id: "connection.new",
    icon: "newConnection",
    title: "New Connection…",
    category: "File",
    key: "Mod+Shift+N",
    enabled: always,
    run: ({ store }) => {
      show(store, { kind: "connection", editing: null });
    },
  },
  {
    id: "connection.disconnect",
    icon: "disconnect",
    title: "Disconnect",
    category: "Connection",
    enabled: connected,
    run: onActive(disconnect),
  },
  {
    id: "connection.reconnect",
    icon: "reconnect",
    title: "Reconnect",
    category: "Connection",
    enabled: connected,
    run: onActive(reconnectOpen),
  },
  {
    id: "statement.cancel",
    icon: "cancel",
    title: "Cancel Statement",
    category: "Connection",
    key: "Mod+.",
    enabled: connected,
    run: onActive(cancel),
  },
  {
    id: "transaction.commit",
    icon: "commit",
    title: "Commit",
    category: "Connection",
    enabled: connected,
    run: onActive((store, id) => endTransaction(store, id, "COMMIT")),
  },
  {
    id: "transaction.rollback",
    icon: "rollback",
    title: "Rollback",
    category: "Connection",
    enabled: connected,
    run: onActive((store, id) => endTransaction(store, id, "ROLLBACK")),
  },
  {
    id: "palette.open",
    icon: "palette",
    title: "Command Palette…",
    category: "View",
    key: "Mod+Shift+P",
    enabled: always,
    run: ({ store }) => {
      show(store, { kind: "palette" });
    },
  },
  {
    id: "settings.open",
    icon: "settings",
    title: "Settings…",
    category: "File",
    key: "Mod+,",
    enabled: always,
    run: ({ store }) => {
      show(store, { kind: "settings" });
    },
  },
  theme("system", "Theme: System"),
  theme("light", "Theme: Light"),
  theme("dark", "Theme: Dark"),
  zoom("zoom.in", "Zoom In", ZOOM.step, "Mod+="),
  zoom("zoom.out", "Zoom Out", -ZOOM.step, "Mod+-"),
  zoom("zoom.reset", "Actual Size", 0, "Mod+0"),
  {
    id: "layout.reset",
    icon: "layout",
    title: "Reset Layout",
    category: "View",
    enabled: always,
    run: ({ resetLayout }) => {
      resetLayout();
    },
  },
  {
    id: "help.about",
    icon: "about",
    title: "About Turborel Studio",
    category: "Help",
    enabled: always,
    run: ({ store }) => {
      show(store, { kind: "about" });
    },
  },
  {
    id: "help.shortcuts",
    icon: "keys",
    title: "Keyboard Shortcuts",
    category: "Help",
    key: "F1",
    enabled: always,
    run: ({ store }) => {
      show(store, { kind: "shortcuts" });
    },
  },
];

/** Each command's default key, by its name. */
export function defaultKeys(): Record<string, string> {
  return Object.fromEntries(COMMANDS.filter((c) => c.key !== undefined).map((c) => [c.id, c.key ?? ""]));
}

/** The command named `id`, if there is one. */
export function command(id: string): Command | undefined {
  return COMMANDS.find((c) => c.id === id);
}

/** Runs the command named `id`, if there is one and it can run now. */
export async function runCommand(id: string, context: CommandContext): Promise<void> {
  const found = command(id);
  if (found?.enabled(context) === true) {
    await found.run(context);
  }
}
