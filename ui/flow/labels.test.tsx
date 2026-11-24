import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Edge, Node } from "@xyflow/react";
import { laidOut as modelLaidOut } from "../model/layout";
import { edgesOf, handleId, rowMiddle } from "../model/flowParts";
import { BOX_WIDTH, boxHeight } from "../model/layout";
import type { Model, ModelTable } from "../model/model";
import { GraphView, laidOut as graphLaidOut, NODE_HEIGHT, NODE_WIDTH } from "../results/viewers/GraphView";
import type { Graph } from "../results/viewers/graph";
import type { LabelledData } from "./LabelledEdge";
import {
  along,
  bends,
  control,
  labelSize,
  overlaps,
  placeLabels,
  plate,
  type Point,
  type Rect,
  SPREAD,
} from "./labels";

/** The plates of `edges`' labels placed, of their ends `ends`. */
function plates(edges: readonly Edge[], ends: (e: Edge) => [Point, Point]): Rect[] {
  return edges.flatMap((e) => {
    const data = e.data as LabelledData;
    if (data.at === null) {
      return [];
    }
    const [from, to] = ends(e);
    return [plate(data.label, along(from, control(from, to, data.bend), to, data.at))];
  });
}

/** Whether no two of `rects` overlap, nor any of them one of `boxes`. */
function apart(rects: readonly Rect[], boxes: readonly Rect[]): boolean {
  return rects.every((r, i) => !boxes.some((b) => overlaps(r, b)) && !rects.slice(i + 1).some((o) => overlaps(r, o)));
}

/** A graph of the demo shop's orders and their products, parallel lines among its edges. */
function shop(): Graph {
  const orders = Array.from({ length: 12 }, (_, i) => ({ id: `o${String(i + 1)}`, label: `ORDERS ${String(i + 1)}` }));
  const products = [1, 2, 3].map((n) => ({ id: `p${String(n)}`, label: `PRODUCTS ${String(n)}` }));
  const edges = orders.flatMap((o, i) =>
    [1, 2, 3].map((line) => ({
      id: `${o.id}-${String(line)}`,
      source: o.id,
      target: `p${String(((i + line) % 3) + 1)}`,
      label: `ORDER_LINES ${String(i + 1)}, ${String(line)}`,
    })),
  );
  return { nodes: [...orders, ...products], edges };
}

/** A table `name` of the columns `columns`, its foreign keys `keys`. */
function table(name: string, columns: readonly string[], keys: ModelTable["foreignKeys"] = []): ModelTable {
  return {
    schema: "DEMO",
    name,
    columns: columns.map((c) => ({ name: c, type: "INTEGER", notNull: false, default: null })),
    primaryKey: { name: null, columns: ["ID"] },
    uniques: [],
    checks: [],
    foreignKeys: keys,
    indexes: [],
    position: null,
  };
}

/** A foreign key of `columns` to `to`'s ID. */
function key(columns: readonly string[], to: string): ModelTable["foreignKeys"][number] {
  return {
    name: null,
    columns,
    references: { schema: "DEMO", table: to, columns: ["ID"] },
    onDelete: "NO ACTION",
    onUpdate: "NO ACTION",
  };
}

