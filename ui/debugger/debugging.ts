/**
 * The routine debugger's state and acts (RULES.md D73): a debugging
 * connection opened beside the one a routine is debugged on, attached to
 * its session; breakpoints by line of the routine's text, conditional
 * ones too; the target's events heard as they come, a pause with its call
 * stack, a timeout, a cancel or its end, each told plainly; steps into,
 * over and out, continuing and interrupting; and the end, which detaches
 * it and lets the session go on.
 */
import {
  type BreakpointView,
  debugAsk,
  type DebugEvent,
  debugStart,
  debugStop,
  debugText,
  type PauseView,
  type RoutineKind,
  type RoutineText,
  type Step,
} from "../ipc/debugging";
import type { StudioError } from "../ipc/connections";
import type { CommandContext } from "../commands/commands";
import { useEffect } from "react";
import { attempt, isStudioError } from "../state/actions";
import { type Store, useStudio } from "../state/store";

/** The routine or trigger debugged: its kind, schema and specific name, or a trigger's name and its table. */
export interface DebugRoutine {
  readonly kind: RoutineKind;
  readonly schema: string;
  readonly name: string;
  readonly shown: string;
  readonly table: string | null;
}

/** Where the debugged session is: attached and not yet paused, running, paused, or ended. */
export type DebugStatus = "running" | "paused" | "ended";

/** A debugging session of a connection. */
export interface DebugState {
  /** The connection whose session is debugged. */
  readonly target: number;
  /** The debugging connection. */
  readonly debuggerId: number;
  readonly routine: DebugRoutine;
  readonly text: RoutineText | null;
  readonly breakpoints: readonly BreakpointView[];
  readonly status: DebugStatus;
  readonly pause: PauseView | null;
  /** The frame chosen of the pause, from the innermost. */
  readonly frame: number;
  /** What the debugger last said, plainly. */
  readonly told: string;
}

/** How long a wait for the session's next event takes at most, in milliseconds. */
const WAIT_MS = 500;
/** How long to wait again where a wait came back at once, as of a test's backend. */
const PAUSE_MS = 200;
/** The SQLCODE of a privilege not held. */
const NO_PRIVILEGE = -104;

/** Changes the debugging session `debuggerId`, if it is still the one, by `change`. */
function change(store: Store, debuggerId: number, change: (d: DebugState) => DebugState): void {
  store.update((now) => {
    const d = now.debug;
    return d?.debuggerId === debuggerId ? { ...now, debug: change(d) } : now;
  });
}

/** What `event` says, plainly. */
export function said(event: DebugEvent): string {
  switch (event.kind) {
    case "paused":
      return event.breakpoint === null ? "Paused." : `Paused at breakpoint ${String(event.breakpoint)}.`;
    case "timedOut":
      return "The pause timed out: past DEBUGGER.PAUSE_TIMEOUT_MS the session went on by itself.";
    case "cancelled":
      return "The paused statement was cancelled, and the session went on.";
    case "ended":
      return "The session ended, and the debugger is detached.";
  }
}

/** Keeps `event` of debugging session `debuggerId`. */
export function heard(store: Store, debuggerId: number, event: DebugEvent): void {
  change(store, debuggerId, (d) => ({
    ...d,
    status: event.kind === "paused" ? "paused" : event.kind === "ended" ? "ended" : "running",
    pause: event.kind === "paused" ? { breakpoint: event.breakpoint, frames: event.frames } : null,
    frame: 0,
    told: said(event),
  }));
}

/** Whether debugging session `debuggerId` is the one, and goes on. */
function listening(store: Store, debuggerId: number): boolean {
  const d = store.current().debug;
  return d !== null && d.debuggerId === debuggerId && d.status !== "ended";
}

/** Hears the events of debugging session `debuggerId` as they come, until it ends or is stopped. */
async function listen(store: Store, debuggerId: number): Promise<void> {
  while (listening(store, debuggerId)) {
    const began = Date.now();
    try {
      const answer = await debugAsk(debuggerId, { ask: "wait", ms: WAIT_MS });
      if (answer.kind === "event" && answer.event !== null) {
        heard(store, debuggerId, answer.event);
      } else if (Date.now() - began < PAUSE_MS) {
        await new Promise((done) => setTimeout(done, PAUSE_MS));
      }
    } catch (thrown: unknown) {
      change(store, debuggerId, (d) => ({ ...d, status: "ended", pause: null, told: refusal(thrown, d.routine) }));
    }
  }
}

