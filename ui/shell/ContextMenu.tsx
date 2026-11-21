/**
 * Context menus (RULES.md D53): one menu at a time, opened by the
 * secondary button or, from the keyboard, by Shift+F10 or the context
 * menu key on what has the focus; its items of the command registry where
 * a command does what they do, each with its icon and its key, the
 * destructive marked so. The arrows move through it, Right opens a
 * submenu and Left closes it, Enter or Space chooses, Escape closes it
 * and gives the focus back to what opened it.
 */
import { createContext, type KeyboardEvent, type MouseEvent, useContext, useEffect, useRef, useState } from "react";
import { type CommandContext, command, runCommand } from "../commands/commands";
import { shown } from "../commands/keys";
import { Icon, type IconName } from "../icons/Icon";
import { type Store, useStore, useStudio } from "../state/store";

/** An item of a menu: what it says, its icon and key, whether it destroys, and what it does or the submenu it opens. */
export interface MenuEntry {
  readonly label: string;
  readonly icon?: IconName;
  /** Its key, as the commands write it, `Mod+Enter`. */
  readonly key?: string;
  /** Whether it destroys: drawn in the colour of danger, and run through the guards as anything typed. */
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly run?: () => unknown;
  readonly items?: readonly MenuItem[];
}

/** An item, or a line between groups. */
export type MenuItem = MenuEntry | "separator";

/** A menu open: where, and its items. */
export interface OpenMenu {
  readonly at: { readonly x: number; readonly y: number };
  readonly items: readonly MenuItem[];
}

/** The context the commands run in, given by the window to the menus within it. */
export const CommandContextOf = createContext<CommandContext | null>(null);

/** The item of command `id`, as the registry has it, run with `context`; a disabled one where it cannot run. */
export function commandEntry(id: string, context: CommandContext | null, label?: string): MenuEntry {
  const found = command(id);
  return {
    label: label ?? found?.title ?? id,
    ...(found?.icon === undefined ? {} : { icon: found.icon }),
    ...(found?.key === undefined ? {} : { key: found.key }),
    disabled: context === null || found?.enabled(context) !== true,
    run: () => (context === null ? undefined : runCommand(id, context)),
  };
}

/** The item of command `id` in the window's context. */
export function useCommandEntry(): (id: string, label?: string) => MenuEntry {
  const context = useContext(CommandContextOf);
  return (id, label) => commandEntry(id, context, label);
}

/** A menu's width, and the height of its row, in pixels, so it is kept within the window. */
const MENU_WIDTH = 240;
const ROW_HEIGHT = 26;

/** The element that had the focus as the menu opened, given it back as the menu closes. */
let opener: HTMLElement | null = null;

/** Opens a menu of `items` at `at`. */
export function openMenu(store: Store, at: { x: number; y: number }, items: readonly MenuItem[]): void {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  store.update((now) => ({ ...now, menu: { at, items } }));
}

/** Closes the menu, the focus given back. */
export function closeMenu(store: Store): void {
  store.update((now) => ({ ...now, menu: null }));
  opener?.focus();
  opener = null;
}

/** Whether `event` asks for a context menu from the keyboard: Shift+F10, or the context menu key. */
export function menuKey(event: KeyboardEvent): boolean {
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}

/** The handlers that open a menu of `items()` on an element: by the secondary button, or the keys. */
export function useMenu(items: () => readonly MenuItem[]) {
  const store = useStore();
  return {
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      openMenu(store, { x: event.clientX, y: event.clientY }, items());
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (menuKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        const box = event.currentTarget.getBoundingClientRect();
        openMenu(store, { x: box.left, y: box.bottom }, items());
      }
    },
  };
}

/** The entries of `items` that can be chosen, by their place. */
function choosable(items: readonly MenuItem[]): number[] {
  return items.flatMap((item, i) => (item === "separator" || item.disabled === true ? [] : [i]));
}

/** The next of `places` from `at`, by `step`, round from the last to the first. */
function next(places: readonly number[], at: number, step: number): number {
  if (places.length === 0) {
    return at;
  }
  const here = places.indexOf(at);
  return places[(here + step + places.length) % places.length] ?? at;
}

/** What the keys of a menu do: move the focus, choose, open a submenu, close. */
function menuKeys(m: {
  readonly places: readonly number[];
  readonly focus: number;
  readonly setFocus: (i: number) => void;
  readonly act: (i: number) => void;
  readonly onClose: () => void;
}): Record<string, () => void> {
  const { places, focus, setFocus, act } = m;
  const choose = () => {
    act(focus);
  };
  return {
    ArrowDown: () => {
      setFocus(next(places, focus, 1));
    },
    ArrowUp: () => {
      setFocus(next(places, focus, -1));
    },
    Home: () => {
      setFocus(places[0] ?? focus);
    },
    End: () => {
      setFocus(places.at(-1) ?? focus);
    },
    Enter: choose,
    " ": choose,
    ArrowRight: choose,
    ArrowLeft: m.onClose,
    Escape: m.onClose,
  };
}

