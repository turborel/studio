/**
 * A result as nodes and edges (RULES.md D15, D39, D74): React Flow draws
 * the graph, dagre lays it out, left to right, each edge from its
 * source's right to its target's left; each node labelled by its value,
 * or a vertex by its table and key, each edge by its label, on a plate
 * set clear of the nodes and the other labels, parallel edges spread
 * apart. A label with no clear place shows on hover, or behind Show
 * every label.
 */
import dagre from "@dagrejs/dagre";
import { Background, type Edge, MarkerType, type Node, Position, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "../../flow/flow.css";
import { useMemo, useState } from "react";
import { bends, placeLabels, type Rect } from "../../flow/labels";
import { EDGE_TYPES, type LabelledData } from "../../flow/LabelledEdge";
import type { Graph } from "./graph";

/** A node's size, in pixels, as dagre lays it out. */
export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 36;

/** Each node of `graph`'s place, its top left, left to right, as dagre lays it out. */
function places(graph: Graph): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  // Ranks far enough apart for an edge's label between them.
  g.setGraph({ rankdir: "LR", nodesep: 32, ranksep: 140 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of graph.nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of graph.edges) {
    g.setEdge(e.source, e.target, {}, e.id);
  }
  dagre.layout(g);
  return new Map(
    graph.nodes.map((n) => {
      const at = g.node(n.id) as { x: number; y: number };
      return [n.id, { x: at.x - NODE_WIDTH / 2, y: at.y - NODE_HEIGHT / 2 }];
    }),
  );
}

/** `graph` laid out: each node's place, left to right, and each edge's bend and its label's place. */
export function laidOut(graph: Graph): { nodes: Node[]; edges: Edge[]; boxes: Rect[] } {
  const placeOf = places(graph);
  const nodes: Node[] = graph.nodes.map((n) => ({
    id: n.id,
    position: placeOf.get(n.id) ?? { x: 0, y: 0 },
    data: { label: n.label },
    className: "graph-node",
    draggable: true,
    connectable: false,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }));
  const boxes = [...placeOf.values()].map((p) => ({ ...p, width: NODE_WIDTH, height: NODE_HEIGHT }));
  const bent = bends(graph.edges);
  const ends = (id: string, right: boolean) => {
    const p = placeOf.get(id) ?? { x: 0, y: 0 };
    return { x: p.x + (right ? NODE_WIDTH : 0), y: p.y + NODE_HEIGHT / 2 };
  };
  // An edge from a node to itself bends round above it.
  const bendOf = (e: Graph["edges"][number]) => (e.source === e.target ? NODE_HEIGHT : 0) + (bent.get(e.id) ?? 0);
  const placed = placeLabels(
    graph.edges.map((e) => ({
      id: e.id,
      label: e.label,
      from: ends(e.source, true),
      to: ends(e.target, false),
      bend: bendOf(e),
    })),
    boxes,
  );
  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "labelled",
    data: { label: e.label, bend: bendOf(e), at: placed.get(e.id) ?? null } satisfies LabelledData,
    markerEnd: { type: MarkerType.ArrowClosed },
  }));
  return { nodes, edges, boxes };
}

/** A graph drawn, its labels with no clear place shown on hover, or all as the toggle asks. */
export function GraphView({ graph }: { readonly graph: Graph }) {
  const { nodes, edges } = useMemo(() => laidOut(graph), [graph]);
  const [every, setEvery] = useState(false);
  if (graph.nodes.length === 0) {
    return <p className="hint">No node to draw: the columns chosen hold no values.</p>;
  }
  const hidden = edges.filter(
    (e) => (e.data as LabelledData).at === null && (e.data as LabelledData).label !== "",
  ).length;
  const drawn = every ? edges.map((e) => ({ ...e, data: { ...(e.data as LabelledData), always: true } })) : edges;
  return (
    <div
      className="graph-view"
      role="figure"
      aria-label={`${String(graph.nodes.length)} nodes, ${String(graph.edges.length)} edges`}
    >
      {hidden > 0 && (
        <label className="check graph-labels">
          <input
            type="checkbox"
            checked={every}
            onChange={(e) => {
              setEvery(e.target.checked);
            }}
          />
          <span>Show every label ({String(hidden)} shown on hover alone, as no clear place was found)</span>
        </label>
      )}
      <ReactFlow
        nodes={nodes}
        edges={drawn}
        edgeTypes={EDGE_TYPES}
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
