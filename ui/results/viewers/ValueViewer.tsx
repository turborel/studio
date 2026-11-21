/**
 * The viewer of a cell's value (RULES.md D39): its text, wrapped or not;
 * JSON as a tree; XML laid out; octets as a dump or an image; a geometry
 * on a plane; a vector's elements and figures; a graph's path. A large
 * object not sent whole is read whole first, as far as Studio reads one.
 */
import { type ReactNode, useEffect, useState } from "react";
import type { Cell, ColumnInfo } from "../../ipc/connections";
import { resultValue, type ValueRead } from "../../ipc/results";
import { typeKind } from "../literals";
import { fromBase64, fromHex, hexDump, imageType, toBase64 } from "./bytes";
import { graphOf } from "./graph";
import { GraphView } from "./GraphView";
import { type ViewKind, VIEW_NAMES, viewKinds } from "./kinds";
import { PlaneView } from "./PlaneView";
import { parseJson, prettyXml } from "./structured";
import { figures, parseVector } from "./vector";
import { parseWkt } from "./wkt";

/** The value a viewer shows: its cell, its column, and where to read it whole if it came by its locator. */
export interface Viewed {
  readonly cell: Cell;
  readonly column: ColumnInfo;
  /** Its result and place, if it is a large object not sent whole. */
  readonly locator: { connection: number; result: number; row: number; column: number } | null;
}

/** A value, as far as it is read: its text or octets, whether it was cut, or why it could not be read. */
type Read =
  | { readonly kind: "reading" }
  | { readonly kind: "text"; readonly text: string | null; readonly cut: boolean }
  | { readonly kind: "bytes"; readonly bytes: Uint8Array; readonly cut: boolean }
  | { readonly kind: "failed"; readonly why: string };

/** What a value read whole gives. */
function fromRead(read: ValueRead): Read {
  return read.kind === "text"
    ? { kind: "text", text: read.text, cut: read.cut }
    : { kind: "bytes", bytes: fromBase64(read.base64), cut: read.cut };
}

/** The value of `viewed` as it came in its row: octets of a binary string, else its text. */
function inRow(viewed: Viewed): Read {
  if (viewed.cell !== null && typeKind(viewed.column) === "binary") {
    const bytes = fromHex(viewed.cell);
    if (bytes !== null) {
      return { kind: "bytes", bytes, cut: false };
    }
  }
  return { kind: "text", text: viewed.cell, cut: false };
}

/** The value of `viewed`, read whole if it must be; a viewer of another value is made anew, so it reads that one. */
function useRead(viewed: Viewed): Read {
  const [read, setRead] = useState<Read>(viewed.locator === null ? inRow(viewed) : { kind: "reading" });
  useEffect(() => {
    let current = true;
    const at = viewed.locator;
    if (at !== null) {
      resultValue(at.connection, at.result, at.row, at.column).then(
        (value) => {
          if (current) {
            setRead(fromRead(value));
          }
        },
        (thrown: unknown) => {
          if (current) {
            setRead({ kind: "failed", why: whyOf(thrown) });
          }
        },
      );
    }
    return () => {
      current = false;
    };
  }, [viewed]);
  return read;
}

/** What a failure says. */
function whyOf(thrown: unknown): string {
  return typeof thrown === "object" && thrown !== null && "message" in thrown ? String(thrown.message) : String(thrown);
}

/** A JSON value as a tree, each object and array opened and closed. */
export function JsonTree({ value, name }: { readonly value: unknown; readonly name?: string }) {
  const label = name === undefined ? null : <span className="json-key">{name}: </span>;
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    const entries: (readonly [string, unknown])[] = Array.isArray(value)
      ? value.map((v: unknown, i) => [String(i), v] as const)
      : Object.entries(value as Record<string, unknown>);
    const open = Array.isArray(value) ? `[${String(entries.length)}]` : `{${String(entries.length)}}`;
    return (
      <details open={true} className="json-node">
        <summary>
          {label}
          {open}
        </summary>
        <ul>
          {entries.map(([k, v]) => (
            <li key={k}>
              <JsonTree value={v} name={k} />
            </li>
          ))}
        </ul>
      </details>
    );
  }
  return (
    <span className={`json-${value === null ? "null" : typeof value}`}>
      {label}
      {JSON.stringify(value)}
    </span>
  );
}

/** A vector's elements as bars, each as high as it is great, from the middle. */
function VectorBars({
  elements,
  span,
}: {
  readonly elements: readonly (readonly [number, number])[];
  readonly span: number;
}) {
  return (
    <svg
      role="img"
      aria-label="The vector's elements"
      viewBox={`0 -1 ${String(Math.max(elements.length, 1))} 2`}
      width="100%"
      height="64"
      preserveAspectRatio="none"
    >
      {elements.map(([at, e], i) => (
        <rect
          key={at}
          x={i}
          width={0.8}
          y={e >= 0 ? -e / span : 0}
          height={Math.abs(e) / span}
          className="vector-bar"
        />
      ))}
    </svg>
  );
}