/** Where a menu of `rows` at `at` is placed, kept within the window. */
function placed(at: { readonly x: number; readonly y: number }, rows: number): { left: number; top: number } {
  return {
    left: Math.max(0, Math.min(at.x, window.innerWidth - MENU_WIDTH)),
    top: Math.max(0, Math.min(at.y, window.innerHeight - rows * ROW_HEIGHT - 8)),
  };
}

/** The state of menu `items`: the item focused, the submenu open, and what choosing an item does. */
function useMenuState(items: readonly MenuItem[], onChoose: (entry: MenuEntry) => void) {
  const places = choosable(items);
  const [focus, setFocus] = useState(places[0] ?? 0);
  const [sub, setSub] = useState<number | null>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (sub === null) {
      list.current?.children[focus]?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    }
  }, [focus, sub]);
  const act = (i: number) => {
    const item = items[i];
    if (item === undefined || item === "separator" || item.disabled === true) {
      return;
    }
    if (item.items === undefined) {
      onChoose(item);
    } else {
      setSub(i);
    }
  };
  return { places, focus, setFocus, sub, setSub, list, act };
}

/** A list of `items` at `at`: the focus on its first, moved by the keys. */
function MenuList(props: {
  readonly items: readonly MenuItem[];
  readonly at: { readonly x: number; readonly y: number };
  readonly label: string;
  readonly onChoose: (entry: MenuEntry) => void;
  readonly onClose: () => void;
}) {
  const { items, at, onChoose, onClose } = props;
  const { list, ...m } = useMenuState(items, onChoose);
  const keys = menuKeys({ ...m, onClose });
  return (
    <ul
      ref={list}
      role="menu"
      aria-label={props.label}
      className="context-menu"
      style={placed(at, items.length)}
      onKeyDown={(e) => {
        const run = keys[e.key];
        if (run !== undefined && m.sub === null) {
          e.preventDefault();
          e.stopPropagation();
          run();
        }
      }}
    >
      {items.map((item, i) => (
        <MenuRow
          key={`${String(i)}.${item === "separator" ? "-" : item.label}`}
          item={item}
          i={i}
          act={m.act}
          sub={
            m.sub === i
              ? {
                  at: { x: at.x + MENU_WIDTH, y: at.y + i * ROW_HEIGHT },
                  onChoose,
                  onClose: () => {
                    m.setSub(null);
                  },
                }
              : null
          }
        />
      ))}
    </ul>
  );
}

/** A row of a menu: a line, or an item and its submenu if open. */
function MenuRow(props: {
  readonly item: MenuItem;
  readonly i: number;
  readonly act: (i: number) => void;
  readonly sub: {
    readonly at: { readonly x: number; readonly y: number };
    readonly onChoose: (entry: MenuEntry) => void;
    readonly onClose: () => void;
  } | null;
}) {
  const { item, i, act, sub } = props;
  if (item === "separator") {
    return <li role="separator" className="context-separator" />;
  }
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        disabled={item.disabled}
        aria-haspopup={item.items === undefined ? undefined : "menu"}
        aria-expanded={item.items === undefined ? undefined : sub !== null}
        className={item.destructive === true ? "context-item context-destructive" : "context-item"}
        onClick={() => {
          act(i);
        }}
      >
        <span className="context-icon">{item.icon !== undefined && <Icon name={item.icon} />}</span>
        <span className="context-label">{item.label}</span>
        <span className="context-key" aria-hidden={item.key === undefined}>
          {item.key === undefined ? (item.items === undefined ? "" : "▸") : shown(item.key)}
        </span>
      </button>
      {sub !== null && item.items !== undefined && (
        <MenuList items={item.items} at={sub.at} label={item.label} onChoose={sub.onChoose} onClose={sub.onClose} />
      )}
    </li>
  );
}

/** The menu open, if any. */
export function ContextMenu() {
  const store = useStore();
  const menu = useStudio((s) => s.menu);
  if (menu === null) {
    return null;
  }
  const choose = (entry: MenuEntry) => {
    closeMenu(store);
    void Promise.resolve(entry.run?.());
  };
  return (
    <div
      className="menu-backdrop"
      role="presentation"
      onClick={() => {
        closeMenu(store);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        closeMenu(store);
      }}
    >
      <div
        role="presentation"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <MenuList
          items={menu.items}
          at={menu.at}
          label="Context menu"
          onChoose={choose}
          onClose={() => {
            closeMenu(store);
          }}
        />
      </div>
    </div>
  );
}
