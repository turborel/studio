/**
 * The command palette (RULES.md D30, R-UI-1): every command by its title,
 * filtered as typed, with its key; Enter runs the one chosen, the arrows
 * choose, Escape closes.
 */
import { type KeyboardEvent, useState } from "react";
import { type Command, type CommandContext, COMMANDS, runCommand } from "../commands/commands";
import { Icon } from "../icons/Icon";
import { shown } from "../commands/keys";
import { show } from "../state/actions";
import { useStudio } from "../state/store";
import { Modal } from "./Modal";

/** Whether `title` holds each word of `query`, in any case. */
export function matches(title: string, query: string): boolean {
  const lower = title.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => lower.includes(word));
}

/** The commands found, the chosen one marked, each run by a click. */
function PaletteList({ found, chosen, run }: { found: readonly Command[]; chosen: number; run: (id: string) => void }) {
  const keys = useStudio((s) => s.settings.keyBindings);
  return (
    <ul id="palette-list" className="palette-list" role="listbox" aria-label="Commands">
      {found.map((c, i) => {
        const key = keys[c.id] ?? c.key;
        return (
          <li
            key={c.id}
            role="option"
            aria-selected={i === chosen}
            onClick={() => {
              run(c.id);
            }}
          >
            <span className="with-icon">
              {c.icon !== undefined && <Icon name={c.icon} />}
              {c.category}: {c.title}
            </span>
            {key !== undefined && key !== "" && <kbd>{shown(key)}</kbd>}
          </li>
        );
      })}
    </ul>
  );
}

/** The command palette, its commands run with `context`. */
export function CommandPalette({ context }: { readonly context: CommandContext }) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(0);
  const found = COMMANDS.filter((c) => c.enabled(context) && matches(`${c.category} ${c.title}`, query));
  const close = () => {
    show(context.store, null);
  };
  const run = (id: string) => {
    close();
    void runCommand(id, context);
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setChosen((now) => Math.max(0, Math.min(found.length - 1, now + step)));
    } else if (event.key === "Enter" && found[chosen] !== undefined) {
      run(found[chosen].id);
    }
  };
  return (
    <Modal title="Command Palette" onClose={close}>
      <input
        className="palette-input"
        aria-label="Command"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setChosen(0);
        }}
        onKeyDown={keyDown}
      />
      <PaletteList found={found} chosen={chosen} run={run} />
    </Modal>
  );
}
