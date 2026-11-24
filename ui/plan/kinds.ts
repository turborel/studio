/**
 * An operator's kind (RULES.md D54), of its name as EXPLAIN writes it:
 * a data change, a scan, a scan by an index, a join, a semi join, an antijoin, a mark join, a range
 * join, an unnesting, a phase of predicate transfer, a sort, an aggregate,
 * a limit, a part run in parallel, a filter, a projection or another; and
 * its icon. A range join's search is read of its note: the value its right
 * operand is sorted on, the equalities that group those rows, and the one
 * more comparison it is pruned by; an aggregate's grouping of its line:
 * its keys, what it computes, and whether it is streamed, a group made at
 * a time over rows in the order of its keys (Turborel's
 * `sql/statements/explain.md`).
 */
import type { IconName } from "../icons/Icon";
import type { PlanNode } from "./plan";

/** An operator's kind. */
export type OperatorKind =
  | "change"
  | "scan"
  | "indexScan"
  | "join"
  | "semiJoin"
  | "antiJoin"
  | "markJoin"
  | "rangeJoin"
  | "unnest"
  | "transfer"
  | "sort"
  | "aggregate"
  | "limit"
  | "parallel"
  | "filter"
  | "project"
  | "other";

/** The icon of each kind. */
export const KIND_ICONS: Readonly<Record<OperatorKind, IconName>> = {
  change: "edit",
  scan: "table",
  indexScan: "index",
  join: "join",
  semiJoin: "semiJoin",
  antiJoin: "antiJoin",
  markJoin: "markJoin",
  rangeJoin: "rangeJoin",
  unnest: "join",
  transfer: "filter",
  sort: "sort",
  aggregate: "aggregate",
  limit: "limit",
  parallel: "parallel",
  filter: "filter",
  project: "column",
  other: "explain",
};

/** The kinds, each of the names it is known by: the first that a name holds is its kind. */
const KNOWN: readonly (readonly [OperatorKind, RegExp])[] = [
  ["transfer", /^(PredicateTransfer|TransferredRows)$/u],
  ["change", /^(Insert|Update|Delete|Merge)$/u],
  ["indexScan", /^Index(Scan|Only)/u],
  ["rangeJoin", /^(Left)?RangeJoin$/u],
  ["unnest", /^(LeftOuter)?Unnest$/u],
  ["semiJoin", /SemiJoin$|^Semi(?=[A-Z]|$)/u],
  ["antiJoin", /AntiJoin$|^Anti(?=[A-Z]|$)/u],
  ["markJoin", /MarkJoin$|^Mark$/u],
  ["join", /(Join|NestedLoop|Product|join)$|^(Left|Right|Full|Inner|Semi|Anti)\b/u],
  ["scan", /Scan$/u],
  ["sort", /^(Sort|TopN|Order)/u],
  ["aggregate", /^(Aggregate|Distinct|Group|Window)/u],
  ["limit", /^(Limit|Fetch|Offset)/u],
  ["parallel", /^Parallel/u],
  ["filter", /^Filter/u],
  ["project", /^Project/u],
];

/** The kind of `node`. */
export function kindOf(node: PlanNode): OperatorKind {
  return KNOWN.find(([, test]) => test.test(node.operator))?.[0] ?? "other";
}

/** The index a node reads, of `using NAME`, if one. */
export function indexOf(node: PlanNode): string | null {
  return / using (\S+)/u.exec(node.detail)?.[1] ?? null;
}

/** What a range join searches by: the value sorted on, the equalities that group the rows, and the comparison it is pruned by. */
export interface RangeSearch {
  readonly sorted: string;
  readonly within: readonly string[];
  readonly pruned: string | null;
}

/** How a semi join or an antijoin joins: of each left row, kept at its first match or kept for having none; and how its right is searched, if told. */
export interface SemiSearch {
  readonly anti: boolean;
  readonly method: string | null;
}

/** The ways of a semi join or an antijoin, by its name as EXPLAIN writes it. */
const SEMI_METHODS: readonly (readonly [RegExp, string])[] = [
  [/^HashRight/u, "its left hashed, its right read against it"],
  [/^Hash/u, "its right hashed, its left read against it"],
  [/^NestedLoop/u, "a nested loop"],
  [/IndexNestedLoop$/u, "an index of its right probed, a left row at a time"],
  [/SynchronizedSpatialJoin$/u, "two spatial indexes read together"],
];

