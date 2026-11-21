/**
 * The plan viewer (RULES.md D54): a worksheet's plan of EXPLAIN or EXPLAIN
 * ANALYZE, never its raw text first unless the settings say. Its summary
 * says the rows and time, the operators that cost most, the join order
 * and its algorithm, the rewrite rules, and the warnings, each of an
 * analyzer's rule with its fix. Below, a tab of each stage, drawn as a
 * flow or a tree-table, with the rewrites listed; the raw text last, to be
 * copied. A node chosen shows every detail in a side panel. Two plans are
 * compared side by side, the operators changed marked.
 */
import { KindDetails } from "./OperatorDetails";
import { useContext, useMemo, useState } from "react";
import { openDdl } from "../data/ddlActions";
import { show } from "../state/actions";
import { useStore, useStudio } from "../state/store";
import { worksheetOf } from "../state/worksheets";
import { usePlanFindings } from "../analyzer/PlanFindings";
import { CommandContextOf } from "../shell/ContextMenu";
import { ToolButton } from "../shell/Toolbar";
import { changed } from "./diff";
import { placed } from "./flow";
import type { Plan, PlanNode, Stage } from "./plan";
import { PlanGraph, nodeFigures } from "./PlanGraph";
import { PlanTable } from "./PlanTable";
import { type PlanSummary, type PlanWarning, summarize } from "./summary";

/** How a stage is drawn. */
type Shown = "graph" | "table";

