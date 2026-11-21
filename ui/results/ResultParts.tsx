/**
 * The other views of a result (RULES.md D39): as text; a row at a time,
 * as a form; as a graph of nodes and edges; its spatial values on a
 * plane; and compared with another result.
 */
import { useMemo, useState } from "react";
import type { RunResult } from "../state/worksheets";
import { Icon } from "../icons/Icon";
import { compare } from "./compare";
import { resultText } from "./text";
import { firstChoice, type Graph, type GraphChoice, graphOf } from "./viewers/graph";
import { GraphView } from "./viewers/GraphView";
import { spatialType } from "./viewers/kinds";
import { PlaneView } from "./viewers/PlaneView";
import { parseWkt } from "./viewers/wkt";

/** A result as text. */
export function TextView({ run }: { readonly run: RunResult }) {
  const text = useMemo(() => resultText(run.columns, run.rows), [run.columns, run.rows]);
  return (
    <pre className="result-text" aria-label="Result as text" tabIndex={0}>
      {text}
    </pre>
  );
}

/** The bar of the record view: the row shown, and the rows before and after it. */
function RecordBar({
  run,
  at,
  onRow,
}: {
  readonly run: RunResult;
  readonly at: number;
  readonly onRow: (row: number) => void;
}) {
  return (
    <div className="record-bar">
      <button
        type="button"
        aria-label="Previous Row"
        title="Previous Row"
        disabled={at === 0}
        onClick={() => {
          onRow(at - 1);
        }}
      >
        <Icon name="previous" />
      </button>
      <span>
        Row {String(at + 1)} of {String(run.rows.length)}
        {run.complete ? "" : "+"}
      </span>
      <button
        type="button"
        aria-label="Next Row"
        title="Next Row"
        disabled={at >= run.rows.length - 1}
        onClick={() => {
          onRow(at + 1);
        }}
      >
        <Icon name="next" />
      </button>
    </div>
  );
}