describe("the labels of a drawing's edges", () => {
  it("are placed along their curves clear of the boxes and of each other, or not at all [DESIGN] D74", () => {
    expect(overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 5, height: 5 })).toBe(false);
    expect(overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 5, height: 5 }, 1)).toBe(true);
    const [from, to] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(along(from, control(from, to, 0), to, 0.5)).toEqual({ x: 50, y: 0 });
    expect(along(from, control(from, to, 10), to, 0.5).y).toBeCloseTo(10);
    expect(control(from, from, 5)).toEqual({ x: 0, y: 0 });
    expect(labelSize("AB").width).toBeGreaterThan(labelSize("A").width);
    const wall = { x: 40, y: -20, width: 20, height: 40 };
    const placed = placeLabels(
      [
        { id: "a", label: "A", from, to, bend: 0 },
        { id: "b", label: "B", from, to, bend: 0 },
        { id: "c", label: "", from, to, bend: 0 },
        { id: "d", label: "X".repeat(40), from, to, bend: 0 },
      ],
      [wall],
    );
    expect(placed.get("a")).toBe(0.2);
    expect(placed.get("b")).toBe(0.8);
    expect(placed.get("c")).toBeNull();
    expect(placed.get("d")).toBeNull();
  });

  it("spread parallel edges apart on one side of their line, whichever way each runs [DESIGN] D74", () => {
    const bent = bends([
      { id: "a", source: "x", target: "y" },
      { id: "b", source: "y", target: "x" },
      { id: "c", source: "x", target: "y" },
      { id: "d", source: "x", target: "z" },
    ]);
    expect([bent.get("a"), bent.get("b"), bent.get("c"), bent.get("d")]).toEqual([-SPREAD, -0, SPREAD, 0]);
  });

  it("of a graph lie on no node and on no other label, parallel edges spread [DESIGN] D74", () => {
    const { nodes, edges, boxes } = graphLaidOut(shop());
    const at = new Map(nodes.map((n: Node) => [n.id, n.position]));
    const ends = (e: Edge): [Point, Point] => {
      const [s, t] = [at.get(e.source) ?? { x: 0, y: 0 }, at.get(e.target) ?? { x: 0, y: 0 }];
      return [
        { x: s.x + NODE_WIDTH, y: s.y + NODE_HEIGHT / 2 },
        { x: t.x, y: t.y + NODE_HEIGHT / 2 },
      ];
    };
    const drawn = plates(edges, ends);
    expect(drawn.length).toBeGreaterThan(0);
    expect(apart(drawn, boxes)).toBe(true);
    const loop = graphLaidOut({
      nodes: [{ id: "n", label: "N" }],
      edges: [{ id: "e", source: "n", target: "n", label: "SELF" }],
    });
    expect((loop.edges[0]?.data as LabelledData).bend).toBe(NODE_HEIGHT);
  });

  it("of an ER diagram run between the columns' sides and lie on no table and on no other label [DESIGN] D74", () => {
    const model: Model = modelLaidOut({
      name: "shop",
      tables: [
        table("CUSTOMERS", ["ID", "NAME", "CITY"]),
        table("PRODUCTS", ["ID", "NAME", "SUPPLIER_ID"], [key(["SUPPLIER_ID"], "SUPPLIERS")]),
        table("SUPPLIERS", ["ID", "NAME"]),
        table("ORDERS", ["ID", "CUSTOMER_ID", "PLACED"], [key(["CUSTOMER_ID"], "CUSTOMERS")]),
        table(
          "ORDER_LINES",
          ["ORDER_ID", "LINE", "PRODUCT_ID"],
          [key(["ORDER_ID"], "ORDERS"), key(["PRODUCT_ID"], "PRODUCTS")],
        ),
      ],
      graphs: [],
    });
    const edges = edgesOf(model, "");
    const byKey = new Map(model.tables.map((t) => [`DEMO.${t.name}`, t]));
    const box = (t: ModelTable): Rect => ({
      ...(t.position ?? { x: 0, y: 0 }),
      width: BOX_WIDTH,
      height: boxHeight(t),
    });
    const ends = (e: Edge): [Point, Point] => {
      const [s, t] = [box(byKey.get(e.source) ?? must()), box(byKey.get(e.target) ?? must())];
      const right = e.sourceHandle?.includes(":r:") === true;
      const row = (h: string | null | undefined, of: ModelTable) =>
        30 + 2 + 20 * of.columns.findIndex((c) => h?.startsWith(`${c.name}:`) === true) + 10;
      return [
        { x: s.x + (right ? BOX_WIDTH : 0), y: s.y + row(e.sourceHandle, byKey.get(e.source) ?? must()) },
        { x: t.x + (right ? 0 : BOX_WIDTH), y: t.y + row(e.targetHandle, byKey.get(e.target) ?? must()) },
      ];
    };
    const drawn = plates(edges, ends);
    expect(drawn).toHaveLength(edges.length);
    expect(apart(drawn, model.tables.map(box))).toBe(true);
    const orders = edges.find((e) => e.source === "DEMO.ORDERS");
    expect([orders?.sourceHandle, orders?.targetHandle]).toEqual(["CUSTOMER_ID:r:s", "ID:l:t"]);
  });

  it("of a graph too crowded show on hover, or all by Show every label [DESIGN] D74", () => {
    render(<GraphView graph={shop()} />);
    const toggle = screen.getByRole("checkbox", { name: /^Show every label \(\d+ shown on hover alone/u });
    const shown = () => document.querySelectorAll(".flow-label").length;
    const before = shown();
    fireEvent.click(toggle);
    expect(shown()).toBeGreaterThanOrEqual(before);
    cleanup();
    render(
      <GraphView
        graph={{
          nodes: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
          edges: [{ id: "e", source: "a", target: "b", label: "E" }],
        }}
      />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("of an ER diagram run from the left side where the referenced table lies to the left, a table's header where no column is named [DESIGN] D74", () => {
    const left = { ...table("CUSTOMERS", ["ID"]), position: { x: 0, y: 0 } };
    const right = {
      ...table("ORDERS", ["ID", "CUSTOMER_ID"], [key(["CUSTOMER_ID"], "CUSTOMERS")]),
      position: { x: 600, y: 0 },
    };
    const edges = edgesOf({ name: "m", tables: [right, left], graphs: [] }, "");
    expect([edges[0]?.sourceHandle, edges[0]?.targetHandle]).toEqual(["CUSTOMER_ID:l:s", "ID:r:t"]);
    expect(rowMiddle(left, "NOPE")).toBe(rowMiddle(left, null));
    expect(rowMiddle(right, "CUSTOMER_ID")).toBeGreaterThan(rowMiddle(right, "ID"));
    expect(handleId(null, "r", "s")).toBe("table:r:s");
    const unplaced = { ...table("ORDERS", ["ID", "CUSTOMER_ID"], [key(["CUSTOMER_ID"], "CUSTOMERS")]) };
    expect(edgesOf({ name: "m", tables: [unplaced, table("CUSTOMERS", ["ID"])], graphs: [] }, "")).toHaveLength(1);
  });
});

/** A table never missing, for the types. */
function must(): never {
  throw new Error("no such table");
}