/** The most elements the table of a vector shows. */
const MAX_ELEMENTS = 1000;

/** A vector's elements and figures. */
function VectorShown({ text }: { readonly text: string }) {
  const v = parseVector(text);
  if (v === null) {
    return <p className="hint">Not a vector Studio reads.</p>;
  }
  const f = figures(v);
  return (
    <div className="vector">
      <p>
        {String(v.dims)} dimensions{v.sparse ? `, ${String(v.elements.length)} not zero` : ""}; norm{" "}
        {f.norm.toPrecision(6)}, least {String(f.min)}, greatest {String(f.max)}
      </p>
      <VectorBars elements={v.elements} span={Math.max(Math.abs(f.min), Math.abs(f.max), 1e-12)} />
      <table className="result-table" aria-label="Elements">
        <thead>
          <tr>
            <th scope="col">Position</th>
            <th scope="col">Element</th>
          </tr>
        </thead>
        <tbody>
          {v.elements.slice(0, MAX_ELEMENTS).map(([at, e]) => (
            <tr key={at}>
              <td>{at}</td>
              <td>{e}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The text of `read`, if it is text. */
function textOf(read: Read): string | null {
  return read.kind === "text" ? read.text : null;
}

/** A JSON value, or why its text is none. */
function JsonShown({ text }: { readonly text: string }) {
  const parsed = parseJson(text);
  return parsed.ok ? <JsonTree value={parsed.value} /> : <p className="hint">Not JSON: {parsed.why}</p>;
}

/** Octets as an image. */
function ImageShown({ bytes }: { readonly bytes: Uint8Array }) {
  return (
    <img
      className="value-image"
      alt="The value, as an image"
      src={`data:${imageType(bytes) ?? ""};base64,${toBase64(bytes)}`}
    />
  );
}

/** A value as a viewer is given it: its text, empty of null, whether it is null, its octets, and the lines' wrap. */
interface Given {
  readonly text: string;
  readonly isNull: boolean;
  readonly bytes: Uint8Array;
  readonly wrap: boolean;
}

/** What each viewer shows of a value. */
const SHOWN: Readonly<Record<ViewKind, (given: Given) => ReactNode>> = {
  text: (g) => <pre className={g.wrap ? "value-text value-wrap" : "value-text"}>{g.isNull ? "NULL" : g.text}</pre>,
  json: (g) => <JsonShown text={g.text} />,
  xml: (g) => <pre className="value-text">{prettyXml(g.text)}</pre>,
  hex: (g) => <pre className="value-text">{hexDump(g.bytes)}</pre>,
  image: (g) => <ImageShown bytes={g.bytes} />,
  plane: (g) => <PlaneView drawn={[{ shapes: parseWkt(g.text) ?? [], selected: true }]} />,
  vector: (g) => <VectorShown text={g.text} />,
  path: (g) => <GraphView graph={graphOf([[g.text]], { kind: "paths", column: 0 })} />,
};

/** No octets. */
const NO_BYTES = new Uint8Array();

/** The viewers' tabs, and the choice of wrapping a text's lines. */
function ViewerTabs(props: {
  readonly kinds: readonly ViewKind[];
  readonly kind: ViewKind;
  readonly onKind: (kind: ViewKind) => void;
  readonly wrap: boolean;
  readonly onWrap: (wrap: boolean) => void;
}) {
  return (
    <div role="tablist" className="tabs" aria-label="Viewers">
      {props.kinds.map((k) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={k === props.kind}
          onClick={() => {
            props.onKind(k);
          }}
        >
          {VIEW_NAMES[k]}
        </button>
      ))}
      {props.kind === "text" && (
        <label className="value-wrap-choice">
          <input
            type="checkbox"
            checked={props.wrap}
            onChange={(e) => {
              props.onWrap(e.target.checked);
            }}
          />{" "}
          Wrap lines
        </label>
      )}
    </div>
  );
}

/** The viewer of `viewed`. */
export function ValueViewer({ viewed }: { readonly viewed: Viewed }) {
  const read = useRead(viewed);
  const [chosen, setChosen] = useState<ViewKind | null>(null);
  const [wrap, setWrap] = useState(true);
  if (read.kind === "reading") {
    return <p className="hint">Reading the value…</p>;
  }
  if (read.kind === "failed") {
    return <p className="hint">The value could not be read: {read.why}</p>;
  }
  const kinds = viewKinds(viewed.column, textOf(read), read.kind === "bytes" ? read.bytes : null);
  const kind = chosen !== null && kinds.includes(chosen) ? chosen : (kinds[0] ?? "text");
  return (
    <div className="value-viewer">
      <ViewerTabs kinds={kinds} kind={kind} onKind={setChosen} wrap={wrap} onWrap={setWrap} />
      {read.cut && <p className="hint">Only the first 16 MiB of the value are read.</p>}
      {SHOWN[kind]({
        text: textOf(read) ?? "",
        isNull: textOf(read) === null && read.kind === "text",
        bytes: read.kind === "bytes" ? read.bytes : NO_BYTES,
        wrap,
      })}
    </div>
  );
}
