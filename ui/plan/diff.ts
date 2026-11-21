/**
 * Two plans compared (RULES.md D54): each operator known by its name and
 * what it is of, its figures aside, so an operator of one plan the other
 * lacks is told changed, as an index read where a table was scanned.
 */
import { operators, type PlanNode } from "./plan";

/** An operator's mark, its figures aside: its name and its detail. */
export function signature(node: PlanNode): string {
  return `${node.operator} ${node.detail}`;
}

/** The marks of the operators of `roots` that `other` lacks, each as often as it lacks it. */
export function changed(roots: readonly PlanNode[], other: readonly PlanNode[]): ReadonlySet<PlanNode> {
  const left = new Map<string, number>();
  for (const n of operators(other)) {
    left.set(signature(n), (left.get(signature(n)) ?? 0) + 1);
  }
  const found = new Set<PlanNode>();
  for (const n of operators(roots)) {
    const k = signature(n);
    const count = left.get(k) ?? 0;
    if (count > 0) {
      left.set(k, count - 1);
    } else {
      found.add(n);
    }
  }
  return found;
}