/** What the debugger says of `thrown`: of a routine its user holds no DEBUG on, how it may be granted. */
export function refusal(thrown: unknown, routine: DebugRoutine): string {
  if (!isStudioError(thrown)) {
    return String(thrown);
  }
  const error: StudioError = thrown;
  if (error.sqlstate === "42000" && error.sqlcode === NO_PRIVILEGE) {
    const of = routine.kind === "trigger" ? "the trigger's schema" : routine.shown;
    const grant =
      routine.kind === "trigger"
        ? "A trigger is debugged by the owner of its schema."
        : `Its owner may grant it: GRANT DEBUG ON ${routine.kind.toUpperCase()} ${routine.shown} TO <you>.`;
    return `${error.sqlstate} (${String(error.sqlcode)}): ${error.message}. You hold no DEBUG on ${of}. ${grant}`;
  }
  return `${error.sqlstate} (${String(error.sqlcode)}): ${error.message}`;
}

/**
 * Debugs `routine` on connection `connection`: a debugging connection opened beside it and attached to its session,
 * any debugging before it stopped first, and its events heard; then whatever runs on `connection` pauses at the
 * breakpoints set.
 */
export async function startDebug(store: Store, connection: number, routine: DebugRoutine): Promise<void> {
  await stopDebug(store);
  const debuggerId = await attempt(store, () => debugStart(connection));
  if (debuggerId === undefined) {
    return;
  }
  const text = (await attempt(store, () => debugText(connection, routine))) ?? null;
  store.update((now) => ({
    ...now,
    debug: {
      target: connection,
      debuggerId,
      routine,
      text,
      breakpoints: [],
      status: "running",
      pause: null,
      frame: 0,
      told: `Attached to the session. Set a breakpoint, then run what calls ${routine.shown}.`,
    },
  }));
  void listen(store, debuggerId);
}

/** Sets a breakpoint at line `line` of the routine debugged, where `condition` is true if given, or clears the one there. */
export async function toggleBreakpoint(store: Store, line: number, condition: string | null = null): Promise<void> {
  const d = store.current().debug;
  if (d === null) {
    return;
  }
  const set = d.breakpoints.find((b) => b.line === line);
  try {
    if (set !== undefined) {
      await debugAsk(d.debuggerId, { ask: "clear", number: set.number });
      change(store, d.debuggerId, (x) => ({ ...x, breakpoints: x.breakpoints.filter((b) => b.number !== set.number) }));
      return;
    }
    const { kind, schema, name } = d.routine;
    const answer = await debugAsk(d.debuggerId, { ask: "break", kind, schema, name, line, condition });
    if (answer.kind === "breakpoint") {
      const view: BreakpointView = {
        number: answer.number,
        schema: answer.schema,
        name: answer.name,
        line: answer.line,
        condition: answer.condition,
      };
      change(store, d.debuggerId, (x) => ({
        ...x,
        breakpoints: [...x.breakpoints, view],
        told: `Breakpoint ${String(view.number)} at line ${String(line)}${condition === null ? "" : `, where ${condition}`}.`,
      }));
    }
  } catch (thrown: unknown) {
    change(store, d.debuggerId, (x) => ({ ...x, told: refusal(thrown, x.routine) }));
  }
}

/** Lets the paused session go on as `step` says. */
export async function resume(store: Store, step: Step): Promise<void> {
  const d = store.current().debug;
  if (d?.status !== "paused") {
    return;
  }
  try {
    await debugAsk(d.debuggerId, { ask: "resume", step });
    change(store, d.debuggerId, (x) => ({ ...x, status: "running", pause: null, told: "Going on." }));
  } catch (thrown: unknown) {
    change(store, d.debuggerId, (x) => ({ ...x, told: refusal(thrown, x.routine) }));
  }
}

/** Asks the running session to pause at its next statement of a routine its debugger may see into. */
export async function interrupt(store: Store): Promise<void> {
  const d = store.current().debug;
  if (d?.status !== "running") {
    return;
  }
  try {
    await debugAsk(d.debuggerId, { ask: "interrupt" });
    change(store, d.debuggerId, (x) => ({ ...x, told: "Pausing at the next statement." }));
  } catch (thrown: unknown) {
    change(store, d.debuggerId, (x) => ({ ...x, told: refusal(thrown, x.routine) }));
  }
}

/** Ends debugging: detached, the session going on as if never debugged, and the debugging connection closed. */
export async function stopDebug(store: Store): Promise<void> {
  const d = store.current().debug;
  if (d === null) {
    return;
  }
  store.update((now) => ({ ...now, debug: null }));
  await attempt(store, () => debugStop(d.debuggerId));
}

/** Chooses frame `frame` of the pause, from the innermost. */
export function chooseFrame(store: Store, frame: number): void {
  const d = store.current().debug;
  if (d !== null) {
    change(store, d.debuggerId, (x) => ({ ...x, frame }));
  }
}

/** Shows the debugger's panel as a routine's debugging begins, by `context`'s dock. */
export function useDebuggerShown(context: CommandContext): void {
  const debugging = useStudio((s) => s.debug?.debuggerId ?? null);
  useEffect(() => {
    if (debugging !== null) {
      context.showPanel?.("debugger");
    }
  }, [debugging, context]);
}
