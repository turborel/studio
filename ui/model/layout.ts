/**
 * A model's diagram laid out (RULES.md D46): each table a box as tall as
 * its columns, placed by dagre from left to right along its foreign keys;
 * a table already placed kept where it is.
 */
import dagre from "@dagrejs/dagre";
import { type Model, type ModelTable, tableKey } from "./model";

/** A table's box's width, and the heights of its header and of each column, in pixels. */
export const BOX_WIDTH = 240;
export const HEADER_HEIGHT = 30;
export const ROW_HEIGHT = 20;

/** The height of `t`'s box. */
export function boxHeight(t: ModelTable): number {
  return HEADER_HEIGHT + ROW_HEIGHT * Math.max(1, t.columns.length) + 8;
}

/** Where each table of `model` is drawn: where it was placed, else where dagre lays it, of all or only those not placed. */
export function laidOut(model: Model, again = false): Model {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const t of model.tables) {
    g.setNode(tableKey(t), { width: BOX_WIDTH, height: boxHeight(t) });
  }
  for (const t of model.tables) {
    for (const f of t.foreignKeys) {
      const to = tableKey(f.references);
      if (g.hasNode(to) && to !== tableKey(t)) {
        g.setEdge(tableKey(t), to);
      }
    }
  }
  dagre.layout(g);
  return {
    ...model,
    tables: model.tables.map((t) => {
      if (t.position !== null && !again) {
        return t;
      }
      const at = g.node(tableKey(t)) as { x: number; y: number };
      return { ...t, position: { x: Math.round(at.x - BOX_WIDTH / 2), y: Math.round(at.y - boxHeight(t) / 2) } };
    }),
  };
}
