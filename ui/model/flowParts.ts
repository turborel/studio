/**
 * A model as React Flow draws it (RULES.md D15, D46): each table shown a
 * node, of its columns; each foreign key an edge from its first column's
 * side to its referenced column's, labelled by its columns and rules on a
 * plate clear of the boxes (D74); each property graph's edge table an
 * edge to each of its vertex tables, dashed; and, grouped, a box of each
 * schema behind its tables.
 */
import { type Edge, MarkerType, type Node } from "@xyflow/react";
import { bends, placeLabels } from "../flow/labels";
import type { LabelledData } from "../flow/LabelledEdge";
import { BOX_WIDTH, boxHeight, HEADER_HEIGHT, ROW_HEIGHT } from "./layout";
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

/** The top of a table's columns' list below its header, in pixels: the list's padding. */
const LIST_TOP = 2;

/** The id of the handle of column `column`, or of the table for none, on side `side`, of `kind`. */
export function handleId(column: string | null, side: "l" | "r", kind: "s" | "t"): string {
  return `${column ?? "table"}:${side}:${kind}`;
}

/** How far down `t`'s box its column `column` is, or its header for none, in pixels. */
export function rowMiddle(t: ModelTable, column: string | null): number {
  const at = column === null ? -1 : t.columns.findIndex((c) => c.name === column);
  return at < 0 ? HEADER_HEIGHT / 2 : HEADER_HEIGHT + LIST_TOP + ROW_HEIGHT * at + ROW_HEIGHT / 2;
}

/** An edge between two tables' columns to be drawn: its ids, ends, sides and label. */
interface Link {
  readonly id: string;
  readonly from: ModelTable;
  readonly to: ModelTable;
  readonly fromColumn: string | null;
  readonly toColumn: string | null;
  readonly label: string;
  readonly className: string;
  readonly dashed: boolean;
}

/** The edges of `links`: each from the side of its source facing its target to the side of its target facing back, its label placed clear of `tables`' boxes. */
function drawnLinks(links: readonly Link[], tables: readonly ModelTable[]): Edge[] {
  const box = (t: ModelTable) => ({ ...(t.position ?? { x: 0, y: 0 }), width: BOX_WIDTH, height: boxHeight(t) });
  const sided = links.map((l) => {
    const [a, b] = [box(l.from), box(l.to)];
    const rightward = b.x + BOX_WIDTH / 2 >= a.x + BOX_WIDTH / 2;
    const from = { x: a.x + (rightward ? BOX_WIDTH : 0), y: a.y + rowMiddle(l.from, l.fromColumn) };
    const to = { x: b.x + (rightward ? 0 : BOX_WIDTH), y: b.y + rowMiddle(l.to, l.toColumn) };
    return { link: l, rightward, from, to };
  });
  const bent = bends(links.map((l) => ({ id: l.id, source: tableKey(l.from), target: tableKey(l.to) })));
  const placed = placeLabels(
    sided.map(({ link, from, to }) => ({ id: link.id, label: link.label, from, to, bend: bent.get(link.id) ?? 0 })),
    tables.map(box),
  );
  return sided.map(({ link, rightward }) => ({
    id: link.id,
    source: tableKey(link.from),
    target: tableKey(link.to),
    sourceHandle: handleId(link.fromColumn, rightward ? "r" : "l", "s"),
    targetHandle: handleId(link.toColumn, rightward ? "l" : "r", "t"),
    label: link.label,
    className: link.className,
    type: "labelled",
    markerEnd: { type: MarkerType.ArrowClosed },
    data: {
      label: link.label,
      bend: bent.get(link.id) ?? 0,
      at: placed.get(link.id) ?? null,
      dashed: link.dashed,
    } satisfies LabelledData,
  }));
}

/** The edges of `model`'s foreign keys and property graphs, between the tables shown. */
export function edgesOf(model: Model, filter: string): Edge[] {
  const tables = model.tables.filter((t) => shown(t, filter));
  const byKey = new Map(tables.map((t) => [tableKey(t), t]));
  const keys: Link[] = tables.flatMap((t) =>
    t.foreignKeys.flatMap((f, i) => {
      const to = byKey.get(tableKey(f.references));
      return to === undefined
        ? []
        : [
            {
              id: `fk:${tableKey(t)}:${String(i)}`,
              from: t,
              to,
              fromColumn: f.columns[0] ?? null,
              toColumn: f.references.columns[0] ?? null,
              label: `${f.columns.join(", ")} → ${f.references.columns.join(", ")}${f.onDelete === "NO ACTION" ? "" : `, ON DELETE ${f.onDelete}`}`,
              className: "model-key",
              dashed: false,
            },
          ];
    }),
  );
  const graphs: Link[] = model.graphs.flatMap((g) => {
    const tableOf = new Map(g.elements.map((e) => [e.alias, `${e.schema ?? ""}.${e.table ?? ""}`]));
    return g.elements.flatMap((e) =>
      e.ends.flatMap((end) => {
        const from = byKey.get(tableOf.get(e.alias) ?? "");
        const to = byKey.get(tableOf.get(end.vertex) ?? "");
        return from !== undefined && to !== undefined
          ? [
              {
                id: `graph:${g.name}:${e.alias}:${end.end}`,
                from,
                to,
                fromColumn: null,
                toColumn: null,
                label: `${g.name} ${end.end}`,
                className: "model-graph",
                dashed: true,
              },
            ]
          : [];
      }),
    );
  });
  return drawnLinks([...keys, ...graphs], tables);
}
