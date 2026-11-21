/**
 * Spatial values drawn on a plane (RULES.md D39): each value's points,
 * lines and polygons, x to the east and y to the north, scaled to fit,
 * the box's corners labelled by their coordinates. Nothing is drawn under
 * them: a map's tiles would be remote content, which Studio never loads
 * (R-SEC-4).
 */
import { bounds, type Shape } from "./wkt";

/** A value drawn: its shapes, and whether it is the one selected. */
export interface Drawn {
  readonly shapes: readonly Shape[];
  readonly selected: boolean;
}

/** The pixels of the drawing's side. */
const SIDE = 320;
/** The share of the box left round the shapes. */
const MARGIN = 0.08;

/** A coordinate as a corner's label: at most six significant digits. */
export function coordinate(n: number): string {
  return Number(n.toPrecision(6)).toString();
}

/** The SVG path of the points `points`, closed if `closed`. */
function pathOf(points: readonly (readonly [number, number])[], closed: boolean): string {
  const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${String(x)} ${String(-y)}`).join(" ");
  return closed ? `${d} Z` : d;
}

/** One shape, drawn. */
function ShapeDrawn({ shape, selected, unit }: { shape: Shape; selected: boolean; unit: number }) {
  const className = selected ? "plane-shape plane-selected" : "plane-shape";
  switch (shape.kind) {
    case "point":
      return <circle className={className} cx={shape.at[0]} cy={-shape.at[1]} r={unit * 4} />;
    case "line":
      return <path className={className} d={pathOf(shape.points, false)} fill="none" />;
    case "polygon":
      return (
        <path
          className={`${className} plane-area`}
          d={shape.rings.map((r) => pathOf(r, true)).join(" ")}
          fillRule="evenodd"
        />
      );
  }
}

/** Values drawn on a plane; their box's corners labelled. */
export function PlaneView({ drawn }: { readonly drawn: readonly Drawn[] }) {
  const box = bounds(drawn.flatMap((d) => d.shapes));
  if (box === null) {
    return <p className="hint">Nothing to draw: the values are empty.</p>;
  }
  const width = Math.max(box.maxX - box.minX, 1e-9);
  const height = Math.max(box.maxY - box.minY, 1e-9);
  const side = Math.max(width, height);
  const pad = side * MARGIN;
  const unit = (side + pad * 2) / SIDE;
  const viewBox = [box.minX - pad, -box.maxY - pad, width + pad * 2, height + pad * 2].map(String).join(" ");
  const shapes = drawn.reduce((n, d) => n + d.shapes.length, 0);
  return (
    <figure className="plane">
      <svg
        role="img"
        aria-label={`${String(drawn.length)} values, ${String(shapes)} shapes, drawn on a plane`}
        viewBox={viewBox}
        width={SIDE}
        height={SIDE}
        preserveAspectRatio="xMidYMid meet"
        style={{ strokeWidth: unit * 1.5 }}
      >
        {drawn.map((d, i) =>
          d.shapes.map((shape, j) => (
            <ShapeDrawn key={`${String(i)}.${String(j)}`} shape={shape} selected={d.selected} unit={unit} />
          )),
        )}
      </svg>
      <figcaption className="hint">
        x {coordinate(box.minX)} to {coordinate(box.maxX)}, y {coordinate(box.minY)} to {coordinate(box.maxY)}
      </figcaption>
    </figure>
  );
}
