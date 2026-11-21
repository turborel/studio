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
  ["connection.new", "worksheet.new", "connection.disconnect", "connection.reconnect"],
  ["statement.cancel"],
  ["transaction.commit", "transaction.rollback"],
  ["palette.open"],
];

/** What a button of a toolbar is given. */
export interface ToolButtonProps {
  readonly id: string;
  readonly context: CommandContext;
  readonly labels: boolean;
  /** Whether it is disabled, if not as its command says. */
  readonly disabled?: boolean;
  /** What is done before its command runs, as a worksheet made the active one. */
  readonly before?: () => void;
}

/** A button of a toolbar, of command `id`: its icon, its name its accessible name, its tooltip its name and key. */
export function ToolButton({ id, context, labels, disabled, before }: ToolButtonProps) {
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
      disabled={disabled ?? !found.enabled(context)}
      onClick={() => {
        before?.();
        void runCommand(id, context);
      }}
    >
      {found.icon !== undefined && <Icon name={found.icon} size={LARGE} />}
      {labels && <span className="tool-label">{name}</span>}
    </button>
  );
}

/** A separator between a toolbar's groups. */
export function ToolSeparator() {
  return <span className="tool-separator" role="separator" aria-orientation="vertical" />;
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
          {i > 0 && <ToolSeparator />}
          {group.map((id) => (
            <ToolButton key={id} id={id} context={context} labels={labels} />
          ))}
        </div>
      ))}
    </div>
  );
}
