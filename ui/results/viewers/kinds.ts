/**
 * Which viewers show a value (RULES.md D39): by its column's declared
 * type first, then by what its text is: JSON, XML, a geometry's
 * well-known text, a vector, a graph's path, or octets that are an image.
 */
import type { ColumnInfo } from "../../ipc/connections";
import { typeKind } from "../literals";
import { imageType } from "./bytes";
import { pathOf } from "./graph";
import { parseJson } from "./structured";
import { parseVector } from "./vector";
import { parseWkt } from "./wkt";

/** A viewer of a value. */
export type ViewKind = "text" | "json" | "xml" | "hex" | "image" | "plane" | "vector" | "path";

/** Each viewer's name. */
export const VIEW_NAMES: Readonly<Record<ViewKind, string>> = {
  text: "Text",
  json: "JSON",
  xml: "XML",
  hex: "Hex",
  image: "Image",
  plane: "Plane",
  vector: "Vector",
  path: "Path",
};

/** Whether `column`'s type is spatial: GEOMETRY or one of the ST_ types. */
export function spatialType(column: ColumnInfo): boolean {
  return /^(?:GEOMETRY|GEOGRAPHY|ST_)/iu.test(column.typeWritten.trim());
}

/** Whether `column`'s type is a vector's. */
function vectorType(column: ColumnInfo): boolean {
  return /^VECTOR\b/iu.test(column.typeWritten.trim());
}

/** Each viewer of text, in turn, and whether it shows a value of a column, by its type written and its text. */
const TEXT_VIEWS: readonly (readonly [ViewKind, (column: ColumnInfo, written: string, text: string) => boolean])[] = [
  ["plane", (column, _, text) => spatialType(column) || (typeKind(column) !== "binary" && parseWkt(text) !== null)],
  [
    "vector",
    (column, written, text) =>
      vectorType(column) || (written !== "JSON" && /^\[[-+\d.eE, ]*\]$/u.test(text) && parseVector(text) !== null),
  ],
  ["path", (_, __, text) => pathOf(text) !== null],
  ["json", (_, written, text) => written === "JSON" || (/^[[{]/u.test(text.trim()) && parseJson(text).ok)],
  ["xml", (_, written, text) => written === "XML" || /^<[\s\S]*>$/u.test(text.trim())],
];

/** The viewers of a value of `column`, its text `text` or its octets `bytes`: the one it is best seen by first. */
export function viewKinds(column: ColumnInfo, text: string | null, bytes: Uint8Array | null): ViewKind[] {
  if (bytes !== null) {
    return imageType(bytes) === null ? ["hex"] : ["image", "hex"];
  }
  if (text === null) {
    return ["text"];
  }
  const written = column.typeWritten.trim().toUpperCase();
  return [...TEXT_VIEWS.filter(([, shows]) => shows(column, written, text)).map(([kind]) => kind), "text"];
}
