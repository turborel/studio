/**
 * A result as nodes and edges (RULES.md D15, D39): React Flow draws the
 * graph, dagre lays it out, left to right; each node labelled by its
 * value, or a vertex by its table and key, each edge by its label.
 */
import dagre from "@dagrejs/dagre";
import { Background, type Edge, MarkerType, type Node, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import type { Graph } from "./graph";

/** A node's size, in pixels, as dagre lays it out. */
const NODE_WIDTH = 160;
const NODE_HEIGHT = 36;

/** `graph` laid out: each node's place, left to right. */
export function laidOut(graph: Graph): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 64 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of graph.nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of graph.edges) {
    g.setEdge(e.source, e.target, {}, e.id);
  }
  dagre.layout(g);
  const nodes: Node[] = graph.nodes.map((n) => {
    const at = g.node(n.id) as { x: number; y: number };
    return {
      id: n.id,
      position: { x: at.x - NODE_WIDTH / 2, y: at.y - NODE_HEIGHT / 2 },
      data: { label: n.label },
      className: "graph-node",
      draggable: true,
      connectable: false,
    };
  });
  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    markerEnd: { type: MarkerType.ArrowClosed },
  }));
  return { nodes, edges };
}

/** A graph drawn. */
export function GraphView({ graph }: { readonly graph: Graph }) {
  const { nodes, edges } = useMemo(() => laidOut(graph), [graph]);
  if (graph.nodes.length === 0) {
    return <p className="hint">No node to draw: the columns chosen hold no values.</p>;
  }
  return (
    <div
      className="graph-view"
      role="figure"
      aria-label={`${String(graph.nodes.length)} nodes, ${String(graph.edges.length)} edges`}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView={true}
        nodesConnectable={false}
        elementsSelectable={true}
        proOptions={{ hideAttribution: true }}
        colorMode={document.documentElement.dataset["theme"] === "dark" ? "dark" : "light"}
      >
        <Background />
      </ReactFlow>
    </div>
  );
}
