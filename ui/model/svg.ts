/**
 * A model's diagram as SVG (RULES.md D46), to be saved as a file or made
 * an image of: each table a box of its name and its columns, each with
 * its type and marks of its key and NOT NULL, and each foreign key a line
 * from its table to the one it references.
 */
import { BOX_WIDTH, boxHeight, HEADER_HEIGHT, ROW_HEIGHT } from "./layout";
import { type Model, type ModelTable, tableKey } from "./model";

/** The margin round the drawing, in pixels. */
const MARGIN = 20;

/** `text` safe within XML. */
export function xmlText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** Where `t` is drawn. */
function at(t: ModelTable): { x: number; y: number } {
  return t.position ?? { x: 0, y: 0 };
}

/** The marks of column `name` of `t`: PK of its primary key, FK of a foreign key, NN of NOT NULL. */
export function columnMarks(t: ModelTable, name: string): string {
  const marks = [
    t.primaryKey?.columns.includes(name) === true ? "PK" : "",
    t.foreignKeys.some((f) => f.columns.includes(name)) ? "FK" : "",
    t.columns.find((c) => c.name === name)?.notNull === true ? "NN" : "",
  ];
  return marks.filter((m) => m !== "").join(" ");
}

/** `t` as SVG. */
function tableSvg(t: ModelTable): string {
  const { x, y } = at(t);
  const rows = t.columns.map((c, i) => {
    const line = y + HEADER_HEIGHT + ROW_HEIGHT * (i + 1) - 6;
    const marks = columnMarks(t, c.name);
    return (
      `<text x="${String(x + 8)}" y="${String(line)}" class="column">${xmlText(c.name)}</text>` +
      `<text x="${String(x + BOX_WIDTH - 8)}" y="${String(line)}" class="type" text-anchor="end">${xmlText(`${c.type}${marks === "" ? "" : ` ${marks}`}`)}</text>`
    );
  });
  return (
    `<g class="table"><rect x="${String(x)}" y="${String(y)}" width="${String(BOX_WIDTH)}" height="${String(boxHeight(t))}" rx="4"/>` +
    `<rect x="${String(x)}" y="${String(y)}" width="${String(BOX_WIDTH)}" height="${String(HEADER_HEIGHT)}" rx="4" class="header"/>` +
    `<text x="${String(x + 8)}" y="${String(y + 20)}" class="name">${xmlText(tableKey(t))}</text>${rows.join("")}</g>`
  );
}

/** The foreign keys of `model` as lines, from each table's right to the middle of the one it references. */
function edgesSvg(model: Model): string {
  const placed = new Map(model.tables.map((t) => [tableKey(t), t]));
  return model.tables
    .flatMap((t) =>
      t.foreignKeys.flatMap((f) => {
        const to = placed.get(tableKey(f.references));
        if (to === undefined) {
          return [];
        }
        const from = at(t);
        const end = at(to);
        const x1 = from.x + BOX_WIDTH;
        const y1 = from.y + HEADER_HEIGHT / 2;
        return [
          `<line x1="${String(x1)}" y1="${String(y1)}" x2="${String(end.x)}" y2="${String(end.y + HEADER_HEIGHT / 2)}" marker-end="url(#arrow)"><title>${xmlText(`${f.name ?? ""} (${f.columns.join(", ")})`)}</title></line>`,
        ];
      }),
    )
    .join("");
}

/** `model`'s diagram as an SVG document, its tables placed. */
export function modelSvg(model: Model): string {
  const right = Math.max(0, ...model.tables.map((t) => at(t).x + BOX_WIDTH));
  const bottom = Math.max(0, ...model.tables.map((t) => at(t).y + boxHeight(t)));
  const left = Math.min(0, ...model.tables.map((t) => at(t).x));
  const top = Math.min(0, ...model.tables.map((t) => at(t).y));
  const width = right - left + MARGIN * 2;
  const height = bottom - top + MARGIN * 2;
  const style =
    "rect{fill:#ffffff;stroke:#5c5254}rect.header{fill:#ece8e8}text{font:12px sans-serif;fill:#1b1415}" +
    "text.name{font-weight:600}text.type{fill:#5c5254}line{stroke:#A74C2E;stroke-width:1.5}";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="${String(left - MARGIN)} ${String(top - MARGIN)} ${String(width)} ${String(height)}">` +
    `<style>${style}</style><defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#A74C2E"/></marker></defs>` +
    `${edgesSvg(model)}${model.tables.map(tableSvg).join("")}</svg>\n`
  );
}
