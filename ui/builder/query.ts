/**
 * A query built by its parts (RULES.md D48): tables picked, each its
 * alias; the joins between them that their foreign keys imply, each inner
 * or left; columns chosen, each perhaps of an aggregate; conditions
 * joined by AND; grouping by the columns of no aggregate; and order. Its
 * SQL is written as SELECT writes it ([DOC sql/statements/select.md SYNOPSIS]).
 */
import type { TableDetail } from "../ipc/catalog";
import type { Namer } from "../data/ddl";
import { literalOf } from "./literal";

/** A table picked, by its alias. */
export interface Picked {
  readonly alias: string;
  readonly table: TableDetail;
}

/** A join of a picked table to one picked before it. */
export interface Join {
  /** The alias of the table joined. */
  readonly alias: string;
  readonly kind: "INNER" | "LEFT";
  /** The pairs of columns it is joined on: its own, and the other's, each by alias. */
  readonly on: readonly { readonly left: string; readonly right: string }[];
}

/** An aggregate a column may be of. */
export type Aggregate = "" | "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";

/** A column chosen: its table's alias, its name, and its aggregate. */
export interface Chosen {
  readonly alias: string;
  readonly column: string;
  readonly aggregate: Aggregate;
}

/** A condition: a column, an operator, and a value as written. */
export interface Condition {
  readonly alias: string;
  readonly column: string;
  readonly operator: "=" | "<>" | "<" | "<=" | ">" | ">=" | "LIKE" | "IS NULL" | "IS NOT NULL";
  readonly value: string;
}

/** A key of the order. */
export interface OrderKey {
  readonly alias: string;
  readonly column: string;
  readonly descending: boolean;
}

/** A query's parts. */
export interface QuerySpec {
  readonly tables: readonly Picked[];
  readonly joins: readonly Join[];
  readonly columns: readonly Chosen[];
  readonly conditions: readonly Condition[];
  readonly order: readonly OrderKey[];
}

/** A query of no parts. */
export const NO_QUERY: QuerySpec = { tables: [], joins: [], columns: [], conditions: [], order: [] };

/** The alias of the next table picked of `name`: its name's first letter and a number past the others'. */
export function nextAlias(spec: QuerySpec, name: string): string {
  const letter = (/[A-Za-z]/u.exec(name)?.[0] ?? "T").toUpperCase();
  let n = 1;
  while (spec.tables.some((t) => t.alias === `${letter}${String(n)}`)) {
    n += 1;
  }
  return `${letter}${String(n)}`;
}

/** The join of `added` to the tables picked before, that a foreign key of either implies; null if none does. */
export function impliedJoin(before: readonly Picked[], added: Picked): Join | null {
  for (const other of before) {
    const ours = added.table.constraints.find(
      (c) =>
        c.references !== null && c.references.schema === other.table.schema && c.references.table === other.table.name,
    );
    const theirs = other.table.constraints.find(
      (c) =>
        c.references !== null && c.references.schema === added.table.schema && c.references.table === added.table.name,
    );
    if (ours?.references != null) {
      const refs = ours.references.columns;
      return {
        alias: added.alias,
        kind: "INNER",
        on: ours.columns.map((c, i) => ({ left: `${added.alias}.${c}`, right: `${other.alias}.${refs[i] ?? ""}` })),
      };
    }
    if (theirs?.references != null) {
      const refs = theirs.references.columns;
      return {
        alias: added.alias,
        kind: "INNER",
        on: theirs.columns.map((c, i) => ({ left: `${added.alias}.${refs[i] ?? ""}`, right: `${other.alias}.${c}` })),
      };
    }
  }
  return null;
}

/** `spec` with `table` picked, as `alias`, joined as a foreign key implies. */
export function pick(spec: QuerySpec, table: TableDetail): QuerySpec {
  const picked: Picked = { alias: nextAlias(spec, table.name), table };
  const join = impliedJoin(spec.tables, picked);
  return { ...spec, tables: [...spec.tables, picked], joins: join === null ? spec.joins : [...spec.joins, join] };
}

/** `spec` without the table of `alias`, and every part of it. */
export function unpick(spec: QuerySpec, alias: string): QuerySpec {
  const of = (part: { readonly alias: string }) => part.alias !== alias;
  return {
    tables: spec.tables.filter(of),
    joins: spec.joins.filter((j) => of(j) && j.on.every((p) => !p.right.startsWith(`${alias}.`))),
    columns: spec.columns.filter(of),
    conditions: spec.conditions.filter(of),
    order: spec.order.filter(of),
  };
}

/** A column of a table picked, as SQL writes it: its alias, and its name. */
function columnRef(alias: string, column: string, name: Namer): string {
  return `${alias}.${name(column)}`;
}

/** A pair's side, `alias.column`, as SQL writes it. */
function sideRef(side: string, name: Namer): string {
  const at = side.indexOf(".");
  return columnRef(side.slice(0, at), side.slice(at + 1), name);
}

/** A condition as SQL writes it, its value a literal of the column's type. */
function conditionSql(c: Condition, spec: QuerySpec, name: Namer): string {
  const column = columnRef(c.alias, c.column, name);
  if (c.operator === "IS NULL" || c.operator === "IS NOT NULL") {
    return `${column} ${c.operator}`;
  }
  const type =
    spec.tables.find((t) => t.alias === c.alias)?.table.columns.find((x) => x.name === c.column)?.typeWritten ??
    "VARCHAR";
  return `${column} ${c.operator} ${literalOf(c.value, type)}`;
}

/** The FROM clause of `spec`: each table, joined as its join says, or by a comma where none does. */
function fromSql(spec: QuerySpec, name: Namer): string {
  const parts = spec.tables.map((t, i) => {
    const table = `${name(t.table.schema)}.${name(t.table.name)} ${t.alias}`;
    const join = spec.joins.find((j) => j.alias === t.alias);
    if (i === 0) {
      return table;
    }
    if (join === undefined || join.on.length === 0) {
      return `, ${table}`;
    }
    const on = join.on.map((p) => `${sideRef(p.left, name)} = ${sideRef(p.right, name)}`).join(" AND ");
    return `\n${join.kind === "LEFT" ? "LEFT JOIN" : "JOIN"} ${table} ON ${on}`;
  });
  return parts.join("");
}

/** The SQL of `spec`: SELECT of its columns, or every one; FROM; WHERE; GROUP BY the columns of no aggregate, if any has one; ORDER BY. */
export function querySql(spec: QuerySpec, name: Namer): string {
  if (spec.tables.length === 0) {
    return "";
  }
  const columns = spec.columns.map((c) => {
    const ref = columnRef(c.alias, c.column, name);
    return c.aggregate === "" ? ref : `${c.aggregate}(${ref})`;
  });
  const lines = [`SELECT ${columns.length === 0 ? "*" : columns.join(", ")}`, `FROM ${fromSql(spec, name)}`];
  if (spec.conditions.length > 0) {
    lines.push(`WHERE ${spec.conditions.map((c) => conditionSql(c, spec, name)).join("\n    AND ")}`);
  }
  const grouped = spec.columns.filter((c) => c.aggregate === "");
  if (spec.columns.some((c) => c.aggregate !== "") && grouped.length > 0) {
    lines.push(`GROUP BY ${grouped.map((c) => columnRef(c.alias, c.column, name)).join(", ")}`);
  }
  if (spec.order.length > 0) {
    lines.push(
      `ORDER BY ${spec.order.map((o) => `${columnRef(o.alias, o.column, name)}${o.descending ? " DESC" : ""}`).join(", ")}`,
    );
  }
  return lines.join("\n");
}
