/**
 * An operator's kind (RULES.md D54), of its name as EXPLAIN writes it:
 * a scan, a scan by an index, a join, a range join, a sort, an aggregate,
 * a limit, a part run in parallel, a filter, a projection or another; and
 * its icon. A range join's search is read of its note: the value its right
 * operand is sorted on, the equalities that group those rows, and the one
 * more comparison it is pruned by (Turborel's `sql/statements/explain.md`).
 */
import type { IconName } from "../icons/Icon";
import type { PlanNode } from "./plan";

/** An operator's kind. */
export type OperatorKind =
  | "scan"
  | "indexScan"
  | "join"
  | "rangeJoin"
  | "sort"
  | "aggregate"
  | "limit"
  | "parallel"
  | "filter"
  | "project"
  | "other";

/** The icon of each kind. */
export const KIND_ICONS: Readonly<Record<OperatorKind, IconName>> = {
  scan: "table",
  indexScan: "index",
  join: "join",
  rangeJoin: "rangeJoin",
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
  ["indexScan", /^Index(Scan|Only)/u],
  ["rangeJoin", /^(Left)?RangeJoin$/u],
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
