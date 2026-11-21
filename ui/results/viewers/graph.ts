/**
 * A result as a graph, for its node-and-edge view (RULES.md D39): of a
 * column of paths, as PATH_TO_JSON gives a path, each vertex a node and
 * each edge between the vertices it joins; or of two columns, each row an
 * edge from the value of one to the value of the other, a third, if
 * chosen, its label.
 */
import type { Cell } from "../../ipc/connections";

/** A node of the view: its key, and its label. */
export interface GraphNode {
  readonly id: string;
  readonly label: string;
}

/** An edge of the view. */
export interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label: string;
}

/** What the view draws. */
export interface Graph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

/** How a result is read as a graph. */
export type GraphChoice =
  | { readonly kind: "paths"; readonly column: number }
  | { readonly kind: "pairs"; readonly from: number; readonly to: number; readonly label: number | null };

/** The most nodes the view draws. */
export const MAX_NODES = 500;

/** An element's identity, as ELEMENT_ID and PATH_TO_JSON write it: its table and key. */
interface Identity {
  readonly table: string;
  readonly key: readonly unknown[];
}

/** Whether `value` is an element's identity. */
function isIdentity(value: unknown): value is Identity {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const o = value as Record<string, unknown>;
  return typeof o["table"] === "string" && Array.isArray(o["key"]);
}

/** The elements of a path, `text` as PATH_TO_JSON writes it: null if it is none. */
export function pathOf(text: Cell): Identity[] | null {
  if (text === null) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) && value.length > 0 && value.every(isIdentity) ? value : null;
  } catch {
    return null;
  }
}

/** An identity as a node's label: its table, then its key's values. */
function identityLabel(identity: Identity): string {
  return `${identity.table} ${identity.key.map((k) => (typeof k === "string" ? k : JSON.stringify(k))).join(", ")}`;
}

/** How `rows` are first read as a graph: by a column of paths, else by the first two columns; null of fewer. */
export function firstChoice(rows: readonly (readonly Cell[])[], columns: number): GraphChoice | null {
  const first = rows.find((r) => r.some((c) => c !== null));
  const paths = first?.findIndex((c) => pathOf(c) !== null) ?? -1;
  if (paths !== -1) {
    return { kind: "paths", column: paths };
  }
  return columns >= 2 ? { kind: "pairs", from: 0, to: 1, label: null } : null;
}

/** A graph being made: its nodes by key, and its edges. */
class Making {
  readonly nodes = new Map<string, GraphNode>();
  readonly edges: GraphEdge[] = [];

  /** Adds a node, unless it is there. */
  node(id: string, label: string): void {
    if (!this.nodes.has(id) && this.nodes.size < MAX_NODES) {
      this.nodes.set(id, { id, label });
    }
  }

  /** Adds an edge between two nodes, if both are there. */
  edge(source: string, target: string, label: string): void {
    if (this.nodes.has(source) && this.nodes.has(target)) {
      this.edges.push({ id: `e${String(this.edges.length)}`, source, target, label });
    }
  }
}

/** The graph of `rows` read as `choice` says. */
export function graphOf(rows: readonly (readonly Cell[])[], choice: GraphChoice): Graph {
  const g = new Making();
  for (const row of rows) {
    if (choice.kind === "paths") {
      const path = pathOf(row[choice.column] ?? null) ?? [];
      for (let i = 0; i < path.length; i += 2) {
        const vertex = path[i];
        if (vertex === undefined) {
          break;
        }
        g.node(JSON.stringify(vertex), identityLabel(vertex));
        const edge = path[i + 1];
        const next = path[i + 2];
        if (edge !== undefined && next !== undefined) {
          g.node(JSON.stringify(next), identityLabel(next));
          g.edge(JSON.stringify(vertex), JSON.stringify(next), identityLabel(edge));
        }
      }
    } else {
      const from = row[choice.from] ?? null;
      const to = row[choice.to] ?? null;
      if (from !== null && to !== null) {
        g.node(from, from);
        g.node(to, to);
        g.edge(from, to, choice.label === null ? "" : (row[choice.label] ?? "NULL"));
      }
    }
  }
  return { nodes: [...g.nodes.values()], edges: g.edges };
}
