/**
 * The parts of the query builder (RULES.md D48): the tables picked, each
 * with its columns to choose and their aggregates; the joins; the
 * conditions; and the order.
 */
import type { Aggregate, Chosen, Condition, Join, OrderKey, Picked, QuerySpec } from "./query";

/** The aggregates a column may be of, as the choice names them. */
const AGGREGATES: readonly (readonly [Aggregate, string])[] = [
  ["", "value"],
  ["COUNT", "COUNT"],
  ["SUM", "SUM"],
  ["AVG", "AVG"],
  ["MIN", "MIN"],
  ["MAX", "MAX"],
];

/** What a part is given: the query, and its change. */
export interface PartProps {
  readonly spec: QuerySpec;
  readonly onSpec: (spec: QuerySpec) => void;
}

/** A column of a table picked: chosen or not, and of an aggregate or none. */
function PickedColumn(props: {
  readonly alias: string;
  readonly column: string;
  readonly chosen: Chosen | undefined;
  readonly onToggle: () => void;
  readonly onAggregate: (a: Aggregate) => void;
}) {
  return (
    <div>
      <label>
        <input type="checkbox" checked={props.chosen !== undefined} onChange={props.onToggle} /> {props.column}
      </label>
      {props.chosen !== undefined && (
        <select
          aria-label={`Aggregate of ${props.alias}.${props.column}`}
          value={props.chosen.aggregate}
          onChange={(e) => {
            props.onAggregate(e.target.value as Aggregate);
          }}
        >
          {AGGREGATES.map(([a, n]) => (
            <option key={n} value={a}>
              {n}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** A table picked: its columns, each chosen or not, of an aggregate or none; and the button that lets it go. */
function PickedTable({
  spec,
  onSpec,
  picked,
  onRemove,
}: PartProps & { readonly picked: Picked; readonly onRemove: () => void }) {
  const chosen = (column: string) => spec.columns.find((c) => c.alias === picked.alias && c.column === column);
  const toggle = (column: string) => {
    const others = spec.columns.filter((c) => !(c.alias === picked.alias && c.column === column));
    onSpec({
      ...spec,
      columns:
        chosen(column) === undefined ? [...spec.columns, { alias: picked.alias, column, aggregate: "" }] : others,
    });
  };
  const aggregate = (column: string, a: Aggregate) => {
    onSpec({
      ...spec,
      columns: spec.columns.map((c) => (c.alias === picked.alias && c.column === column ? { ...c, aggregate: a } : c)),
    });
  };
  return (
    <fieldset className="builder-table">
      <legend>
        {picked.table.schema}.{picked.table.name} {picked.alias}{" "}
        <Remove label={`Remove ${picked.alias}`} onClick={onRemove} />
      </legend>
      {picked.table.columns.map((c) => (
        <PickedColumn
          key={c.name}
          alias={picked.alias}
          column={c.name}
          chosen={chosen(c.name)}
          onToggle={() => {
            toggle(c.name);
          }}
          onAggregate={(a) => {
            aggregate(c.name, a);
          }}
        />
      ))}
    </fieldset>
  );
}

/** A button that removes a part. */
function Remove({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <button type="button" aria-label={label} onClick={onClick}>
      ×
    </button>
  );
}

/** The choice of a column of the tables picked. */
function ColumnSelect(props: {
  readonly label: string;
  readonly value: string;
  readonly columns: readonly string[];
  readonly onValue: (v: { alias: string; column: string }) => void;
}) {
  return (
    <select
      aria-label={props.label}
      value={props.value}
      onChange={(e) => {
        props.onValue(split(e.target.value));
      }}
    >
      {props.columns.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}

/** The tables picked, each as a box of its columns. */
export function Tables({ spec, onSpec, onRemove }: PartProps & { readonly onRemove: (alias: string) => void }) {
  return (
    <div className="builder-tables">
      {spec.tables.map((t) => (
        <PickedTable
          key={t.alias}
          spec={spec}
          onSpec={onSpec}
          picked={t}
          onRemove={() => {
            onRemove(t.alias);
          }}
        />
      ))}
    </div>
  );
}

/** The joins: each its table and the columns it is joined on, inner or left. */
export function Joins({ spec, onSpec }: PartProps) {
  if (spec.joins.length === 0) {
    return null;
  }
  const kind = (j: Join, k: Join["kind"]) => {
    onSpec({ ...spec, joins: spec.joins.map((x) => (x === j ? { ...x, kind: k } : x)) });
  };
  return (
    <ul aria-label="Joins">
      {spec.joins.map((j) => (
        <li key={j.alias}>
          <select
            aria-label={`Join of ${j.alias}`}
            value={j.kind}
            onChange={(e) => {
              kind(j, e.target.value === "LEFT" ? "LEFT" : "INNER");
            }}
          >
            <option value="INNER">JOIN</option>
            <option value="LEFT">LEFT JOIN</option>
          </select>{" "}
          {j.alias} ON {j.on.map((p) => `${p.left} = ${p.right}`).join(" AND ")}
        </li>
      ))}
    </ul>
  );
}

/** Every column of every table picked, as `alias.column`. */
function allColumns(spec: QuerySpec): string[] {
  return spec.tables.flatMap((t) => t.table.columns.map((c) => `${t.alias}.${c.name}`));
}

/** `alias.column` split. */
function split(ref: string): { alias: string; column: string } {
  const at = ref.indexOf(".");
  return { alias: ref.slice(0, at), column: ref.slice(at + 1) };
}

/** The operators of a condition. */
const OPERATORS: readonly Condition["operator"][] = ["=", "<>", "<", "<=", ">", ">=", "LIKE", "IS NULL", "IS NOT NULL"];

/** A condition: its column, its operator and its value. */
function ConditionRow(props: {
  readonly c: Condition;
  readonly n: number;
  readonly columns: readonly string[];
  readonly onSet: (part: Partial<Condition>) => void;
  readonly onRemove: () => void;
}) {
  const { c, n } = props;
  return (
    <div>
      <ColumnSelect
        label={`Column of condition ${String(n)}`}
        value={`${c.alias}.${c.column}`}
        columns={props.columns}
        onValue={props.onSet}
      />
      <select
        aria-label={`Operator of condition ${String(n)}`}
        value={c.operator}
        onChange={(e) => {
          props.onSet({ operator: e.target.value as Condition["operator"] });
        }}
      >
        {OPERATORS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {!c.operator.startsWith("IS") && (
        <input
          aria-label={`Value of condition ${String(n)}`}
          value={c.value}
          onChange={(e) => {
            props.onSet({ value: e.target.value });
          }}
        />
      )}
      <Remove label={`Remove condition ${String(n)}`} onClick={props.onRemove} />
    </div>
  );
}

/** The conditions, joined by AND: each its column, operator and value; one added or removed. */
export function Conditions({ spec, onSpec }: PartProps) {
  const columns = allColumns(spec);
  return (
    <fieldset>
      <legend>Where</legend>
      {spec.conditions.map((c, i) => (
        <ConditionRow
          key={String(i)}
          c={c}
          n={i + 1}
          columns={columns}
          onSet={(part) => {
            onSpec({ ...spec, conditions: spec.conditions.map((x, j) => (j === i ? { ...x, ...part } : x)) });
          }}
          onRemove={() => {
            onSpec({ ...spec, conditions: spec.conditions.filter((_, j) => j !== i) });
          }}
        />
      ))}
      <button
        type="button"
        disabled={columns.length === 0}
        onClick={() => {
          onSpec({
            ...spec,
            conditions: [...spec.conditions, { ...split(columns[0] ?? "."), operator: "=", value: "" }],
          });
        }}
      >
        Add Condition
      </button>
    </fieldset>
  );
}

/** A key of the order: its column and direction. */
function OrderRow(props: {
  readonly o: OrderKey;
  readonly n: number;
  readonly columns: readonly string[];
  readonly onSet: (part: Partial<OrderKey>) => void;
  readonly onRemove: () => void;
}) {
  const { o, n } = props;
  return (
    <div>
      <ColumnSelect
        label={`Column of order ${String(n)}`}
        value={`${o.alias}.${o.column}`}
        columns={props.columns}
        onValue={props.onSet}
      />
      <label>
        <input
          type="checkbox"
          checked={o.descending}
          onChange={(e) => {
            props.onSet({ descending: e.target.checked });
          }}
        />{" "}
        Descending
      </label>
      <Remove label={`Remove order ${String(n)}`} onClick={props.onRemove} />
    </div>
  );
}

/** The order: each key its column and direction; one added or removed. */
export function Order({ spec, onSpec }: PartProps) {
  const columns = allColumns(spec);
  return (
    <fieldset>
      <legend>Order by</legend>
      {spec.order.map((o, i) => (
        <OrderRow
          key={String(i)}
          o={o}
          n={i + 1}
          columns={columns}
          onSet={(part) => {
            onSpec({ ...spec, order: spec.order.map((x, j) => (j === i ? { ...x, ...part } : x)) });
          }}
          onRemove={() => {
            onSpec({ ...spec, order: spec.order.filter((_, j) => j !== i) });
          }}
        />
      ))}
      <button
        type="button"
        disabled={columns.length === 0}
        onClick={() => {
          onSpec({ ...spec, order: [...spec.order, { ...split(columns[0] ?? "."), descending: false }] });
        }}
      >
        Add Order
      </button>
    </fieldset>
  );
}
