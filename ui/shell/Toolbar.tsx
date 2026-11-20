/**
 * The toolbar (RULES.md R-UI-1, R-UI-3): the commands most used, each a
 * button named for what it does and showing its key, disabled where it
 * cannot run.
 */
import type { CommandContext } from "../commands/commands";
import { COMMANDS, runCommand } from "../commands/commands";
import { shown } from "../commands/keys";
import { useStudio } from "../state/store";

/** The commands the toolbar holds, in order. */
export const TOOLBAR = [
  "connection.new",
  "connection.disconnect",
  "connection.reconnect",
  "statement.cancel",
  "transaction.commit",
  "transaction.rollback",
  "palette.open",
] as const;

/** The toolbar, its commands run with `context`. */
export function Toolbar({ context }: { readonly context: CommandContext }) {
  // Read so the buttons are enabled again as the active connection changes.
  useStudio((s) => s.active);
  return (
    <div className="toolbar" role="toolbar" aria-label="Toolbar">
      {COMMANDS.filter((c) => (TOOLBAR as readonly string[]).includes(c.id)).map((found) => {
        const id = found.id;
        const key = found.key === undefined ? "" : ` (${shown(found.key)})`;
        return (
          <button
            key={id}
            type="button"
            title={`${found.title}${key}`}
            disabled={!found.enabled(context)}
            onClick={() => void runCommand(id, context)}
          >
            {found.title.replace("…", "")}
          </button>
        );
      })}
    </div>
  );
}
