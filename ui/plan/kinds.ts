/**
 * An operator's kind (RULES.md D54), of its name as EXPLAIN writes it:
 * a scan, a scan by an index, a join, a sort, an aggregate, a limit, a
 * part run in parallel, a filter, a projection or another; and its icon.
 */
import type { IconName } from "../icons/Icon";
import type { PlanNode } from "./plan";

/** An operator's kind. */
export type OperatorKind =
  "scan" | "indexScan" | "join" | "sort" | "aggregate" | "limit" | "parallel" | "filter" | "project" | "other";

/** The icon of each kind. */
export const KIND_ICONS: Readonly<Record<OperatorKind, IconName>> = {
  scan: "table",
  indexScan: "index",
  join: "join",
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
