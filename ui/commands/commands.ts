/**
 * Studio's commands (RULES.md D30): each a name, a title, a category, a
 * default key and what it does. The menus, the keys and the command
 * palette all run them by name, so each is in one place.
 */
import { ZOOM } from "../ipc/preferences";
import { attempt, cancel, changeSettings, disconnect, endTransaction, reconnectOpen, show } from "../state/actions";
import type { IconName } from "../icons/Icon";
import type { Store } from "../state/store";
import { loadSchemas } from "../state/catalog";
import { newModel, openModelFrom } from "../model/models";
import { openWorksheet } from "../state/worksheets";
import {
  EDITOR_ACTS,
  explainCurrent,
  favouriteCurrent,
  formatCurrent,
  goToDefinition,
  hasWorksheet,
  openFile,
  runCurrent,
  runScript,
  runToFile,
  saveCurrent,
  stopCurrent,
  TAB_ACTS,
  toggleAutocommit,
} from "../worksheet/commands";
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

/** Whether a worksheet is active. */
const worksheet = (context: CommandContext): boolean => hasWorksheet(context.store);

/** The icon of each of the worksheet's commands. */
const WORKSHEET_ICONS: Readonly<Record<string, IconName>> = {
  "worksheet.run": "run",
  "worksheet.runScript": "runScript",
  "worksheet.runOnFolder": "folder",
  "worksheet.explain": "explain",
  "worksheet.explainAnalyze": "explainAnalyze",
  "worksheet.runToCsv": "export",
  "worksheet.runToNative": "save",
  "worksheet.format": "format",
  "worksheet.comment": "comment",
  "worksheet.upperCase": "letterCase",
  "worksheet.lowerCase": "letterCase",
  "worksheet.find": "find",
  "worksheet.bookmark": "bookmark",
  "worksheet.nextBookmark": "bookmark",
  "worksheet.previousBookmark": "bookmark",
  "worksheet.definition": "definition",
  "worksheet.describe": "details",
  "worksheet.split": "split",
  "worksheet.outline": "outline",
  "worksheet.favourite": "favourite",
  "worksheet.autocommit": "autocommit",
  "worksheet.save": "save",
  "worksheet.saveAs": "saveAs",
  "worksheet.pin": "pin",
  "worksheet.close": "close",
  "worksheet.closeOthers": "closeOthers",
};

/** A command of the Worksheet menu, run on the active worksheet. */
function onWorksheet(
  id: string,
  title: string,
  key: string | undefined,
  run: (store: Store) => unknown,
  category = "Worksheet",
): Command {
  return {
    id,
    title,
    category,
    icon: WORKSHEET_ICONS[id] ?? "worksheet",
    ...(key === undefined ? {} : { key }),
    enabled: worksheet,
    run: async ({ store }) => {
      await run(store);
    },
  };
}

