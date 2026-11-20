/**
 * A worksheet's panel (RULES.md D36): its toolbar, the connection it runs
 * on, its editor with the outline of its statements, the values of its
 * script variables, and the panes below.
 */
import { useState } from "react";
import type { Piece } from "../ipc/worksheet";
import { useStore, useStudio } from "../state/store";
import type { CommandContext } from "../commands/commands";
import { ToolButton, ToolSeparator } from "../shell/Toolbar";
import { activateWorksheet, changeWorksheet, setConnection, worksheetOf } from "../state/worksheets";
import { toggleAutocommit } from "./commands";
import { selectStatement } from "./editor/actions";
import { Editor } from "./editor/Editor";
import { viewOf } from "./editor/views";
import { Panes } from "./Panes";
import { variableNames } from "./variables";

/** The share of the panel the editor takes, as the panel first opens, in percent. */
const EDITOR_SHARE = 60;
/** The least share either part may take, in percent. */
const LEAST_SHARE = 15;
/** How far an arrow key moves the line between them, in percent. */
const STEP = 5;

/** The choice of the open connection the worksheet runs on. */
function ConnectionChoice({ id }: { readonly id: string }) {
  const store = useStore();
  const chosen = useStudio((s) => worksheetOf(s, id)?.connection ?? null);
  const open = useStudio((s) => s.open);
  return (
    <label className="check">
      <span>Connection</span>
      <select
        value={chosen ?? ""}
        onChange={(e) => {
          setConnection(store, id, e.target.value === "" ? null : Number(e.target.value));
        }}
      >
        <option value="">None</option>
        {open.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The worksheet's toolbar's commands, in their groups, each disabled where the worksheet cannot run it. */
const BAR: readonly (readonly (readonly [string, "idle" | "running" | "always"])[])[] = [
  [
    ["worksheet.run", "idle"],
    ["worksheet.runScript", "idle"],
    ["statement.cancel", "running"],
  ],
  [
    ["worksheet.explain", "idle"],
    ["worksheet.explainAnalyze", "idle"],
  ],
  [
    ["worksheet.format", "always"],
    ["worksheet.save", "always"],
  ],
];

/** The worksheet's toolbar. */
function Bar({ id }: { readonly id: string }) {
  const store = useStore();
  const running = useStudio((s) => worksheetOf(s, id)?.running === true);
  const connection = useStudio((s) => s.open.find((c) => c.id === worksheetOf(s, id)?.connection));
  const labels = useStudio((s) => s.settings.toolbarLabels);
  const context: CommandContext = { store, resetLayout: () => undefined };
  const disabled = { idle: running || connection === undefined, running: !running, always: false };
  const activate = () => {
    activateWorksheet(store, id);
  };
  return (
    <div className="worksheet-bar" role="toolbar" aria-label="Worksheet">
      <ConnectionChoice id={id} />
      {BAR.map((group) => (
        <div key={group.map(([c]) => c).join()} className="tool-group" role="group">
          <ToolSeparator />
          {group.map(([command, when]) => (
            <ToolButton
              key={command}
              id={command}
              context={context}
              labels={labels}
              disabled={disabled[when]}
              before={activate}
            />
          ))}
        </div>
      ))}
      {connection !== undefined && (
        <label className="check">
          <input
            type="checkbox"
            checked={connection.session.transaction.autocommit}
            onChange={() => void toggleAutocommit(store)}
          />
          <span>Autocommit</span>
        </label>
      )}
      {running && (
        <span className="hint" role="status">
          Running…
        </span>
      )}
    </div>
  );
}

/** The values of the script's variables, each given or changed in place. */
function Variables({ id }: { readonly id: string }) {
  const store = useStore();
  const text = useStudio((s) => worksheetOf(s, id)?.text ?? "");
  const values = useStudio((s) => worksheetOf(s, id)?.variables);
  const names = variableNames(text);
  if (names.length === 0) {
    return null;
  }
  return (
    <div className="variables" aria-label="Script variables">
      {names.map((name) => (
        <label key={name} className="check">
          <span>{`\${${name}}`}</span>
          <input
            value={values?.[name] ?? ""}
            placeholder="no value"
            onChange={(e) => {
              changeWorksheet(store, id, (w) => ({ ...w, variables: { ...w.variables, [name]: e.target.value } }));
            }}
          />
        </label>
      ))}
    </div>
  );
}

/** No statements: one list, so the store's readers see no change. */
const NO_PIECES: readonly Piece[] = [];

/** The outline of the script's statements, each chosen by a click. */
function Outline({ id }: { readonly id: string }) {
  const text = useStudio((s) => worksheetOf(s, id)?.text ?? "");
  const pieces = useStudio((s) => worksheetOf(s, id)?.pieces ?? NO_PIECES);
  return (
    <nav className="outline" aria-label="Outline">
      <ol>
        {pieces.map((p) => (
          <li key={`${String(p.from)}.${String(p.to)}`}>
            <button
              type="button"
              className="link"
              title={p.statement.class}
              onClick={() => {
                const view = viewOf(id);
                if (view !== undefined) {
                  selectStatement(view, p.from, p.to);
                }
              }}
            >
              {text.slice(p.from, p.to).split("\n")[0]}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The line between the editor and the panes, dragged or moved by the arrow keys to share the panel between them. */
function Divider({
  share,
  setShare,
}: {
  readonly share: number;
  readonly setShare: (change: (now: number) => number) => void;
}) {
  const bounded = (percent: number) => Math.min(100 - LEAST_SHARE, Math.max(LEAST_SHARE, percent));
  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    const panel = event.currentTarget.parentElement;
    if (panel === null) {
      return;
    }
    const box = panel.getBoundingClientRect();
    const moved = (e: PointerEvent) => {
      setShare(() => bounded(((e.clientY - box.top) / box.height) * 100));
    };
    const done = () => {
      window.removeEventListener("pointermove", moved);
      window.removeEventListener("pointerup", done);
    };
    window.addEventListener("pointermove", moved);
    window.addEventListener("pointerup", done);
  };
  return (
    <div
      className="worksheet-divider"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Editor and panes"
      aria-valuenow={Math.round(share)}
      aria-valuemin={LEAST_SHARE}
      aria-valuemax={100 - LEAST_SHARE}
      tabIndex={0}
      onPointerDown={drag}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          setShare((now) => bounded(now + (e.key === "ArrowUp" ? -STEP : STEP)));
        }
      }}
    />
  );
}

/** The panel of worksheet `id`. */
export function Worksheet({ id }: { readonly id: string }) {
  const exists = useStudio((s) => worksheetOf(s, id) !== undefined);
  const outline = useStudio((s) => worksheetOf(s, id)?.outline === true);
  const [share, setShare] = useState(EDITOR_SHARE);
  if (!exists) {
    return <div className="panel-empty">This worksheet is closed.</div>;
  }
  return (
    <div className="worksheet" role="region" aria-label="Worksheet">
      <Bar id={id} />
      <Variables id={id} />
      <div className="worksheet-body" style={{ flexBasis: `${String(share)}%` }}>
        {outline && <Outline id={id} />}
        <Editor id={id} />
      </div>
      <Divider share={share} setShare={setShare} />
      <Panes id={id} />
    </div>
  );
}
