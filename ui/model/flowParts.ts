/**
 * A model as React Flow draws it (RULES.md D15, D46): each table shown a
 * node, of its columns; each foreign key an edge, labelled by its columns
 * and rules; each property graph's edge table an edge to each of its
 * vertex tables, dashed; and, grouped, a box of each schema behind its
 * tables.
 */
import type { Edge, Node } from "@xyflow/react";
import { BOX_WIDTH, boxHeight } from "./layout";
import { type Model, type ModelTable, tableKey } from "./model";

/** The margin of a schema's box round its tables, in pixels. */
const GROUP_MARGIN = 24;

/** Whether `t` is shown of the filter `filter`: its schema and name hold it, in any case. */
export function shown(t: ModelTable, filter: string): boolean {
  return tableKey(t).toUpperCase().includes(filter.trim().toUpperCase());
}

/** The data of a table's node. */
export interface TableData extends Record<string, unknown> {
  readonly table: ModelTable;
  readonly selected: boolean;
}

/** The nodes of `model`'s tables shown, and, `grouped`, a box of each schema behind them. */
export function nodesOf(
  model: Model,
  { filter, grouped, selected }: { filter: string; grouped: boolean; selected: string | null },
): Node[] {
  const tables = model.tables.filter((t) => shown(t, filter));
  const nodes: Node[] = tables.map((t) => ({
    id: tableKey(t),
    type: "table",
    position: t.position ?? { x: 0, y: 0 },
    data: { table: t, selected: tableKey(t) === selected } satisfies TableData,
    width: BOX_WIDTH,
    height: boxHeight(t),
  }));
  if (!grouped) {
    return nodes;
  }
  const schemas = [...new Set(tables.map((t) => t.schema))];
  const boxes: Node[] = schemas.map((schema) => {
    const of = tables.filter((t) => t.schema === schema);
    const left = Math.min(...of.map((t) => t.position?.x ?? 0)) - GROUP_MARGIN;
    const top = Math.min(...of.map((t) => t.position?.y ?? 0)) - GROUP_MARGIN * 2;
    const right = Math.max(...of.map((t) => (t.position?.x ?? 0) + BOX_WIDTH)) + GROUP_MARGIN;
    const bottom = Math.max(...of.map((t) => (t.position?.y ?? 0) + boxHeight(t))) + GROUP_MARGIN;
    return {
      id: `schema:${schema}`,
      type: "schema",
      position: { x: left, y: top },
      data: { schema },
      width: right - left,
      height: bottom - top,
      draggable: false,
      selectable: false,
      zIndex: -1,
    };
  });
  return [...boxes, ...nodes];
}

/** The edges of `model`'s foreign keys and property graphs, between the tables shown. */
export function edgesOf(model: Model, filter: string): Edge[] {
  const ids = new Set(model.tables.filter((t) => shown(t, filter)).map(tableKey));
  const keys: Edge[] = model.tables.flatMap((t) =>
    t.foreignKeys
      .filter((f) => ids.has(tableKey(t)) && ids.has(tableKey(f.references)))
      .map((f, i) => ({
        id: `fk:${tableKey(t)}:${String(i)}`,
        source: tableKey(t),
        target: tableKey(f.references),
        label: `${f.columns.join(", ")} → ${f.references.columns.join(", ")}${f.onDelete === "NO ACTION" ? "" : `, ON DELETE ${f.onDelete}`}`,
        className: "model-key",
      })),
  );
  const graphs: Edge[] = model.graphs.flatMap((g) => {
    const tableOf = new Map(g.elements.map((e) => [e.alias, `${e.schema ?? ""}.${e.table ?? ""}`]));
    return g.elements.flatMap((e) =>
      e.ends.flatMap((end) => {
        const source = tableOf.get(e.alias) ?? "";
        const target = tableOf.get(end.vertex) ?? "";
        return ids.has(source) && ids.has(target)
          ? [
              {
                id: `graph:${g.name}:${e.alias}:${end.end}`,
                source,
                target,
                label: `${g.name} ${end.end}`,
                className: "model-graph",
                animated: false,
                style: { strokeDasharray: "6 4" },
              },
            ]
          : [];
      }),
    );
  });
  return [...keys, ...graphs];
}
