/**
 * The labels of a drawing's edges placed (RULES.md D74): each edge a
 * curve, bent apart from the others between the same two ends so
 * parallel edges spread, and its label set on a plate at the first place
 * along it, from its middle out, that overlaps no box and no label placed
 * before it; a label with no such place is not drawn, and is shown on
 * hover of its edge.
 */

/** A point. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A rectangle: its top left, width and height. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** An edge to place a label of: its ends, its bend, and its label. */
export interface Placing {
  readonly id: string;
  readonly label: string;
  readonly from: Point;
  readonly to: Point;
  /** How far its curve's middle stands off the straight line, in pixels, to its left. */
  readonly bend: number;
}

/** The space kept between a label and what it must not touch, in pixels. */
export const LABEL_GAP = 4;
/** A label's height, and the width of each of its characters and of its plate's padding, in pixels. */
const LABEL_HEIGHT = 16;
const CHAR_WIDTH = 6.6;
const PADDING = 10;
/** How far apart the curves of parallel edges stand at their middles, in pixels. */
export const SPREAD = 26;
/** Where along an edge a label is tried, its middle first. */
export const TRIED = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8] as const;

/** The size of `label`'s plate. */
export function labelSize(label: string): { width: number; height: number } {
  return { width: Array.from(label).length * CHAR_WIDTH + PADDING, height: LABEL_HEIGHT };
}

/** Whether `a` and `b` overlap, or come within `gap` of each other. */
export function overlaps(a: Rect, b: Rect, gap = 0): boolean {
  return (
    a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap
  );
}

/** The control point of a curve from `from` to `to` whose middle stands `bend` off their line, to its left. */
export function control(from: Point, to: Point, bend: number): Point {
  const [dx, dy] = [to.x - from.x, to.y - from.y];
  const length = Math.hypot(dx, dy) || 1;
  // The quadratic curve's middle is half way to its control point from the chord's.
  return { x: (from.x + to.x) / 2 - (dy / length) * bend * 2, y: (from.y + to.y) / 2 + (dx / length) * bend * 2 };
}

/** The point at `t`, from 0 to 1, of the quadratic curve from `from` by `by` to `to`. */
export function along(from: Point, by: Point, to: Point, t: number): Point {
  const u = 1 - t;
  return { x: u * u * from.x + 2 * u * t * by.x + t * t * to.x, y: u * u * from.y + 2 * u * t * by.y + t * t * to.y };
}

/** The plate of `label` centred at `at`. */
export function plate(label: string, at: Point): Rect {
  const { width, height } = labelSize(label);
  return { x: at.x - width / 2, y: at.y - height / 2, width, height };
}

/** The bend of each of `edges`, by its id: those between the same two ends spread apart about their line. */
export function bends(edges: readonly { id: string; source: string; target: string }[]): Map<string, number> {
  const pairs = new Map<string, string[]>();
  for (const e of edges) {
    const key = [e.source, e.target].sort().join("\u0000");
    pairs.set(key, [...(pairs.get(key) ?? []), e.id]);
  }
  const bent = new Map<string, number>();
  for (const [key, ids] of pairs) {
    const reversed = (e: string) => edges.find((x) => x.id === e)?.source !== key.split("\u0000")[0];
    ids.forEach((id, k) => {
      const offset = (k - (ids.length - 1) / 2) * SPREAD;
      // The same side of the pair's line whichever way an edge runs, so none crosses another.
      bent.set(id, reversed(id) ? -offset : offset);
    });
  }
  return bent;
}

/** Where along each of `edges` its label is drawn, from 0 to 1, by its id; null where no place clears `boxes` and the labels before it. */
export function placeLabels(edges: readonly Placing[], boxes: readonly Rect[]): Map<string, number | null> {
  const placed: Rect[] = [];
  const at = new Map<string, number | null>();
  for (const e of edges) {
    const by = control(e.from, e.to, e.bend);
    const t = TRIED.find((tried) => {
      const rect = plate(e.label, along(e.from, by, e.to, tried));
      return !boxes.some((b) => overlaps(rect, b, LABEL_GAP)) && !placed.some((p) => overlaps(rect, p, LABEL_GAP));
    });
    if (t === undefined || e.label === "") {
      at.set(e.id, null);
      continue;
    }
    placed.push(plate(e.label, along(e.from, by, e.to, t)));
    at.set(e.id, t);
  }
  return at;
}
