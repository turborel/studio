/**
 * The routine debugger's commands (RULES.md D73): a debugging connection
 * opened beside a connection and attached to its session, what it is
 * asked and answers, its end, and the text it shows of a routine.
 */
import { invoke } from "@tauri-apps/api/core";

/** What kind of routine a breakpoint or a frame is of. */
export type RoutineKind = "procedure" | "function" | "trigger";

/** How a paused session goes on. */
export type Step = "into" | "over" | "out" | "continue";

/** A breakpoint set. */
export interface BreakpointView {
  readonly number: number;
  readonly schema: string;
  readonly name: string;
  readonly line: number;
  readonly condition: string | null;
}

/** A parameter or variable of a frame, and its value's text, null for null. */
export interface ValueView {
  readonly name: string;
  readonly dataType: string;
  readonly value: string | null;
}

/** A local cursor of a frame. */
export interface CursorView {
  readonly name: string;
  readonly open: boolean;
  readonly query: string;
}

/** A frame of a paused session's call stack. */
export interface FrameView {
  readonly kind: RoutineKind | null;
  readonly schema: string | null;
  readonly specific: string | null;
  readonly name: string | null;
  readonly visible: boolean;
  readonly at: number | null;
  readonly line: number | null;
  readonly column: number | null;
  readonly parameters: readonly ValueView[];
  readonly variables: readonly ValueView[];
  readonly cursors: readonly CursorView[];
}

/** A pause: its breakpoint, if at one, and its frames, the innermost first. */
export interface PauseView {
  readonly breakpoint: number | null;
  readonly frames: readonly FrameView[];
}

/** What the debugger hears of its session. */
export type DebugEvent =
  | ({ readonly kind: "paused" } & PauseView)
  | { readonly kind: "timedOut" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "ended" };

/** What a debugger is asked, by its `ask`. */
export type DebugAsk =
  | {
      readonly ask: "break";
      readonly kind: RoutineKind;
      readonly schema: string;
      readonly name: string;
      readonly line: number;
      readonly condition: string | null;
    }
  | { readonly ask: "clear"; readonly number: number }
  | { readonly ask: "breakpoints" }
  | { readonly ask: "resume"; readonly step: Step }
  | { readonly ask: "interrupt" }
  | { readonly ask: "stack" }
  | { readonly ask: "wait"; readonly ms: number };

/** What a debugger answers. */
export type DebugAnswer =
  | { readonly kind: "id"; readonly id: number }
  | { readonly kind: "done" }
  | ({ readonly kind: "breakpoint" } & BreakpointView)
  | { readonly kind: "breakpoints"; readonly breakpoints: readonly BreakpointView[] }
  | { readonly kind: "stack"; readonly paused: PauseView | null }
  | { readonly kind: "event"; readonly event: DebugEvent | null };

/** A routine's text as the debugger shows it, and whether it is the text as written. */
export interface RoutineText {
  readonly text: string | null;
  readonly exact: boolean;
}

/** A debugging connection opened beside `connection` and attached to its session: its number. */
export function debugStart(connection: number): Promise<number> {
  return invoke<number>("debug_start", { connection });
}

/** What debugging connection `debuggerId` answers `ask`. */
export function debugAsk(debuggerId: number, ask: DebugAsk): Promise<DebugAnswer> {
  return invoke<DebugAnswer>("debug_ask", { debugger: debuggerId, ask });
}

/** Debugging connection `debuggerId` detached, its session going on, and closed. */
export async function debugStop(debuggerId: number): Promise<void> {
  await invoke("debug_stop", { debugger: debuggerId });
}

/** The text the debugger shows of a routine, by its specific name, or of a trigger on `table`. */
export function debugText(
  connection: number,
  routine: {
    readonly kind: RoutineKind;
    readonly schema: string;
    readonly name: string;
    readonly table: string | null;
  },
): Promise<RoutineText> {
  const { kind, schema, name, table } = routine;
  return invoke<RoutineText>("debug_text", { connection, routine: { kind, schema, name, table } });
}
