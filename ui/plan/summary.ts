/**
 * What a plan comes to (RULES.md D54): the rows it gave and its time, of
 * EXPLAIN ANALYZE; the three operators that cost most, by their own time
 * where the clock gives one, else by the planner's cost; and its warnings,
 * each of a rule of the analyzer's (D50), with its fix as SQL where one
 * would mend it: a large table read whole, an estimate off by ten times or
 * more, a nested loop of many probes, a large table read on one thread,
 * and a column compared with a constant that no index leads (SCAN-NO-INDEX).
 * EXPLAIN tells no spill, so none is warned of.
 */
import type { ScanFinding } from "../analyzer/planRules";
import { misestimated, operators, type Plan, type PlanNode } from "./plan";

/** The rows past which a table read whole is large. */
export const LARGE_TABLE_ROWS = 10_000;
/** The probes or loops past which a nested loop is warned of. */
export const MANY_PROBES = 10_000;
/** EXECUTOR.PARALLEL_MIN_ROWS's default: the rows a table holds before the planner runs a part of it in parallel. */
export const PARALLEL_MIN_ROWS = 65_536;
/** The operators that cost most, shown. */
export const COSTLIEST = 3;

/** A rule of a plan's warnings. */
export type PlanRule = "PLAN-FULL-SCAN" | "PLAN-MISESTIMATE" | "PLAN-MANY-PROBES" | "PLAN-SERIAL" | "SCAN-NO-INDEX";

/** A warning: its rule, what it says, the operator it is of, and the finding whose fix mends it. */
export interface PlanWarning {
  readonly rule: PlanRule;
  readonly says: string;
  readonly node: PlanNode | null;
  readonly finding: ScanFinding | null;
}

/** An operator that costs much: by its own time, else its cost; and its share of the whole. */
export interface Costly {
  readonly node: PlanNode;
  readonly by: "time" | "cost";
  readonly value: number;
  readonly share: number;
}

/** What a plan comes to. */
export interface PlanSummary {
  readonly analyzed: boolean;
  readonly rows: number | null;
  readonly millis: number | null;
  readonly costliest: readonly Costly[];
  readonly warnings: readonly PlanWarning[];
}

/** Whether `node` reads its table whole: a scan, not by an index. */
export function fullScan(node: PlanNode): boolean {
  return node.operator.endsWith("Scan") && !node.operator.startsWith("Index");
}

/** The table `node` reads, as its detail's first word names it, if it is one of a schema. */
export function tableOf(node: PlanNode): string | null {
  return (
    /^((?:[A-Za-z_][\w$]*|"(?:[^"]|"")+")\.(?:[A-Za-z_][\w$]*|"(?:[^"]|"")+"))(?:\s|$)/u.exec(node.detail)?.[1] ?? null
  );
}

/** The thousandths of a millisecond EXPLAIN ANALYZE tells a time to: its microseconds. */
const MICROS_PER_MILLI = 1000;

/** `node`'s own time: its time but its inputs', to the microsecond EXPLAIN ANALYZE tells, so no error of floating point is shown. */
export function ownTime(node: PlanNode): number | null {
  if (node.millis === null) {
    return null;
  }
  const inputs = node.children.reduce((sum, c) => sum + (c.millis ?? 0), 0);
  return Math.round(Math.max(0, node.millis - inputs) * MICROS_PER_MILLI) / MICROS_PER_MILLI;
}

/** The physical stage's roots, or the last stage's. */
export function physicalRoots(plan: Plan): readonly PlanNode[] {
  return (plan.stages.find((s) => s.name === "physical") ?? plan.stages.at(-1))?.roots ?? [];
}

/** The operators that cost most, of `nodes`, `COSTLIEST` of them. */
function costliest(nodes: readonly PlanNode[], total: number | null): Costly[] {
  const timed = nodes.some((n) => n.millis !== null);
  const measured = nodes.flatMap((node) => {
    const value = timed ? ownTime(node) : node.cost;
    return value === null ? [] : [{ node, value }];
  });
  const whole = timed ? (total ?? 0) : measured.reduce((sum, m) => sum + m.value, 0);
  return measured
    .sort((a, b) => b.value - a.value)
    .slice(0, COSTLIEST)
    .map((m) => ({ ...m, by: timed ? ("time" as const) : ("cost" as const), share: whole > 0 ? m.value / whole : 0 }));
}

/** The warnings of `nodes`, of a plan that runs a part in parallel if `parallel`. */
function warningsOf(nodes: readonly PlanNode[], parallel: boolean): PlanWarning[] {
  return nodes.flatMap((node): PlanWarning[] => {
    const found: PlanWarning[] = [];
    const rows = node.estimated ?? 0;
    const table = tableOf(node) ?? "a table";
    if (fullScan(node) && rows >= LARGE_TABLE_ROWS) {
      found.push({
        rule: "PLAN-FULL-SCAN",
        says: `${table} is read whole, about ${String(rows)} rows.`,
        node,
        finding: null,
      });
    }
    if (fullScan(node) && !parallel && rows >= PARALLEL_MIN_ROWS) {
      found.push({
        rule: "PLAN-SERIAL",
        says: `${table}'s ${String(rows)} rows are read on one thread, though a table of ${String(PARALLEL_MIN_ROWS)} or more may be read in parallel: EXECUTOR.DEGREE, EXECUTOR.WORKERS or EXECUTOR.PARALLEL_MIN_ROWS may keep it on one.`,
        node,
        finding: null,
      });
    }
    if (misestimated(node)) {
      found.push({
        rule: "PLAN-MISESTIMATE",
        says: `${node.operator} was estimated at ${String(node.estimated)} rows and gave ${String(node.actual)}: its estimate is off by ten times or more.`,
        node,
        finding: null,
      });
    }
    const many = Math.max(node.probes ?? 0, node.operator.includes("NestedLoop") ? (node.loops ?? 0) : 0);
    if (many >= MANY_PROBES) {
      found.push({
        rule: "PLAN-MANY-PROBES",
        says: `${node.operator} probed ${String(many)} times, once a row of its outer input.`,
        node,
        finding: null,
      });
    }
    return found;
  });
}

/** What `plan` comes to, its SCAN-NO-INDEX findings `findings` among its warnings. */
export function summarize(plan: Plan, findings: readonly ScanFinding[]): PlanSummary {
  const roots = physicalRoots(plan);
  const nodes = operators(roots);
  const [root] = roots;
  const analyzed = nodes.some((n) => n.actual !== null);
  const millis = plan.ranMillis ?? root?.millis ?? null;
  const scans: PlanWarning[] = findings.map((f) => ({ rule: "SCAN-NO-INDEX", says: f.says, node: null, finding: f }));
  return {
    analyzed,
    rows: plan.ran ?? root?.actual ?? null,
    millis,
    costliest: costliest(nodes, millis),
    warnings: [
      ...warningsOf(
        nodes,
        nodes.some((n) => n.operator === "Parallel"),
      ),
      ...scans,
    ],
  };
}