/** The summary of a plan: its rows and time, its costliest operators, its join order, rules and warnings. */
function Summary(props: { readonly plan: Plan; readonly summary: PlanSummary; readonly id: string }) {
  const { plan, summary } = props;
  return (
    <section className="plan-summary" aria-label="Summary of the plan">
      <p>
        {summary.analyzed
          ? `Ran: ${summary.rows === null ? "?" : String(summary.rows)} rows${plan.ranChanged ? " changed" : ""}`
          : "Not run: estimates alone"}
        {summary.millis !== null && ` in ${String(summary.millis)} ms`}
        {plan.joinOrder !== null && ` · join order ${plan.joinOrder.order}, found by ${plan.joinOrder.algorithm}`}
        {` · rewrites: ${plan.rules.length === 0 ? "none" : plan.rules.join(", ")}`}
        {plan.counted.length > 0 && ` · counted by storage: ${plan.counted.join(", ")}`}
      </p>
      {summary.costliest.length > 0 && (
        <ol className="plan-costliest" aria-label="Costliest operators">
          {summary.costliest.map((c, i) => (
            <li key={`${String(i)}.${c.node.raw}`}>
              {c.node.operator} {c.node.detail.slice(0, 60)} ·{" "}
              {c.by === "time" ? `${String(c.value)} ms` : `cost ${String(c.value)}`} (
              {String(Math.round(c.share * 100))}%)
            </li>
          ))}
        </ol>
      )}
      {summary.notes.length > 0 && (
        <ul className="plan-notes" aria-label="Notes">
          {summary.notes.map((n, i) => (
            <li key={`${String(i)}.${n.rule}`}>
              <strong>{n.rule}</strong> {n.says}
            </li>
          ))}
        </ul>
      )}
      {summary.warnings.length > 0 && (
        <ul className="plan-warnings" aria-label="Warnings">
          {summary.warnings.map((w, i) => (
            <Warning key={`${String(i)}.${w.rule}`} warning={w} id={props.id} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** A warning: its rule, what it says, and of SCAN-NO-INDEX its fix and what-if. */
function Warning({ warning, id }: { readonly warning: PlanWarning; readonly id: string }) {
  const store = useStore();
  const connection = useStudio((s) => worksheetOf(s, id)?.connection ?? null);
  const explained = useStudio((s) => worksheetOf(s, id)?.explained ?? null);
  const f = warning.finding;
  return (
    <li>
      <strong>{warning.rule}</strong> {warning.says}
      {f !== null && connection !== null && (
        <>
          <pre className="definition-text">{`${f.create};`}</pre>
          <button
            type="button"
            onClick={() =>
              void openDdl(store, connection, { sql: `${f.create};`, title: `Index of ${f.table}` }, false)
            }
          >
            Open Fix in Worksheet
          </button>
          {explained !== null && (
            <button
              type="button"
              onClick={() => {
                show(store, {
                  kind: "whatIf",
                  whatIf: { worksheet: id, statement: explained, index: f.index, create: f.create, drop: f.drop },
                });
              }}
            >
              What If…
            </button>
          )}
        </>
      )}
    </li>
  );
}

/** Every detail of operator `node`: its name, what it reads and is of, its notes and figures, and its line. */
function Details({ node, onClose }: { readonly node: PlanNode; readonly onClose: () => void }) {
  return (
    <aside className="plan-details" aria-label="Operator">
      <h4>{node.operator}</h4>
      <dl>
        <dt>Of</dt>
        <dd>{node.detail === "" ? "nothing more" : node.detail}</dd>
        <dt>Figures</dt>
        <dd>{nodeFigures(node) === "" ? "none told" : nodeFigures(node)}</dd>
        {node.cost !== null && (
          <>
            <dt>Cost</dt>
            <dd>{String(node.cost)}</dd>
          </>
        )}
        {node.degree !== null && (
          <>
            <dt>Degree</dt>
            <dd>{String(node.degree)}</dd>
          </>
        )}
        <KindDetails node={node} />
        <dt>Notes</dt>
        <dd>{node.notes.length === 0 ? "none" : node.notes.join("; ")}</dd>
        <dt>Line</dt>
        <dd>
          <code>{node.raw}</code>
        </dd>
      </dl>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </aside>
  );
}

/** The raw text of `plan`, and its copy. */
function Raw({ plan }: { readonly plan: Plan }) {
  const text = plan.lines.join("\n");
  return (
    <div className="plan-raw">
      <button type="button" onClick={() => void navigator.clipboard.writeText(text).catch(() => undefined)}>
        Copy
      </button>
      <pre aria-label="Raw plan">{text}</pre>
    </div>
  );
}

/** The rewrite rules a plan's optimizer applied. */
function Rewrites({ plan }: { readonly plan: Plan }) {
  return plan.rules.length === 0 ? (
    <p className="hint">No rewrite rule changed the plan.</p>
  ) : (
    <ul aria-label="Rewrite rules">
      {plan.rules.map((r) => (
        <li key={r}>
          <code>{r}</code>
        </li>
      ))}
    </ul>
  );
}

/** The stage's tabs, then Rewrites and Raw, the one chosen `tab`. */
function Tabs(props: { readonly plan: Plan; readonly tab: string; readonly onTab: (tab: string) => void }) {
  const names = [...props.plan.stages.map((s) => s.name).reverse(), "rewrites", "raw"];
  return (
    <div role="tablist" className="tabs" aria-label="Stages">
      {names.map((n) => (
        <button
          key={n}
          type="button"
          role="tab"
          aria-selected={n === props.tab}
          onClick={() => {
            props.onTab(n);
          }}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/** A choice of the viewer's tools: a radio or a box of `label`. */
function Choice(props: {
  readonly label: string;
  readonly radio?: boolean;
  readonly checked: boolean;
  readonly onChange: (on: boolean) => void;
}) {
  return (
    <label className="check">
      <input
        type={props.radio === true ? "radio" : "checkbox"}
        name={props.radio === true ? "plan-shown" : undefined}
        checked={props.checked}
        onChange={(e) => {
          props.onChange(e.target.checked);
        }}
      />
      <span>{props.label}</span>
    </label>
  );
}

/** Explain and Explain Analyze, of the registry, the second saying it runs the statement. */
function ExplainTools() {
  const context = useContext(CommandContextOf);
  if (context === null) {
    return null;
  }
  return (
    <span className="tool-group" role="group" aria-label="Explain">
      <ToolButton id="worksheet.explain" context={context} labels={false} />
      <ToolButton id="worksheet.explainAnalyze" context={context} labels={false} />
      <span className="hint">Explain Analyze runs the statement.</span>
    </span>
  );
}

/** What the viewer shows, and its changes. */
interface ViewerState {
  readonly shown: Shown;
  readonly setShown: (s: Shown) => void;
  readonly raw: boolean;
  readonly setRaw: (raw: boolean) => void;
  readonly compare: boolean | null;
  readonly setCompare: (c: boolean) => void;
  readonly search: string;
  readonly setSearch: (s: string) => void;
}

/** The viewer's tools: Explain, Explain Analyze, the drawing chosen, raw, the comparison and the search. */
function Tools({ v }: { readonly v: ViewerState }) {
  return (
    <div className="result-toolbar plan-tools" role="toolbar" aria-label="Plan">
      <ExplainTools />
      <Choice
        label="Flow"
        radio
        checked={v.shown === "graph"}
        onChange={() => {
          v.setShown("graph");
        }}
      />
      <Choice
        label="Tree-Table"
        radio
        checked={v.shown === "table"}
        onChange={() => {
          v.setShown("table");
        }}
      />
      <Choice label="Show raw" checked={v.raw} onChange={v.setRaw} />
      {v.compare !== null && (
        <Choice label="Compare with the plan before" checked={v.compare} onChange={v.setCompare} />
      )}
      <input
        aria-label="Search the plan"
        placeholder="Search"
        value={v.search}
        onChange={(e) => {
          v.setSearch(e.target.value);
        }}
      />
    </div>
  );
}

/** The stage `tab` of `before` and of `plan` side by side, the operators each lacks of the other marked. */
function Compared(props: {
  readonly plan: Plan;
  readonly before: Plan;
  readonly tab: string;
  readonly whatIf: string | null;
}) {
  const old = props.before.stages.find((s) => s.name === props.tab)?.roots ?? [];
  const now = props.plan.stages.find((s) => s.name === props.tab)?.roots ?? [];
  return (
    <div className="plan-pair">
      <PlanTable roots={old} changed={changed(old, now)} label="The plan before" />
      <PlanTable
        roots={now}
        changed={changed(now, old)}
        label={props.whatIf === null ? "The plan" : `The plan with the index ${props.whatIf}, dropped after`}
      />
    </div>
  );
}

/** The stage `tab` of `plan`, drawn as `shown`, or compared with `before`'s. */
function StageView(props: {
  readonly plan: Plan;
  readonly before: Plan | undefined;
  readonly compare: boolean;
  readonly tab: string;
  readonly shown: Shown;
  readonly search: string;
  readonly whatIf: string | null;
  readonly chosen: string | null;
  readonly onChoose: (id: string | null) => void;
}) {
  const { plan, before, tab } = props;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const stage: Stage | undefined = plan.stages.find((s) => s.name === tab);
  if (stage === undefined) {
    return <p className="hint">This plan has no stage {tab}.</p>;
  }
  if (props.compare && before !== undefined) {
    return <Compared plan={plan} before={before} tab={tab} whatIf={props.whatIf} />;
  }
  return props.shown === "graph" ? (
    <PlanGraph
      roots={stage.roots}
      collapsed={collapsed}
      chosen={props.chosen}
      search={props.search}
      onChoose={props.onChoose}
      onCollapse={(id) => {
        setCollapsed((now) => {
          const next = new Set(now);
          if (!next.delete(id)) {
            next.add(id);
          }
          return next;
        });
      }}
    />
  ) : (
    <PlanTable roots={stage.roots} chosen={props.chosen} label="The plan" onChoose={props.onChoose} />
  );
}

/** The operator of `plan`'s stage `tab` at path `id`. */
function nodeAt(plan: Plan, tab: string, id: string | null): PlanNode | undefined {
  const stage = plan.stages.find((s) => s.name === tab);
  return id === null ? undefined : placed(stage?.roots ?? [], new Set()).find((p) => p.id === id)?.node;
}

/** The tab shown of `plan`: `tab` where the plan has it, else its last stage, else its raw text. */
function tabOf(plan: Plan, tab: string): string {
  return plan.stages.some((s) => s.name === tab) || tab === "rewrites" || tab === "raw"
    ? tab
    : (plan.stages.at(-1)?.name ?? "raw");
}

/** The tab chosen, raw if the settings say, and what the tools choose. */
function useViewer(latest: Plan | undefined, compareFirst: boolean, rawFirst: boolean) {
  const [tab, setTab] = useState(rawFirst ? "raw" : "physical");
  const [shown, setShown] = useState<Shown>("graph");
  const [compare, setCompare] = useState(compareFirst);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const shownTab = latest === undefined ? tab : tabOf(latest, tab);
  const setRaw = (raw: boolean) => {
    setTab(raw ? "raw" : (latest?.stages.at(-1)?.name ?? "raw"));
  };
  return { tab: shownTab, setTab, shown, setShown, compare, setCompare, search, setSearch, chosen, setChosen, setRaw };
}

/** The body of the viewer: the tab shown, and the operator chosen's details. */
function Body(props: {
  readonly plan: Plan;
  readonly before: Plan | undefined;
  readonly whatIf: string | null;
  readonly v: ReturnType<typeof useViewer>;
}) {
  const { plan, v } = props;
  const node = nodeAt(plan, v.tab, v.chosen);
  return (
    <div className="plan-body">
      <div className="plan-main">
        {v.tab === "raw" && <Raw plan={plan} />}
        {v.tab === "rewrites" && <Rewrites plan={plan} />}
        {v.tab !== "raw" && v.tab !== "rewrites" && (
          <StageView
            plan={plan}
            before={props.before}
            compare={v.compare}
            tab={v.tab}
            shown={v.shown}
            search={v.search}
            whatIf={props.whatIf}
            chosen={v.chosen}
            onChoose={v.setChosen}
          />
        )}
      </div>
      {node !== undefined && (
        <Details
          node={node}
          onClose={() => {
            v.setChosen(null);
          }}
        />
      )}
    </div>
  );
}

/** The plan viewer of worksheet `id`, of `plans`, the latest last. */
export function PlanViewer({ id, plans }: { readonly id: string; readonly plans: readonly Plan[] }) {
  const whatIf = useStudio((s) => worksheetOf(s, id)?.whatIf ?? null);
  const rawFirst = useStudio((s) => s.settings.planView === "raw");
  const latest = plans.at(-1);
  const findings = usePlanFindings(id, latest);
  const summary = useMemo(() => (latest === undefined ? null : summarize(latest, findings)), [latest, findings]);
  const v = useViewer(latest, whatIf !== null, rawFirst);
  if (latest === undefined || summary === null) {
    return (
      <p className="hint">
        No plan yet: Explain shows the plan of the statement at the cursor, Explain Analyze runs it too.
      </p>
    );
  }
  const before = plans.length > 1 ? plans[0] : undefined;
  return (
    <div className="plan-viewer">
      <Tools v={{ ...v, raw: v.tab === "raw", compare: before === undefined ? null : v.compare }} />
      <Summary plan={latest} summary={summary} id={id} />
      <Tabs plan={latest} tab={v.tab} onTab={v.setTab} />
      <Body plan={latest} before={before} whatIf={whatIf} v={v} />
    </div>
  );
}
