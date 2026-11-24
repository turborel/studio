/**
 * The debugger's panel (RULES.md D73): its tools, to continue, step into,
 * over and out, interrupt and stop; what it last said; the routine's text,
 * a breakpoint set or cleared by a click of a line's gutter, one of a
 * condition by Shift and a click, the paused line marked where the pause
 * falls in the text shown; the call stack, a frame chosen of it; and the
 * chosen frame's parameters, variables and cursors.
 */
import "./debugger.css";
import { aligned, lines, pausedLine } from "./lines";
import { chooseFrame, type DebugState, interrupt, resume, stopDebug, toggleBreakpoint } from "./debugging";
import type { FrameView, Step, ValueView } from "../ipc/debugging";
import { Icon, type IconName } from "../icons/Icon";
import { prompted } from "../shell/PromptDialog";
import { type Store, useStore, useStudio } from "../state/store";

/** A tool of the debugger: its title, icon and what it does, and whether the session must be paused for it. */
const TOOLS: readonly (readonly [string, IconName, Step | "interrupt", boolean])[] = [
  ["Continue", "run", "continue", true],
  ["Step Into", "stepInto", "into", true],
  ["Step Over", "stepOver", "over", true],
  ["Step Out", "stepOut", "out", true],
  ["Interrupt", "interrupt", "interrupt", false],
];

/** The debugger's tools. */
function Tools({ debug }: { readonly debug: DebugState }) {
  const store = useStore();
  return (
    <div className="toolbar debug-tools" role="toolbar" aria-label="Debugger">
      {TOOLS.map(([title, icon, act, paused]) => (
        <button
          key={title}
          type="button"
          aria-label={title}
          title={title}
          disabled={paused ? debug.status !== "paused" : debug.status !== "running"}
          onClick={() => void (act === "interrupt" ? interrupt(store) : resume(store, act))}
        >
          <Icon name={icon} />
        </button>
      ))}
      <button type="button" aria-label="Stop Debugging" title="Stop Debugging" onClick={() => void stopDebug(store)}>
        <Icon name="stop" />
      </button>
    </div>
  );
}

/** Sets or clears the breakpoint at line `line`; with Shift, one of a condition asked for. */
async function gutterClick(store: Store, line: number, shift: boolean, set: boolean): Promise<void> {
  if (!shift || set) {
    await toggleBreakpoint(store, line);
    return;
  }
  const condition = await prompted(store, "Conditional Breakpoint", "Pause only where this is true, as PCT > 5");
  if (condition !== null && condition.trim() !== "") {
    await toggleBreakpoint(store, line, condition.trim());
  }
}

/** The routine's text, a line each, its gutter's breakpoints, and the paused line marked. */
function Lines({ debug }: { readonly debug: DebugState }) {
  const store = useStore();
  const text = debug.text?.text;
  if (text === undefined || text === null) {
    return <p className="hint">The routine&apos;s text is shown to the owner of its schema alone.</p>;
  }
  const paused = pausedLine(debug);
  return (
    <ol className="debug-lines" aria-label="Routine text">
      {lines(text).map((code, at) => {
        const line = at + 1;
        const set = debug.breakpoints.find((b) => b.line === line);
        return (
          <li
            key={line}
            className={line === paused ? "current" : undefined}
            aria-current={line === paused ? "true" : undefined}
          >
            <button
              type="button"
              className="gutter"
              aria-label={`Breakpoint at line ${String(line)}`}
              aria-pressed={set !== undefined}
              title={
                set?.condition ??
                (set === undefined ? "Set a breakpoint; Shift and a click, one of a condition" : "Clear it")
              }
              onClick={(e) => void gutterClick(store, line, e.shiftKey, set !== undefined)}
            >
              {set !== undefined && <Icon name="breakpoint" />}
              <span className="line-number">{line}</span>
            </button>
            <code>{code}</code>
          </li>
        );
      })}
    </ol>
  );
}

/** How a frame is named in the call stack. */
export function frameName(frame: FrameView): string {
  if (frame.kind === null) {
    return "a statement run directly";
  }
  const name = `${frame.kind.toUpperCase()} ${frame.schema ?? ""}.${frame.name ?? ""}`;
  if (!frame.visible) {
    return `${name} (not shown to you: you hold no DEBUG on it)`;
  }
  return frame.line === null ? name : `${name} line ${String(frame.line)}, column ${String(frame.column ?? 1)}`;
}

/** The call stack, the innermost frame first, the one chosen pressed. */
function CallStack({ debug }: { readonly debug: DebugState }) {
  const store = useStore();
  const frames = debug.pause?.frames ?? [];
  if (frames.length === 0) {
    return <p className="hint">No call stack: the session is not paused.</p>;
  }
  return (
    <ol className="debug-stack" aria-label="Call stack">
      {frames.map((f, at) => (
        <li key={`${String(at)}.${f.specific ?? ""}`}>
          <button
            type="button"
            aria-pressed={at === debug.frame}
            onClick={() => {
              chooseFrame(store, at);
            }}
          >
            #{at + 1} {frameName(f)}
          </button>
        </li>
      ))}
    </ol>
  );
}

/** A table of `values`, each its name, type and value, NULL shown as such. */
function Values({ label, values }: { readonly label: string; readonly values: readonly ValueView[] }) {
  if (values.length === 0) {
    return null;
  }
  return (
    <table className="details-table" aria-label={label}>
      <caption>{label}</caption>
      <tbody>
        {values.map((v) => (
          <tr key={v.name}>
            <th scope="row">{v.name}</th>
            <td>{v.dataType}</td>
            <td>{v.value ?? "NULL"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The chosen frame's parameters, variables and cursors. */
function Variables({ debug }: { readonly debug: DebugState }) {
  const frame = debug.pause?.frames[debug.frame];
  if (frame === undefined) {
    return null;
  }
  if (!frame.visible) {
    return <p className="hint">Its values are not shown to you: you hold no DEBUG on it.</p>;
  }
  return (
    <section className="debug-variables" aria-label="Variables">
      <Values label="Parameters" values={frame.parameters} />
      <Values label="Variables" values={frame.variables} />
      {frame.cursors.length > 0 && (
        <table className="details-table" aria-label="Cursors">
          <caption>Cursors</caption>
          <tbody>
            {frame.cursors.map((c) => (
              <tr key={c.name}>
                <th scope="row">{c.name}</th>
                <td>{c.open ? "open" : "closed"}</td>
                <td>{c.query}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** The debugger's panel. */
export function DebuggerPanel() {
  const debug = useStudio((s) => s.debug);
  if (debug === null) {
    return (
      <p className="hint debugger" role="region" aria-label="Debugger">
        No routine is being debugged: Debug… of a procedure, function or trigger in the explorer attaches a debugger to
        its connection&apos;s session.
      </p>
    );
  }
  return (
    <div className="debugger" role="region" aria-label="Debugger">
      <Tools debug={debug} />
      <p className="debug-told" role="status">
        <strong>{debug.routine.shown}</strong> {debug.told}
      </p>
      {!aligned(debug) && (
        <p className="hint" role="note">
          The paused statement is not where the text shown says, so no line is marked: the lines are numbered of
          Studio&apos;s CREATE of the routine, whose head may have been written on more lines.
        </p>
      )}
      <Lines debug={debug} />
      <CallStack debug={debug} />
      <Variables debug={debug} />
    </div>
  );
}
