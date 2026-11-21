/**
 * The plan's flow (RULES.md D54): React Flow draws each operator as a node
 * of its kind's icon, its table or index and its estimate, and of EXPLAIN
 * ANALYZE its actual rows, loops, probes and time, a bar of the estimate
 * against the actual rows, and a heat of its share of the time; the rows
 * flow up its lines toward the result. A click chooses a node for the side
 * panel; its button collapses the operators below it. The controls zoom
 * and fit, and the operators a search finds are fitted in view.
 */
import {
  Background,
  Controls,
  Handle,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo } from "react";
import { Icon } from "../icons/Icon";
import { type FlowData, flowOf } from "./flow";
import { indexOf, KIND_ICONS, kindOf } from "./kinds";
import type { PlanNode } from "./plan";
import { tableOf } from "./summary";

/** A bar's width of `rows`, of the most `most` either bar shows, as a share, on a scale of their logarithm. */
export function barShare(rows: number | null, most: number): number {
  return rows === null || most <= 0 ? 0 : Math.log10(rows + 1) / Math.log10(most + 1);
}

/** The bars of a node's estimate and its actual rows. */
function Bars({ node }: { readonly node: PlanNode }) {
  if (node.actual === null) {
    return null;
  }
  const most = Math.max(node.estimated ?? 0, node.actual);
  return (
    <div
      className="flow-bars"
      aria-label={`Estimated ${String(node.estimated ?? "unknown")}, actual ${String(node.actual)}`}
    >
      <span
        className="flow-bar flow-bar-estimate"
        style={{ width: `${String(barShare(node.estimated, most) * 100)}%` }}
      />
      <span className="flow-bar flow-bar-actual" style={{ width: `${String(barShare(node.actual, most) * 100)}%` }} />
    </div>
  );
}

/** The figures a node shows: its estimate, and of EXPLAIN ANALYZE its actual rows, loops, probes and time. */
export function nodeFigures(node: PlanNode): string {
  return [
    node.estimated === null ? "" : `est. ${String(node.estimated)}`,
    node.actual === null ? "" : `actual ${String(node.actual)}`,
    node.loops === null ? "" : `loops ${String(node.loops)}`,
    node.probes === null ? "" : `probes ${String(node.probes)}`,
    node.millis === null ? "" : `${String(node.millis)} ms`,
    node.neverRun ? "never run" : "",
  ]
    .filter((f) => f !== "")
    .join(" · ");
}

/** What a node reads: its table, and its index if it reads one. */
export function readsOf(node: PlanNode): string {
  const table = tableOf(node);
  const index = indexOf(node);
  return [table ?? "", index === null ? "" : `by ${index}`].filter((x) => x !== "").join(" ");
}

/** An operator's node. */
export function OperatorNode({ data }: NodeProps) {
  const { node, share, chosen, matched, collapsed } = data as FlowData;
  const classes = [
    "flow-node",
    chosen ? "flow-chosen" : "",
    matched ? "flow-matched" : "",
    node.neverRun ? "flow-never" : "",
  ];
  return (
    <div
      className={classes.filter((c) => c !== "").join(" ")}
      style={share === null ? undefined : ({ "--heat": `${String(Math.round(share * 100))}%` } as React.CSSProperties)}
      title={node.raw}
    >
      <Handle type="target" position={Position.Bottom} isConnectable={false} className="flow-handle" />
      <Handle type="source" position={Position.Top} isConnectable={false} className="flow-handle" />
      <div className="flow-head">
        <Icon name={KIND_ICONS[kindOf(node)]} />
        <strong>{node.operator}</strong>
        {node.children.length > 0 && <span className="flow-collapse">{collapsed ? "+" : "−"}</span>}
      </div>
      <div className="flow-reads">{readsOf(node)}</div>
      <div className="flow-figures">{nodeFigures(node)}</div>
      <Bars node={node} />
    </div>
  );
}

/** The kinds of node a plan's flow draws. */
const NODE_TYPES = { operator: OperatorNode };

/** Fits the operators the search finds in view, as it changes. */
function FitFound({ found }: { readonly found: readonly string[] }) {
  const flow = useReactFlow();
  useEffect(() => {
    if (found.length > 0) {
      void flow.fitView({ nodes: found.map((id) => ({ id })), duration: 200 });
    }
  }, [flow, found]);
  return null;
}

/** The flow of `roots`, `chosen` marked, the operators `search` finds fitted in view. */
export function PlanGraph(props: {
  readonly roots: readonly PlanNode[];
  readonly collapsed: ReadonlySet<string>;
  readonly chosen: string | null;
  readonly search: string;
  readonly onChoose: (id: string | null) => void;
  readonly onCollapse: (id: string) => void;
}) {
  const { roots, collapsed, chosen, search } = props;
  const { nodes, edges } = useMemo(
    () => flowOf(roots, { collapsed, chosen, search }),
    [roots, collapsed, chosen, search],
  );
  const found = useMemo(() => nodes.filter((n) => n.data.matched).map((n) => n.id), [nodes]);
  return (
    <div className="plan-graph" role="figure" aria-label={`The plan's flow: ${String(nodes.length)} operators`}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView={true}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          colorMode={document.documentElement.dataset["theme"] === "dark" ? "dark" : "light"}
          onNodeClick={(event, n) => {
            const target = event.target as HTMLElement;
            if (target.closest(".flow-collapse") === null) {
              props.onChoose(n.id);
            } else {
              props.onCollapse(n.id);
            }
          }}
          onPaneClick={() => {
            props.onChoose(null);
          }}
        >
          <Background />
          <Controls showInteractive={false} />
          <FitFound found={found} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