/** A result a row at a time: each column's name, type and value. */
export function RecordView({
  run,
  row,
  onRow,
}: {
  readonly run: RunResult;
  readonly row: number;
  readonly onRow: (row: number) => void;
}) {
  const at = Math.min(Math.max(row, 0), Math.max(run.rows.length - 1, 0));
  const cells = run.rows[at] ?? [];
  return (
    <div className="record">
      <RecordBar run={run} at={at} onRow={onRow} />
      <table className="result-table record-table" aria-label={`Row ${String(at + 1)}`}>
        <tbody>
          {run.columns.map((c, i) => (
            <tr key={`${String(i)}.${c.name ?? ""}`}>
              <th scope="row">
                {c.name ?? `(${String(i + 1)})`}
                <span className="result-type">{c.typeWritten}</span>
              </th>
              <td className={cells[i] === null ? "null" : undefined}>{cells[i] ?? "NULL"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A column's name, for a choice. */
function columnName(run: RunResult, i: number): string {
  return run.columns[i]?.name ?? `(${String(i + 1)})`;
}

/** A choice of one of the result's columns. */
function ColumnChoice(props: {
  readonly run: RunResult;
  readonly label: string;
  readonly value: number | null;
  readonly none?: boolean;
  readonly onChange: (column: number | null) => void;
}) {
  return (
    <label>
      {props.label}{" "}
      <select
        value={props.value === null ? "" : String(props.value)}
        onChange={(e) => {
          props.onChange(e.target.value === "" ? null : Number(e.target.value));
        }}
      >
        {props.none === true && <option value="">None</option>}
        {props.run.columns.map((_, i) => (
          <option key={String(i)} value={String(i)}>
            {columnName(props.run, i)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The columns an edge of each row is read from: its ends, and its label. */
function PairChoices({
  run,
  choice,
  onChoice,
}: {
  readonly run: RunResult;
  readonly choice: Extract<GraphChoice, { kind: "pairs" }>;
  readonly onChoice: (choice: GraphChoice) => void;
}) {
  return (
    <>
      <ColumnChoice
        run={run}
        label="From"
        value={choice.from}
        onChange={(c) => {
          onChoice({ ...choice, from: c ?? 0 });
        }}
      />
      <ColumnChoice
        run={run}
        label="To"
        value={choice.to}
        onChange={(c) => {
          onChoice({ ...choice, to: c ?? 0 });
        }}
      />
      <ColumnChoice
        run={run}
        label="Label"
        value={choice.label}
        none={true}
        onChange={(c) => {
          onChoice({ ...choice, label: c });
        }}
      />
    </>
  );
}

/** The choice of how a result is read as a graph. */
function GraphChoiceBar({
  run,
  choice,
  onChoice,
}: {
  readonly run: RunResult;
  readonly choice: GraphChoice;
  readonly onChoice: (choice: GraphChoice) => void;
}) {
  const pairs: GraphChoice = { kind: "pairs", from: 0, to: Math.min(1, run.columns.length - 1), label: null };
  return (
    <div className="graph-choice">
      <label>
        Read as{" "}
        <select
          value={choice.kind}
          onChange={(e) => {
            onChoice(e.target.value === "paths" ? { kind: "paths", column: 0 } : pairs);
          }}
        >
          <option value="paths">Paths</option>
          <option value="pairs">Edges from column to column</option>
        </select>
      </label>
      {choice.kind === "paths" ? (
        <ColumnChoice
          run={run}
          label="Paths"
          value={choice.column}
          onChange={(c) => {
            onChoice({ kind: "paths", column: c ?? 0 });
          }}
        />
      ) : (
        <PairChoices run={run} choice={choice} onChoice={onChoice} />
      )}
    </div>
  );
}

/** No graph. */
const NO_GRAPH: Graph = { nodes: [], edges: [] };

/** A result as a graph: of a column of paths, or of two columns, each row an edge. */
export function GraphOfResult({ run }: { readonly run: RunResult }) {
  const [choice, setChoice] = useState<GraphChoice | null>(() => firstChoice(run.rows, run.columns.length));
  const graph = useMemo(() => (choice === null ? NO_GRAPH : graphOf(run.rows, choice)), [run.rows, choice]);
  if (choice === null) {
    return <p className="hint">A graph needs a column of paths, or two columns.</p>;
  }
  return (
    <div className="result-graph">
      <GraphChoiceBar run={run} choice={choice} onChoice={setChoice} />
      <GraphView graph={graph} />
    </div>
  );
}

/** The spatial columns of `run`: of a spatial type, or whose first value is well-known text. */
export function spatialColumns(run: RunResult): number[] {
  return run.columns.flatMap((c, i) => {
    const first = run.rows.find((r) => r[i] !== null)?.[i] ?? null;
    return spatialType(c) || (first !== null && parseWkt(first) !== null) ? [i] : [];
  });
}

/** A result's spatial values on a plane, the selected row's marked. */
export function PlaneOfResult({ run, row }: { readonly run: RunResult; readonly row: number | null }) {
  const columns = spatialColumns(run);
  const [column, setColumn] = useState<number | null>(columns[0] ?? null);
  const drawn = useMemo(
    () =>
      column === null ? [] : run.rows.map((r, i) => ({ shapes: parseWkt(r[column] ?? "") ?? [], selected: i === row })),
    [run.rows, column, row],
  );
  if (column === null) {
    return <p className="hint">The result has no spatial column.</p>;
  }
  return (
    <div className="result-plane">
      <ColumnChoice run={run} label="Column" value={column} onChange={setColumn} />
      <PlaneView drawn={drawn} />
    </div>
  );
}

/** The most rows a comparison shows. */
const MAX_COMPARED = 10_000;

/** A result compared with another of the worksheet's. */
export function CompareView({ left, right }: { readonly left: RunResult; readonly right: RunResult }) {
  const found = useMemo(() => compare(left, right), [left, right]);
  return (
    <div className="compare">
      <p>
        {String(found.both)} rows in both, {String(found.left)} only in this result, {String(found.right)} only in the
        other
        {found.sameColumns ? "" : "; the columns differ, by name or type"}
        {left.complete && right.complete ? "." : ", of the rows read."}
      </p>
      <table className="result-table" aria-label="Comparison">
        <thead>
          <tr>
            <th scope="col">In</th>
            {left.columns.map((c, i) => (
              <th key={`${String(i)}.${c.name ?? ""}`} scope="col">
                {c.name ?? `(${String(i + 1)})`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {found.rows.slice(0, MAX_COMPARED).map((r, i) => (
            <tr key={String(i)} className={`compare-${r.side}`}>
              <td>{r.side === "both" ? "both" : r.side === "left" ? "this" : "other"}</td>
              {r.cells.map((c, j) => (
                <td key={String(j)} className={c === null ? "null" : undefined}>
                  {c ?? "NULL"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
