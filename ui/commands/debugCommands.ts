/**
 * The debugger's commands (RULES.md D73): continue, step into, over and
 * out, interrupt and stop the routine debugged, and show the debugger's
 * panel; each enabled where the session debugged allows it. Their keys
 * are the usual debuggers' in the default scheme, and of the function
 * keys' scheme its own (`keys.ts`, D69).
 */
import { interrupt, resume, stopDebug } from "../debugger/debugging";
import type { DebugStatus } from "../debugger/debugging";
import type { Step } from "../ipc/debugging";
import type { IconName } from "../icons/Icon";
import type { Command, CommandContext } from "./commands";

/** Whether a routine is debugged, its session `status` if one is given. */
function debugging(status?: DebugStatus): (context: CommandContext) => boolean {
  return ({ store }) => {
    const d = store.current().debug;
    return d !== null && (status === undefined || d.status === status);
  };
}

/** The command that lets the paused session go on as `step` says. */
function stepping(id: string, title: string, key: string, how: readonly [IconName, Step]): Command {
  const [icon, step] = how;
  return {
    id,
    title,
    category: "Debug",
    key,
    icon,
    enabled: debugging("paused"),
    run: ({ store }) => resume(store, step),
  };
}

/** The debugger's commands, in the order the palette lists them. */
export const DEBUG_COMMANDS: readonly Command[] = [
  stepping("debug.continue", "Continue", "F8", ["run", "continue"]),
  stepping("debug.stepInto", "Step Into", "F11", ["stepInto", "into"]),
  stepping("debug.stepOver", "Step Over", "F10", ["stepOver", "over"]),
  stepping("debug.stepOut", "Step Out", "Shift+F11", ["stepOut", "out"]),
  {
    id: "debug.interrupt",
    title: "Interrupt",
    category: "Debug",
    key: "Shift+F8",
    icon: "interrupt",
    enabled: debugging("running"),
    run: ({ store }) => interrupt(store),
  },
  {
    id: "debug.stop",
    title: "Stop Debugging",
    category: "Debug",
    key: "Shift+F5",
    icon: "stop",
    enabled: debugging(),
    run: ({ store }) => stopDebug(store),
  },
  {
    id: "debug.open",
    title: "Debugger",
    category: "Debug",
    icon: "debug",
    enabled: () => true,
    run: ({ showPanel }) => {
      showPanel?.("debugger");
    },
  },
];
