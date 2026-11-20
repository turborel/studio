/**
 * A worksheet's markers in a statement (RULES.md D36): its dynamic
 * parameters, `?`, and named ones, `:name`, given values as it runs; and
 * script variables, `${name}`, whose values replace them before it is
 * sent. None is read in a string, a delimited identifier or a comment.
 */
import { spans } from "./scan";

/** A marker found, by its place in the text. */
export interface Marker {
  readonly kind: "parameter" | "named" | "variable";
  readonly name: string;
  readonly from: number;
  readonly to: number;
}

/** A name of a named parameter or a script variable: a letter or underscore, then letters, digits or underscores. */
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;

/** The name at `at` of `text`, if one begins there. */
function nameAt(text: string, at: number): string | null {
  NAME.lastIndex = at;
  const found = NAME.exec(text);
  return found === null ? null : found[0];
}

/** The marker at `i` of `text`'s code, if one begins there. */
function markerAt(text: string, i: number): Marker | null {
  const c = text[i];
  if (c === "?") {
    return { kind: "parameter", name: "", from: i, to: i + 1 };
  }
  if (c === ":" && text[i - 1] !== ":" && text[i + 1] !== ":") {
    const name = nameAt(text, i + 1);
    return name === null ? null : { kind: "named", name, from: i, to: i + 1 + name.length };
  }
  if (c === "$" && text[i + 1] === "{") {
    const name = nameAt(text, i + 2);
    if (name !== null && text[i + 2 + name.length] === "}") {
      return { kind: "variable", name, from: i, to: i + 3 + name.length };
    }
  }
  return null;
}

/** The markers of `text`, in order. */
export function markers(text: string): Marker[] {
  const found: Marker[] = [];
  for (const span of spans(text)) {
    if (span.kind !== "code") {
      continue;
    }
    let i = span.from;
    while (i < span.to) {
      const marker = markerAt(text, i);
      if (marker === null) {
        i += 1;
      } else {
        found.push(marker);
        i = marker.to;
      }
    }
  }
  return found;
}

/** The names of `text`'s script variables, each once, in order. */
export function variableNames(text: string): string[] {
  return [
    ...new Set(
      markers(text)
        .filter((m) => m.kind === "variable")
        .map((m) => m.name),
    ),
  ];
}

/** `text` with each marker of `kinds` replaced by what `by` gives it, from the last back. */
function replaced(text: string, kinds: readonly Marker["kind"][], by: (m: Marker) => string): string {
  let out = text;
  for (const m of markers(text)
    .filter((x) => kinds.includes(x.kind))
    .reverse()) {
    out = out.slice(0, m.from) + by(m) + out.slice(m.to);
  }
  return out;
}

/**
 * `text` with each script variable replaced by its value in `values`.
 *
 * @throws a variable that has no value, by its name.
 */
export function substituted(text: string, values: Readonly<Record<string, string>>): string {
  return replaced(text, ["variable"], (m) => {
    const value = values[m.name];
    if (value === undefined) {
      throw new Error(`The script variable ${m.name} has no value.`);
    }
    return value;
  });
}

/** A statement's parameters: its text with each `:name` written `?`, and each parameter's name, `?` numbered. */
export interface Bound {
  readonly sql: string;
  readonly names: readonly string[];
}

/** `text`'s parameters, named or not, in order: its text as sent, each `:name` a `?`. */
export function bound(text: string): Bound {
  const names: string[] = [];
  let count = 0;
  for (const m of markers(text)) {
    if (m.kind === "parameter") {
      count += 1;
      names.push(`?${String(count)}`);
    } else if (m.kind === "named") {
      count += 1;
      names.push(m.name);
    }
  }
  return { sql: replaced(text, ["named"], () => "?"), names };
}