/** The worksheet's commands, in the order the palette lists them. */
const WORKSHEET_COMMANDS: readonly Command[] = [
  onWorksheet("worksheet.run", "Run Statement", "Mod+Enter", runCurrent),
  onWorksheet("worksheet.runScript", "Run Script", "Mod+Shift+Enter", runScript),
  onWorksheet("worksheet.runOnFolder", "Run Script on a Folder's Connections…", undefined, (store) => {
    show(store, { kind: "folders" });
  }),
  onWorksheet("worksheet.explain", "Explain", "Mod+E", (store) => explainCurrent(store, false)),
  onWorksheet("worksheet.explainAnalyze", "Explain Analyze", "Mod+Shift+E", (store) => explainCurrent(store, true)),
  onWorksheet("worksheet.runToCsv", "Run to CSV File…", undefined, (store) => runToFile(store, "csv")),
  onWorksheet("worksheet.runToNative", "Run to Native Rows File…", undefined, (store) => runToFile(store, "native")),
  {
    id: "worksheet.queryBuilder",
    icon: "graph",
    title: "Query Builder…",
    category: "Worksheet",
    enabled: connected,
    run: ({ store }) => {
      const now = store.current();
      const open = now.open.find((c) => c.id === now.active);
      if (open !== undefined) {
        const worksheet = openWorksheet(store, "", "Query");
        show(store, {
          kind: "builder",
          worksheet,
          connection: open.id,
          schema: open.session.schema ?? open.session.authorization,
        });
      }
    },
  },
  onWorksheet("worksheet.format", "Format", "Mod+Shift+F", formatCurrent),
  onWorksheet("worksheet.comment", "Toggle Comment", "Mod+/", EDITOR_ACTS.comment),
  onWorksheet("worksheet.upperCase", "Upper Case", "Mod+Shift+U", EDITOR_ACTS.upper),
  onWorksheet("worksheet.lowerCase", "Lower Case", "Mod+Shift+L", EDITOR_ACTS.lower),
  onWorksheet("worksheet.find", "Find and Replace…", "Mod+F", EDITOR_ACTS.find),
  onWorksheet("worksheet.bookmark", "Toggle Bookmark", "Mod+F2", EDITOR_ACTS.bookmark),
  onWorksheet("worksheet.nextBookmark", "Next Bookmark", "F2", EDITOR_ACTS.nextBookmark),
  onWorksheet("worksheet.previousBookmark", "Previous Bookmark", "Shift+F2", EDITOR_ACTS.previousBookmark),
  onWorksheet("worksheet.definition", "Go to Definition", "F12", goToDefinition),
  onWorksheet("worksheet.describe", "Describe", "Mod+I", EDITOR_ACTS.describe),
  onWorksheet("worksheet.split", "Split Editor", undefined, TAB_ACTS.split),
  onWorksheet("worksheet.outline", "Outline", undefined, TAB_ACTS.outline),
  onWorksheet("worksheet.favourite", "Add to Favourite Queries…", undefined, favouriteCurrent),
  onWorksheet("worksheet.autocommit", "Autocommit", undefined, toggleAutocommit),
  onWorksheet("worksheet.save", "Save", "Mod+S", (store) => saveCurrent(store, false), "File"),
  onWorksheet("worksheet.saveAs", "Save As…", "Mod+Shift+S", (store) => saveCurrent(store, true), "File"),
  onWorksheet("worksheet.pin", "Pin Tab", undefined, TAB_ACTS.pin),
  onWorksheet("worksheet.close", "Close Worksheet", "Mod+Alt+W", TAB_ACTS.close),
  onWorksheet("worksheet.closeOthers", "Close Other Worksheets", undefined, TAB_ACTS.closeOthers),
];

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
    id: "worksheet.new",
    icon: "newWorksheet",
    title: "New Worksheet",
    category: "File",
    key: "Mod+T",
    enabled: always,
    run: ({ store }) => {
      openWorksheet(store);
    },
  },
  {
    id: "file.open",
    icon: "open",
    title: "Open File…",
    category: "File",
    key: "Mod+O",
    enabled: always,
    run: ({ store }) => openFile(store),
  },
  {
    id: "model.new",
    icon: "graph",
    title: "New Model",
    category: "File",
    enabled: always,
    run: ({ store }) => {
      newModel(store);
    },
  },
  {
    id: "model.open",
    icon: "open",
    title: "Open Model…",
    category: "File",
    enabled: always,
    run: ({ store }) => attempt(store, () => openModelFrom(store)).then(() => undefined),
  },
  {
    id: "worksheet.reopen",
    icon: "reopen",
    title: "Reopen Closed Worksheet",
    category: "File",
    key: "Mod+Shift+T",
    enabled: ({ store }) => store.current().closedWorksheets.length > 0,
    run: ({ store }) => {
      TAB_ACTS.reopen(store);
    },
  },
  {
    id: "history.open",
    icon: "history",
    title: "History…",
    category: "File",
    key: "Mod+Shift+H",
    enabled: always,
    run: ({ store }) => {
      show(store, { kind: "history" });
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
    enabled: (context) => connected(context) || hasWorksheet(context.store),
    run: async (context) => {
      const { store } = context;
      const sheet = store.current().worksheets.find((w) => w.id === store.current().activeWorksheet);
      if (sheet?.running === true) {
        await stopCurrent(store);
      } else {
        await onActive(cancel)(context);
      }
    },
  },
  {
    id: "catalog.refresh",
    icon: "reconnect",
    title: "Refresh Catalog",
    category: "Connection",
    enabled: connected,
    run: onActive(loadSchemas),
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
  ...WORKSHEET_COMMANDS,
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
