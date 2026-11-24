/**
 * A routine's parameters, shown as its arguments are written (RULES.md
 * D36): where the cursor is within the parentheses of a call of a routine
 * of the catalog, a tooltip names its parameters, their modes and types,
 * and what it returns.
 */
import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { showTooltip, type Tooltip, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { catalogRoutine, type RoutineDetail } from "../../ipc/catalog";
import { type Bridge, connectionOf, defaultSchema, unquoted } from "./catalog";

/** The farthest back a call's name is looked for, in characters. */
const LOOK_BACK = 2000;

/** The call the cursor is in: its routine's name, as written, and where its parenthesis opens; none if in none. */
export function callAt(text: string, at: number): { name: string; open: number } | null {
  let depth = 0;
  for (let i = at - 1; i >= Math.max(0, at - LOOK_BACK); i -= 1) {
    const c = text[i];
    if (c === ")") {
      depth += 1;
    } else if (c === "(") {
      if (depth === 0) {
        const name = /("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)\s*$/u.exec(text.slice(Math.max(0, i - 130), i));
        return name?.[1] === undefined ? null : { name: name[1], open: i };
      }
      depth -= 1;
    } else if (c === ";") {
      return null;
    }
  }
  return null;
}

/** A routine's signature, as the hint writes it: each parameter's default with it, which it may be left out for. */
export function signature(r: RoutineDetail): string {
  const parameters = r.parameters
    .map(
      (p) =>
        `${p.mode} ${p.name === null ? "" : `${p.name} `}${p.typeWritten}${p.default === null ? "" : ` DEFAULT ${p.default}`}`,
    )
    .join(", ");
  return `${r.name}(${parameters})${r.returns === null ? "" : ` RETURNS ${r.returns}`}`;
}

/** Shows a hint, or none. */
const setHint = StateEffect.define<Tooltip | null>();

/** The hint shown. */
const hintField = StateField.define<Tooltip | null>({
  create: () => null,
  update(hint, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHint)) {
        return effect.value;
      }
    }
    return hint;
  },
  provide: (field) => showTooltip.from(field),
});

/** The routines read, by schema and name, each a promise of its detail or of none. */
type Known = Map<string, Promise<RoutineDetail | null>>;

/** The routine `name` of the session's schema, read once, if the catalog lists one. */
function routineNamed(bridge: Bridge, name: string, known: Known): Promise<RoutineDetail | null> {
  const id = connectionOf(bridge);
  const schema = defaultSchema(bridge);
  const wanted = unquoted(name);
  const objects = id === null || schema === null ? undefined : bridge.store.current().catalogs[id]?.objects[schema];
  const routine = objects?.routines.find((r) => r.name === wanted);
  if (id === null || schema === null || routine === undefined) {
    return Promise.resolve(null);
  }
  const key = `${schema}\u0000${routine.specific}`;
  let found = known.get(key);
  if (found === undefined) {
    found = catalogRoutine(id, schema, routine.specific).catch(() => null);
    known.set(key, found);
  }
  return found;
}

/** The hint of a routine's parameters, as the cursor moves. */
export function parameterHints(bridge: Bridge): Extension {
  const known: Known = new Map();
  const plugin = ViewPlugin.fromClass(
    class {
      update(update: ViewUpdate): void {
        if (!update.docChanged && !update.selectionSet) {
          return;
        }
        const view = update.view;
        const at = view.state.selection.main.head;
        const call = callAt(view.state.doc.toString(), at);
        if (call === null) {
          if (view.state.field(hintField) !== null) {
            queueMicrotask(() => {
              view.dispatch({ effects: setHint.of(null) });
            });
          }
          return;
        }
        void routineNamed(bridge, call.name, known).then((routine) => {
          const tooltip: Tooltip | null =
            routine === null
              ? null
              : {
                  pos: call.open,
                  above: true,
                  create: () => {
                    const dom = document.createElement("div");
                    dom.className = "cm-hint";
                    dom.textContent = signature(routine);
                    return { dom };
                  },
                };
          view.dispatch({ effects: setHint.of(tooltip) });
        });
      }
    },
  );
  return [hintField, plugin];
}