/** How semi join or antijoin `node` joins; none of another operator. */
export function semiOf(node: PlanNode): SemiSearch | null {
  const kind = kindOf(node);
  if (kind !== "semiJoin" && kind !== "antiJoin") {
    return null;
  }
  return { anti: kind === "antiJoin", method: SEMI_METHODS.find(([test]) => test.test(node.operator))?.[1] ?? null };
}

/** How a mark join marks each row of its left: the comparison its mark ORs, if any, and how its right is searched. */
export interface MarkSearch {
  readonly marking: string | null;
  readonly method: string | null;
}

/** How mark join `node` marks, of `HashMarkJoin` or `NestedLoopMarkJoin`'s note `(marking …)`, or the logical `Mark join on … marking …`; none of another operator. */
export function markOf(node: PlanNode): MarkSearch | null {
  if (kindOf(node) !== "markJoin") {
    return null;
  }
  const note = node.notes.find((n) => n.startsWith("marking "))?.slice("marking ".length);
  const logical = node.detail.split(" marking ").slice(1).join(" marking ");
  const method = node.operator.startsWith("Hash")
    ? "its right hashed by the values its rows are matched on"
    : node.operator.startsWith("NestedLoop")
      ? "a nested loop"
      : null;
  return { marking: note ?? (logical === "" ? null : logical), method };
}

/** How an aggregate groups: whether streamed, its keys, and what it computes. */
export interface Grouping {
  readonly streamed: boolean;
  readonly keys: readonly string[];
  readonly computing: readonly string[];
}

/** The list `[a, b]` written after `word` in `detail`, its items split at the commas between them. */
function listAfter(detail: string, word: string): string[] {
  const at = detail.indexOf(`${word} [`);
  if (at < 0) {
    return [];
  }
  let depth = 0;
  let item = "";
  const items: string[] = [];
  for (const c of detail.slice(at + word.length + 2)) {
    if (c === "]" && depth === 0) {
      break;
    }
    depth += c === "(" || c === "[" ? 1 : c === ")" || c === "]" ? -1 : 0;
    if (c === "," && depth === 0) {
      items.push(item.trim());
      item = "";
    } else {
      item += c;
    }
  }
  return [...items, item.trim()].filter((i) => i !== "");
}

/** The grouping of aggregate `node`, of `[streamed] group by [...] computing [...]`; none of another operator. */
export function groupingOf(node: PlanNode): Grouping | null {
  if (kindOf(node) !== "aggregate" || !/^(?:streamed\b|(?:group by|computing) \[)/u.test(node.detail)) {
    return null;
  }
  return {
    streamed: /^streamed\b/u.test(node.detail),
    keys: listAfter(node.detail, "group by"),
    computing: listAfter(node.detail, "computing"),
  };
}

/** The search of range join `node`, of its note `sorted on …`; none of another operator. */
export function rangeOf(node: PlanNode): RangeSearch | null {
  const note = node.notes.find((n) => n.startsWith("sorted on "));
  if (kindOf(node) !== "rangeJoin" || note === undefined) {
    return null;
  }
  const [how = "", pruned] = note.slice("sorted on ".length).split(", pruned by ");
  const [sorted = "", ...within] = how.split(" within ");
  return { sorted, within, pruned: pruned ?? null };
}

/** A phase of predicate transfer: the chain's tables it reads, and the steps it reads them in, of its line `PredicateTransfer of N leaves, M steps`. */
export interface Transfer {
  readonly leaves: number | null;
  readonly steps: number | null;
}

/** The phase of predicate transfer `node` is, of its line; none of another operator. */
export function transferOf(node: PlanNode): Transfer | null {
  if (node.operator !== "PredicateTransfer") {
    return null;
  }
  const count = (word: string) => {
    const found = new RegExp(`(\\d+) ${word}`, "u").exec(node.detail)?.[1];
    return found === undefined ? null : Number(found);
  };
  return { leaves: count("leaves?"), steps: count("steps?") };
}

/** What an unnesting joins each row of its input to: the collections it gives, kept with none if outer, numbered if with ordinality. */
export interface Unnesting {
  readonly collections: number | null;
  readonly outer: boolean;
  readonly ordinality: boolean;
}

/** What unnesting `node` joins, of `Unnest of N collections [with ordinality]`, as a LATERAL derived table, UNNEST or XMLTABLE is run. */
export function unnestOf(node: PlanNode): Unnesting | null {
  if (kindOf(node) !== "unnest") {
    return null;
  }
  const found = /^of (\d+) collections?/u.exec(node.detail)?.[1];
  return {
    collections: found === undefined ? null : Number(found),
    outer: node.operator.startsWith("LeftOuter"),
    ordinality: /\bwith ordinality\b/u.test(node.detail),
  };
}
