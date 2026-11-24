/**
 * The values a run asks of the user (RULES.md D36, D71): of its
 * statement's dynamic parameters, each named and typed as the server
 * describes it, of a CALL with its procedure parameter's mode and
 * position, the IN and INOUT ones asked for and the OUT ones told; and of
 * a script's variables that have none. The values given are remembered
 * by the worksheet.
 */
import { type ParameterInfo, statementParameters } from "../ipc/worksheet";
import type { Given, Store } from "./store";
import { changeWorksheet, worksheetOf } from "./worksheets";

/** The parameters asked for: their names and types, and what an OUT parameter gives back, told alone. */
export interface Asking {
  readonly names: readonly string[];
  readonly types: readonly string[];
  readonly outputs: readonly string[];
}

/** No parameter asked for. */
export const NONE_ASKED: Asking = { names: [], types: [], outputs: [] };

/** Asks the user for values of the parameters `asking`, and of the script variables `variables`. */
export function asked(store: Store, id: string, asking: Asking, variables: readonly string[]): Promise<Given | null> {
  const { names, types, outputs } = asking;
  const w = worksheetOf(store.current(), id);
  const remembered = { ...w?.binds, ...Object.fromEntries(Object.entries(w?.variables ?? {})) };
  return new Promise((answer) => {
    store.update((now) => ({
      ...now,
      dialog: {
        kind: "values",
        names,
        types,
        outputs,
        remembered,
        variables,
        answer: (given) => {
          store.update((then) => ({ ...then, dialog: null }));
          if (given !== null) {
            changeWorksheet(store, id, (x) => ({
              ...x,
              binds: { ...x.binds, ...given.binds },
              variables: { ...x.variables, ...given.variables },
            }));
          }
          answer(given);
        },
      },
    }));
  });
}

/** How a parameter is told: its type, and, of a CALL's, its mode and its procedure parameter's position. */
export function parameterLabel(described: ParameterInfo | undefined): string {
  if (described === undefined) {
    return "";
  }
  return described.ordinal === null
    ? described.typeWritten
    : `${described.typeWritten}, ${described.mode} parameter ${String(described.ordinal)}`;
}

/** A parameter's name as the values dialog writes it: `?2` as Parameter 2, a named one as `:name`. */
export function parameterName(name: string): string {
  return name.startsWith("?") ? `Parameter ${name.slice(1)}` : `:${name}`;
}

/** The values of `sent`'s parameters `names`, asked of the user: none if there are none, null if the user gave none. */
export async function valuesFor(
  store: Store,
  id: string,
  connection: number,
  { sent, names }: { sent: string; names: readonly string[] },
): Promise<(string | null)[] | null> {
  if (names.length === 0) {
    return [];
  }
  const described = await statementParameters(connection, sent);
  // Of a CALL, an OUT parameter's value comes back in its row: it is told, not asked for (RULES.md D71).
  const input = names.flatMap((name, at) =>
    described[at]?.mode === "OUT" ? [] : [{ name, type: parameterLabel(described[at]) }],
  );
  const outputs = names.flatMap((name, at) =>
    described[at]?.mode === "OUT" ? [`${parameterName(name)} ${parameterLabel(described[at])}`] : [],
  );
  if (input.length === 0) {
    return [];
  }
  const asking = { names: input.map((i) => i.name), types: input.map((i) => i.type), outputs };
  const given = await asked(store, id, asking, []);
  return given === null ? null : input.map((i) => given.binds[i.name] ?? null);
}
