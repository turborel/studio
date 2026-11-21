/**
 * The plan as a tree-table (RULES.md D54): each operator a row, indented
 * by its depth, with its estimate, actual rows, loops, probes, own time and
 * share of the time; a header's click sorts by its column, descending,
 * then ascending, then as the plan is. Of two plans compared, an operator
 * the other lacks is marked changed.
 */
import { useState } from "react";
import { Icon } from "../icons/Icon";
import { KIND_ICONS, kindOf } from "./kinds";
import type { PlanNode } from "./plan";
import { readsOf } from "./PlanGraph";
import { ownTime } from "./summary";

/** A row of the table: an operator, its depth, and its path as its identifier. */
export interface TableRow {
  readonly id: string;
  readonly node: PlanNode;
  readonly depth: number;
}

/** The rows of `roots`, depth first. */
export function tableRows(roots: readonly PlanNode[]): TableRow[] {
  const out: TableRow[] = [];
  const walk = (nodes: readonly PlanNode[], parent: string | null, depth: number) => {
    nodes.forEach((node, i) => {
      const id = parent === null ? String(i) : `${parent}.${String(i)}`;
      out.push({ id, node, depth });
      walk(node.children, id, depth + 1);
    });
  };
  walk(roots, null, 0);
  return out;
}

/** The columns a table sorts by, and each one's value of a row. */
export const SORTS = {
  estimate: (n: PlanNode) => n.estimated,
  actual: (n: PlanNode) => n.actual,
  loops: (n: PlanNode) => n.loops,
  probes: (n: PlanNode) => n.probes,
  time: (n: PlanNode) => ownTime(n),
} as const;

/** A column sorted by. */
export type SortBy = keyof typeof SORTS;

/** The columns of numbers, each its sort and its heading. */
const COLUMNS: readonly (readonly [SortBy, string])[] = [
  ["estimate", "Estimate"],
  ["actual", "Actual"],
  ["loops", "Loops"],
  ["probes", "Probes"],
  ["time", "Time (ms)"],
];

/** `rows` sorted by `by`, descending or not; as they are of no sort. A value of none sorts last. */
export function sortedRows(rows: readonly TableRow[], sort: { by: SortBy; descending: boolean } | null): TableRow[] {
  if (sort === null) {
    return [...rows];
  }
  const value = SORTS[sort.by];
  return [...rows].sort((a, b) => {
    const [x, y] = [value(a.node), value(b.node)];
    if (x === null || y === null) {
      return x === y ? 0 : x === null ? 1 : -1;
    }
    return sort.descending ? y - x : x - y;
  });
}

/** The table of `roots`, `changed` marked, a row's click choosing it. */
export function PlanTable(props: {
  readonly roots: readonly PlanNode[];
  readonly changed?: ReadonlySet<PlanNode>;
  readonly chosen?: string | null;
  readonly label: string;
  readonly onChoose?: (id: string) => void;
}) {
  const [sort, setSort] = useState<{ by: SortBy; descending: boolean } | null>(null);
  const total = props.roots[0]?.millis ?? null;
  const next = (by: SortBy) => {
    setSort((now) => (now?.by !== by ? { by, descending: true } : now.descending ? { by, descending: false } : null));
  };
  return (
    <table className="plan-table" aria-label={props.label}>
      <thead>
        <tr>
          <th scope="col">Operator</th>
          <th scope="col">Reads</th>
          {COLUMNS.map(([by, name]) => (
            <th
              key={by}
              scope="col"
              aria-sort={sort?.by === by ? (sort.descending ? "descending" : "ascending") : "none"}
            >
              <button
                type="button"
                className="link"
                onClick={() => {
                  next(by);
                }}
              >
                {name}
              </button>
            </th>
          ))}
          <th scope="col">Share</th>
        </tr>
      </thead>
      <tbody>
        {sortedRows(tableRows(props.roots), sort).map((row) => (
          <PlanRow key={row.id} row={row} total={total} {...props} />
        ))}
      </tbody>
    </table>
  );
}

/** A row of the table. */
function PlanRow(props: {
  readonly row: TableRow;
  readonly total: number | null;
  readonly changed?: ReadonlySet<PlanNode>;
  readonly chosen?: string | null;
  readonly onChoose?: (id: string) => void;
}) {
  const { row, total } = props;
  const own = ownTime(row.node);
  const classes = [
    props.changed?.has(row.node) === true ? "plan-changed" : "",
    props.chosen === row.id ? "plan-chosen" : "",
  ];
  const figure = (v: number | null) => (v === null ? "" : String(v));
  return (
    <tr className={classes.filter((c) => c !== "").join(" ")} onClick={() => props.onChoose?.(row.id)}>
      <td style={{ paddingLeft: `${String(row.depth * 16 + 4)}px` }} title={row.node.raw}>
        <Icon name={KIND_ICONS[kindOf(row.node)]} /> {row.node.operator}
      </td>
      <td>{readsOf(row.node)}</td>
      <td>{figure(row.node.estimated)}</td>
      <td>{figure(row.node.actual)}</td>
      <td>{figure(row.node.loops)}</td>
      <td>{figure(row.node.probes)}</td>
      <td>{figure(own)}</td>
      <td>{total !== null && total > 0 && own !== null ? `${String(Math.round((own / total) * 100))}%` : ""}</td>
    </tr>
  );
}
