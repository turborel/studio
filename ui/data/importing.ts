/**
 * What the import wizard reckons (RULES.md D63): how each field's values
 * are cast into the column it goes into, and what may go wrong there; a
 * new table's columns from a file's fields and their inferred types; and
 * the error policy as an import's spec takes it.
 */
import type { Column } from "../ipc/catalog";
import type { Inferred } from "../ipc/data";
import { headingColumn } from "./tasks";

/** The family of a type, as casts go. */
type Family = "exact" | "approximate" | "boolean" | "text" | "date" | "time" | "timestamp" | "json" | "other";

/** The family of `type`, as SQL writes it. */
export function familyOf(type: string): Family {
  const t = type.trim().toUpperCase();
  const families: readonly (readonly [Family, RegExp])[] = [
    ["exact", /^(?:INTEGER|INT|SMALLINT|BIGINT|NUMERIC|DECIMAL|DEC)\b/u],
    ["approximate", /^(?:REAL|DOUBLE|FLOAT|DECFLOAT)\b/u],
    ["boolean", /^BOOLEAN\b/u],
    ["text", /^(?:CHAR|CHARACTER|VARCHAR|CLOB|NCHAR|NATIONAL|NVARCHAR)\b/u],
    ["date", /^DATE\b/u],
    ["time", /^TIME\b(?!STAMP)/u],
    ["timestamp", /^TIMESTAMP\b/u],
    ["json", /^JSON\b/u],
  ];
  return families.find(([, re]) => re.test(t))?.[0] ?? "other";
}

/** The digits before the point and after it that `type`, an exact numeric type, holds; null if it says none. */
function exactDigits(type: string): readonly [number, number] | null {
  const t = type.trim().toUpperCase();
  const sized = /^(?:NUMERIC|DECIMAL|DEC)\s*\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)/u.exec(t);
  if (sized !== null) {
    const precision = Number(sized[1]);
    const scale = Number(sized[2] ?? "0");
    return [precision - scale, scale];
  }
  const integers: Readonly<Record<string, number>> = { SMALLINT: 5, INTEGER: 10, INT: 10, BIGINT: 19 };
  const whole = integers[t];
  return whole === undefined ? null : [whole, 0];
}

/** The length a character type holds, if it says one. */
function lengthOf(type: string): number | null {
  const sized = /^(?:VARCHAR|CHARACTER VARYING|CHAR|CHARACTER)\s*\(\s*(\d+)\s*\)/iu.exec(type.trim());
  return sized === null ? null : Number(sized[1]);
}

/** How a field's values go into a column: the cast, and what may go wrong. */
export interface CastNote {
  /** The cast, as the wizard shows it; empty where none is needed. */
  readonly cast: string;
  /** What may go wrong, flagged; null if nothing. */
  readonly conflict: string | null;
}

/** Whether values of the family `from` may be cast to `to` at all. */
function castable(from: Family, to: Family): boolean {
  if (from === to || to === "text" || to === "other" || from === "other") {
    return true;
  }
  const numbers: readonly Family[] = ["exact", "approximate"];
  if (numbers.includes(from) && numbers.includes(to)) {
    return true;
  }
  return from === "date" && to === "timestamp";
}

/** How the values of a field, of the inferred type `inferred`, go into the column `column`. */
export function castNote(inferred: Inferred, column: Column): CastNote {
  const from = familyOf(inferred.typeWritten);
  const to = familyOf(column.typeWritten);
  const same = inferred.typeWritten.toUpperCase() === column.typeWritten.toUpperCase();
  const cast = same ? "" : `${inferred.typeWritten} cast to ${column.typeWritten}`;
  if (inferred.nulls && !column.nullable) {
    return { cast, conflict: `${column.name} takes no null, and the file has some` };
  }
  if (!castable(from, to)) {
    return { cast, conflict: `values of ${inferred.typeWritten} do not cast to ${column.typeWritten}` };
  }
  return { cast, conflict: fitConflict(inferred.typeWritten, column.typeWritten) };
}

/** What may not fit of values of the type `from` in a column of `to`, of the same family: digits or characters. */
function fitConflict(from: string, to: string): string | null {
  const had = exactDigits(from);
  const holds = exactDigits(to);
  if (had !== null && holds !== null) {
    if (had[0] > holds[0]) {
      return `numbers of ${String(had[0])} digits before the point do not fit ${to}`;
    }
    if (had[1] > holds[1]) {
      return `digits after the point past ${String(holds[1])} are rounded`;
    }
  }
  const longest = lengthOf(from);
  const room = lengthOf(to);
  if (longest !== null && room !== null && longest > room) {
    return `values up to ${String(longest)} characters may not fit ${to}`;
  }
  return null;
}

/** What is wrong with the fields' columns as a whole: a column chosen twice, or one that takes no null left out. */
export function mappingProblems(fields: readonly (string | null)[], columns: readonly Column[]): string[] {
  const problems: string[] = [];
  const chosen = fields.filter((f): f is string => f !== null);
  for (const name of new Set(chosen)) {
    if (chosen.filter((c) => c === name).length > 1) {
      problems.push(`${name} is chosen for more than one field.`);
    }
  }
  for (const c of columns) {
    const filled = c.default !== null || c.identity !== null || c.generated !== null;
    if (!c.nullable && !filled && !chosen.includes(c.name)) {
      problems.push(`${c.name} takes no null and has no default: choose a field for it.`);
    }
  }
  return problems;
}

/** A column of a new table, as the wizard edits it: its field, name, type, and whether it is made. */
export interface NewColumn {
  readonly field: number;
  readonly name: string;
  readonly type: string;
  readonly included: boolean;
}

/** The columns of a new table of a file's `headings`, or of its `count` fields of none, each of its inferred type. */
export function newColumns(headings: readonly string[] | null, inferred: readonly Inferred[]): NewColumn[] {
  return inferred.map((type, field) => {
    const heading = headings?.[field]?.trim() ?? "";
    const name = heading === "" ? `COLUMN_${String(field + 1)}` : headingColumn(heading);
    return { field, name, type: type.typeWritten, included: true };
  });
}

/** The name a new table of the file `path` takes at first: its name's stem, as a regular identifier where it can be. */
export function tableNameOf(path: string): string {
  const base = path.split(/[\\/]/u).at(-1) ?? "";
  const stem = base.replace(/\.[^.]*$/u, "");
  const regular = stem.replace(/[^A-Za-z0-9_]+/gu, "_").replace(/^_+|_+$/gu, "");
  return /^[A-Za-z]/u.test(regular) ? regular.toUpperCase() : `IMPORTED_${regular.toUpperCase()}`.replace(/_$/u, "");
}

/** How rows refused are taken. */
export type Policy =
  { readonly kind: "stop" } | { readonly kind: "skip" } | { readonly kind: "limit"; readonly rows: number };

/** `policy` as an import's spec takes it: whether to skip, and how many. */
export function policySpec(policy: Policy): { readonly skip: boolean; readonly limit: number | null } {
  switch (policy.kind) {
    case "stop":
      return { skip: false, limit: null };
    case "skip":
      return { skip: true, limit: null };
    case "limit":
      return { skip: true, limit: policy.rows };
  }
}
