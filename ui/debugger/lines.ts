/**
 * The routine's lines as the debugger shows them (RULES.md D73), and the
 * paused line marked among them only where the pause falls where they say:
 * of the text as written, the frame's character is its line and column's;
 * of Studio's CREATE, whose head may not be the one written, a statement
 * begins there, after only spaces on its line, or after a `;` or a space,
 * as `core/src/debugging/text.rs` judges it too. A character is a code
 * point, as Turborel counts them.
 */
import type { FrameView } from "../ipc/debugging";
import type { DebugState } from "./debugging";

/** The lines of `text`. */
export function lines(text: string): string[] {
  return text.split("\n");
}

/** The frame of the pause in the routine debugged, the innermost such one, if paused in it. */
function frameOf(debug: DebugState): FrameView | undefined {
  const { schema, name } = debug.routine;
  return debug.pause?.frames.find((f) => f.visible && f.schema === schema && f.specific === name && f.line !== null);
}

/** Of `text` as written, the character at line `line` and column `column`, each from 1; -1 past its end. */
function offset(text: string, line: number, column: number): number {
  const before = lines(text).slice(0, line - 1);
  return before.length === line - 1 ? before.reduce((n, l) => n + Array.from(l).length + 1, 0) + column - 1 : -1;
}

/** Whether `frame`'s place falls where `text` says it does, `exact` if it is the text as written. */
function placed(text: string, exact: boolean, frame: FrameView): boolean {
  const { line, column, at } = frame;
  if (line === null || column === null) {
    return false;
  }
  if (exact) {
    return at !== null && offset(text, line, column) === at;
  }
  const chars = Array.from(lines(text)[line - 1] ?? "");
  const here = chars[column - 1];
  const before = chars.slice(0, Math.max(column - 1, 0));
  const last = before.at(-1);
  return (
    column >= 1 &&
    here !== undefined &&
    here.trim() !== "" &&
    (before.every((c) => c.trim() === "") || last === ";" || last?.trim() === "")
  );
}

/** Whether the pause, if in the routine debugged, falls where the text shown says. */
export function aligned(debug: DebugState): boolean {
  const frame = frameOf(debug);
  const text = debug.text?.text;
  return frame === undefined || text === undefined || text === null || placed(text, debug.text?.exact === true, frame);
}

/** The line, from 1, the pause is at in the routine debugged, if it falls there. */
export function pausedLine(debug: DebugState): number | null {
  const frame = frameOf(debug);
  return frame !== undefined && aligned(debug) ? frame.line : null;
}
