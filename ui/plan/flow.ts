/**
 * A plan as a flow (RULES.md D54): each operator a node, its inputs below
 * it, the rows moving up toward the result, laid out by dagre; each line
 * as thick as the rows it carries, on a scale of their logarithm; each
 * node's heat its share of the plan's time. A subtree collapsed hides the
 * operators below it.
 */
import dagre from "@dagrejs/dagre";
import { type Edge, MarkerType, type Node } from "@xyflow/react";
import type { PlanNode } from "./plan";
import { ownTime } from "./summary";

/** A node's size, in pixels, as dagre lays it out. */
export const FLOW_WIDTH = 220;
export const FLOW_HEIGHT = 92;
/** The thinnest and thickest line, in pixels. */
const THIN = 1;
const THICK = 9;

/** An operator as the flow places it: its path, from the roots, as its node's identifier. */
export interface Placed {
  readonly id: string;
  readonly node: PlanNode;
  readonly parent: string | null;
}

/** Each operator of `roots` with its identifier, but those below a node of `collapsed`. */
export function placed(roots: readonly PlanNode[], collapsed: ReadonlySet<string>): Placed[] {
  const out: Placed[] = [];
  const walk = (nodes: readonly PlanNode[], parent: string | null) => {
    nodes.forEach((node, i) => {
      const id = parent === null ? String(i) : `${parent}.${String(i)}`;
      out.push({ id, node, parent });
      if (!collapsed.has(id)) {
        walk(node.children, id);
      }
    });
  };
  walk(roots, null);
  return out;
}

/** The rows a node gives: its actual rows, else its estimate. */
export function rowsOf(node: PlanNode): number {
  return node.actual ?? node.estimated ?? 0;
}

/** A line's thickness of `rows`, of the most rows `most` any line carries. */
export function thickness(rows: number, most: number): number {
  if (most <= 0) {
    return THIN;
  }
  return THIN + ((THICK - THIN) * Math.log10(rows + 1)) / Math.log10(most + 1);
}

/** What a flow's node shows: its operator, its place, its share of the time, and whether it is chosen, matched, collapsible or collapsed. */
export interface FlowData extends Record<string, unknown> {
  readonly node: PlanNode;
  readonly id: string;
  readonly share: number | null;
  readonly chosen: boolean;
  readonly matched: boolean;
  readonly collapsed: boolean;
}

/** The nodes of `all`, placed as `g` lays them out, each its share of `total`, `chosen` and those `search` finds marked. */
function nodesOf(
  all: readonly Placed[],
  g: InstanceType<typeof dagre.graphlib.Graph>,
  {
    total,
    collapsed,
    chosen,
    search,
  }: { total: number | null; collapsed: ReadonlySet<string>; chosen: string | null; search: string },
): Node<FlowData>[] {
  const word = search.trim().toLowerCase();
  return all.map((p): Node<FlowData> => {
    const at = g.node(p.id) as { x: number; y: number };
    const own = ownTime(p.node);
    return {
      id: p.id,
      type: "operator",
      position: { x: at.x - FLOW_WIDTH / 2, y: at.y - FLOW_HEIGHT / 2 },
      data: {
        node: p.node,
        id: p.id,
        share: total !== null && total > 0 && own !== null ? own / total : null,
        chosen: p.id === chosen,
        matched: word !== "" && `${p.node.operator} ${p.node.detail}`.toLowerCase().includes(word),
        collapsed: collapsed.has(p.id) && p.node.children.length > 0,
      },
      draggable: false,
      connectable: false,
    };
  });
}

/** The nodes and edges of `roots`, laid out bottom to top, `chosen` and those `search` finds marked. */
export function flowOf(
  roots: readonly PlanNode[],
  { collapsed, chosen, search }: { collapsed: ReadonlySet<string>; chosen: string | null; search: string },
): { nodes: Node<FlowData>[]; edges: Edge[] } {
  const all = placed(roots, collapsed);
  const total = roots[0]?.millis ?? null;
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "BT", nodesep: 28, ranksep: 56 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const p of all) {
    g.setNode(p.id, { width: FLOW_WIDTH, height: FLOW_HEIGHT });
    if (p.parent !== null) {
      g.setEdge(p.id, p.parent);
    }
  }
  dagre.layout(g);
  const nodes = nodesOf(all, g, { total, collapsed, chosen, search });
  const most = Math.max(0, ...all.map((p) => rowsOf(p.node)));
  const edges = all.flatMap((p): Edge[] =>
    p.parent === null
      ? []
      : [
          {
            id: `${p.id}>${p.parent}`,
            source: p.id,
            target: p.parent,
            style: { strokeWidth: thickness(rowsOf(p.node), most) },
            markerEnd: { type: MarkerType.ArrowClosed },
            label: String(rowsOf(p.node)),
          },
        ],
  );
  return { nodes, edges };
}
