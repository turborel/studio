/**
 * The plan view (RULES.md D36): EXPLAIN's plan, its stages side by side,
 * each a tree of operators with their figures; of EXPLAIN ANALYZE, each
 * operator's estimated rows against its actual rows, a large misestimate
 * marked, its loops, probes and time where told, one that never ran so
 * shown; the plan before beside it, to compare.
 */
import { useState } from "react";
import { misestimated, type Plan, type PlanNode } from "./plan";

/** An operator's figures, as text. */
export function figuresOf(node: PlanNode): string {
  const parts: string[] = [];
  if (node.estimated !== null) {
    parts.push(`est. ${String(node.estimated)}`);
  }
  if (node.actual !== null) {
    parts.push(`actual ${String(node.actual)}`);
  }
  if (node.loops !== null) {
    parts.push(`loops ${String(node.loops)}`);
  }
  if (node.probes !== null) {
    parts.push(`probes ${String(node.probes)}`);
  }
  if (node.millis !== null) {
    parts.push(`${String(node.millis)} ms`);
  }
  if (node.neverRun) {
    parts.push("never run");
  }
  return parts.join(" · ");
}

/** An operator and its inputs. */
function Node({ node }: { readonly node: PlanNode }) {
  const off = misestimated(node);
  const scan = node.operator.endsWith("Scan") && !node.operator.startsWith("Index");
  const classes = [
    "plan-node",
    off ? "plan-misestimate" : "",
    scan ? "plan-full-scan" : "",
    node.neverRun ? "plan-never" : "",
  ];
  return (
    <li>
      <div className={classes.filter((c) => c !== "").join(" ")}>
        <strong>{node.operator}</strong> {node.detail}
        <span className="plan-figures">{figuresOf(node)}</span>
        {off && <span className="plan-flag"> estimate off by ten times or more</span>}
        {node.notes
          .filter((n) => !n.includes("rows") && n !== "never run")
          .map((n) => (
            <span key={n} className="plan-note">
              {" "}
              ({n})
            </span>
          ))}
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child, i) => (
            <Node key={`${String(i)}.${child.operator}`} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** A plan, its stage chosen. */
function OnePlan({ plan, stage, label }: { readonly plan: Plan; readonly stage: string; readonly label: string }) {
  const shown = plan.stages.find((s) => s.name === stage) ?? plan.stages.at(-1);
  return (
    <div className="plan" aria-label={label}>
      <h4 className="plan-label">{label}</h4>
      <ul className="plan-tree">
        {(shown?.roots ?? []).map((root, i) => (
          <Node key={`${String(i)}.${root.operator}`} node={root} />
        ))}
      </ul>
      <p className="hint">
        Rules: {plan.rules.length === 0 ? "none" : plan.rules.join(", ")}
        {plan.counted.length > 0 && ` · counted by storage: ${plan.counted.join(", ")}`}
        {plan.ran !== null && ` · ran: ${String(plan.ran)} rows`}
      </p>
    </div>
  );
}

/** Whether the plan before is shown beside the latest. */
function CompareChoice(props: { readonly compare: boolean; readonly onCompare: (compare: boolean) => void }) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={props.compare}
        onChange={(e) => {
          props.onCompare(e.target.checked);
        }}
      />
      <span>Compare with the plan before</span>
    </label>
  );
}

/** The plan view of `plans`, the latest last; of a what-if's, `whatIf` names its index, and the two are compared at first. */
export function PlanView({
  plans,
  whatIf = null,
}: {
  readonly plans: readonly Plan[];
  readonly whatIf?: string | null;
}) {
  const [stage, setStage] = useState("physical");
  const [compare, setCompare] = useState(whatIf !== null);
  const latest = plans.at(-1);
  if (latest === undefined) {
    return <p className="hint">No plan yet: Explain shows the plan of the statement at the cursor.</p>;
  }
  const before = plans.length > 1 ? plans[0] : undefined;
  return (
    <div className="plan-view">
      <div role="tablist" className="tabs">
        {latest.stages.map((s) => (
          <button
            key={s.name}
            type="button"
            role="tab"
            aria-selected={s.name === stage}
            onClick={() => {
              setStage(s.name);
            }}
          >
            {s.name}
          </button>
        ))}
        {before !== undefined && <CompareChoice compare={compare} onCompare={setCompare} />}
      </div>
      <div className={compare ? "plan-pair" : undefined}>
        {compare && before !== undefined && <OnePlan plan={before} stage={stage} label="The plan before" />}
        <OnePlan
          plan={latest}
          stage={stage}
          label={whatIf === null ? "The plan" : `The plan with the index ${whatIf}, dropped after`}
        />
      </div>
    </div>
  );
}
