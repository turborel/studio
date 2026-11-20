/**
 * The toolbar (RULES.md D35, R-UI-1, R-UI-3): the commands most used, in
 * groups apart by separators, each a button of its icon, named for what it
 * does, its tooltip giving its name and its key; its label shown beside
 * its icon if the settings say; disabled where it cannot run.
 */
import type { CommandContext } from "../commands/commands";
import { command, runCommand } from "../commands/commands";
import { shown } from "../commands/keys";
import { Icon, LARGE } from "../icons/Icon";
import { useStudio } from "../state/store";

/** The commands the toolbar holds, in their groups, in order. */
export const TOOLBAR: readonly (readonly string[])[] = [
  ["connection.new", "connection.disconnect", "connection.reconnect"],
  ["statement.cancel"],
  ["transaction.commit", "transaction.rollback"],
  ["palette.open"],
];

/** A button of the toolbar, of command `id`. */
function ToolButton({
  id,
  context,
  labels,
}: {
  readonly id: string;
  readonly context: CommandContext;
  readonly labels: boolean;
}) {
  const found = command(id);
  if (found === undefined) {
    return null;
  }
  const name = found.title.replace("…", "");
  const key = found.key === undefined ? "" : ` (${shown(found.key)})`;
  return (
    <button
      type="button"
      className="tool"
      title={`${found.title}${key}`}
      aria-label={name}
      disabled={!found.enabled(context)}
      onClick={() => void runCommand(id, context)}
    >
      {found.icon !== undefined && <Icon name={found.icon} size={LARGE} />}
      {labels && <span className="tool-label">{name}</span>}
    </button>
  );
}

/** The toolbar, its commands run with `context`. */
export function Toolbar({ context }: { readonly context: CommandContext }) {
  // Read so the buttons are enabled again as the active connection changes.
  useStudio((s) => s.active);
  const labels = useStudio((s) => s.settings.toolbarLabels);
  return (
    <div className="toolbar" role="toolbar" aria-label="Toolbar">
      {TOOLBAR.map((group, i) => (
        <div key={group.join()} className="tool-group" role="group">
          {i > 0 && <span className="tool-separator" role="separator" aria-orientation="vertical" />}
          {group.map((id) => (
            <ToolButton key={id} id={id} context={context} labels={labels} />
          ))}
        </div>
      ))}
    </div>
  );
}
