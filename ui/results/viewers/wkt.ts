/**
 * Spatial values for the plane viewer (RULES.md D39): a geometry's
 * well-known text, as Turborel writes one, read into the points, lines
 * and polygons drawn of it. A curve is drawn through the points it is
 * written by.
 */

/** A point of the plane. */
export type Point = readonly [number, number];

/** What is drawn of a geometry. */
export type Shape =
  | { readonly kind: "point"; readonly at: Point }
  | { readonly kind: "line"; readonly points: readonly Point[] }
  | { readonly kind: "polygon"; readonly rings: readonly (readonly Point[])[] };

/** A list of WKT, or a coordinate, or a geometry within a collection. */
type Item =
  | { readonly kind: "coordinate"; readonly at: Point }
  | { readonly kind: "list"; readonly items: readonly Item[] }
  | { readonly kind: "geometry"; readonly geometry: Geometry };

/** A geometry: its tag's words and its list, none if it is EMPTY. */
interface Geometry {
  readonly tag: string;
  readonly list: Item | null;
}

/** WKT's tokens. */
function tokenize(text: string): string[] | null {
  const tokens = text.match(/[A-Za-z_]+|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[(),]|\S/gu) ?? [];
  return tokens.every((t) => /^(?:[A-Za-z_]+|[-+]?[\d.].*|[(),])$/u.test(t)) ? tokens : null;
}

/** A reader of WKT's tokens. */
class Reader {
  private at = 0;

  /** A reader of `tokens`. */
  constructor(private readonly tokens: readonly string[]) {}

  /** The next token, not taken. */
  peek(): string | undefined {
    return this.tokens[this.at];
  }

  /** The next token, taken. */
  take(): string | undefined {
    const token = this.tokens[this.at];
    this.at += 1;
    return token;
  }

  /** Whether every token is read. */
  done(): boolean {
    return this.at >= this.tokens.length;
  }
}

/** Whether `token` is a word. */
function isWord(token: string | undefined): token is string {
  return token !== undefined && /^[A-Za-z_]+$/u.test(token);
}

/** A geometry of `r`: its tag's words, then EMPTY or its list. */
function geometry(r: Reader): Geometry | null {
  const words: string[] = [];
  while (isWord(r.peek()) && r.peek()?.toUpperCase() !== "EMPTY") {
    words.push(r.take()?.toUpperCase() ?? "");
  }
  if (words.length === 0) {
    return null;
  }
  if (r.peek()?.toUpperCase() === "EMPTY") {
    r.take();
    return { tag: words.join(" "), list: null };
  }
  const items = list(r);
  return items === null ? null : { tag: words.join(" "), list: items };
}

/** A list of `r`, in parentheses, of items between commas. */
function list(r: Reader): Item | null {
  if (r.take() !== "(") {
    return null;
  }
  const items: Item[] = [];
  for (;;) {
    const one = item(r);
    if (one === null) {
      return null;
    }
    items.push(one);
    const next = r.take();
    if (next === ")") {
      return { kind: "list", items };
    }
    if (next !== ",") {
      return null;
    }
  }
}

/** An item of `r`: a list, a geometry of a collection, or a coordinate's numbers. */
function item(r: Reader): Item | null {
  const next = r.peek();
  if (next === "(") {
    return list(r);
  }
  if (isWord(next)) {
    const g = geometry(r);
    return g === null ? null : { kind: "geometry", geometry: g };
  }
  const numbers: number[] = [];
  while (r.peek() !== undefined && !["(", ")", ","].includes(r.peek() ?? "") && !isWord(r.peek())) {
    numbers.push(Number(r.take()));
  }
  const [x, y] = numbers;
  return x === undefined || y === undefined || numbers.some(Number.isNaN) ? null : { kind: "coordinate", at: [x, y] };
}

/** The coordinates directly in `item`, a list. */
function coordinates(item: Item): Point[] {
  return item.kind === "list" ? item.items.flatMap((i) => (i.kind === "coordinate" ? [i.at] : [])) : [];
}

/** The lists of coordinates deepest in `item`. */
function innermost(item: Item): Point[][] {
  if (item.kind !== "list") {
    return item.kind === "coordinate" ? [[item.at]] : [];
  }
  if (item.items.every((i) => i.kind === "coordinate")) {
    return [coordinates(item)];
  }
  return item.items.flatMap((i) => (i.kind === "geometry" ? shapesOf(i.geometry).flatMap(pointsOf) : innermost(i)));
}

/** The points of `shape`, as lists. */
function pointsOf(shape: Shape): Point[][] {
  switch (shape.kind) {
    case "point":
      return [[shape.at]];
    case "line":
      return [[...shape.points]];
    case "polygon":
      return shape.rings.map((r) => [...r]);
  }
}

/** Whether `item` is a ring: a list of coordinates, or a curve, as a curve polygon's ring is. */
function isRing(item: Item): boolean {
  if (item.kind === "geometry") {
    return !/POLYGON|SURFACE|SOLID|TIN|TRIANGLE/u.test(item.geometry.tag);
  }
  return item.kind === "list" && item.items.every((c) => c.kind === "coordinate");
}

/** The points of ring `item`. */
function ringOf(item: Item): Point[] {
  return item.kind === "geometry" ? shapesOf(item.geometry).flatMap(pointsOf).flat() : coordinates(item);
}

/** The polygons of `item`: each list whose items are rings, its rings. */
function polygons(item: Item): Shape[] {
  if (item.kind !== "list") {
    return item.kind === "geometry" ? shapesOf(item.geometry) : [];
  }
  if (item.items.every(isRing)) {
    return [{ kind: "polygon", rings: item.items.map(ringOf) }];
  }
  return item.items.flatMap(polygons);
}

/** What is drawn of `g`. */
function shapesOf(g: Geometry): Shape[] {
  const items = g.list;
  if (items === null) {
    return [];
  }
  if (g.tag.startsWith("GEOMETRYCOLLECTION") && items.kind === "list") {
    return items.items.flatMap((i) => (i.kind === "geometry" ? shapesOf(i.geometry) : []));
  }
  if (g.tag.includes("POINT")) {
    return innermost(items).flatMap((points) => points.map((at) => ({ kind: "point" as const, at })));
  }
  if (/POLYGON|TRIANGLE|TIN|SURFACE|SOLID/u.test(g.tag)) {
    return polygons(items);
  }
  return innermost(items).map((points) => ({ kind: "line" as const, points }));
}

/** The shapes of `text`, a geometry's well-known text: null if it is none. */
export function parseWkt(text: string): Shape[] | null {
  const tokens = tokenize(text);
  if (tokens === null) {
    return null;
  }
  const r = new Reader(tokens);
  const g = geometry(r);
  return g === null || !r.done() ? null : shapesOf(g);
}

/** The box of `shapes`: its least and greatest x and y; null of none. */
export function bounds(shapes: readonly Shape[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const points = shapes.flatMap(pointsOf).flat();
  if (points.length === 0) {
    return null;
  }
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}
