/**
 * Completion (RULES.md D40): of the place the cursor is in, what may be
 * written there, from the catalog as cached, the statement's own sources,
 * Turborel's key words and built-in functions, and snippets; ranked by
 * scope, recent use and kind; each name written as Turborel reads it back,
 * and each key word in the formatter's case.
 */
import type { Column, Constraint, TableDetail } from "../../ipc/catalog";
import type { KeyWordCase } from "../../ipc/preferences";
import { sqlName, STATEMENT_WORDS, TYPE_WORDS } from "../dialect";
import type { Context } from "./context";
import type { BuiltIn } from "./functions";

/** A source of rows the statement reads, as its scope gives it. */
export interface ScopeSource {
  readonly kind: "table" | "cte" | "derived";
  readonly schema: string | null;
  readonly name: string | null;
  readonly alias: string | null;
  readonly columns: readonly string[] | null;
  readonly outer: boolean;
}

/** What completion reads of the catalog: as cached, a table read only as asked for. */
export interface CompletionCatalog {
  readonly defaultSchema: string | null;
  readonly reserved: readonly string[];
  readonly keyWords: KeyWordCase;
  schemas(): readonly string[];
  objects(schema: string): readonly { name: string; kind: "table" | "view" | "sequence" }[];
  routines(schema: string): readonly { name: string; specific: string; kind: string }[];
  table(schema: string | null, name: string): Promise<TableDetail | null>;
  signature(schema: string, specific: string): Promise<string | null>;
  builtIns: readonly BuiltIn[];
  snippets: readonly (readonly [string, string, string])[];
  /** How often each item was chosen, by its label. */
  recent(label: string): number;
}

/** What an item is. */
export type ItemKind =
  | "keyword"
  | "schema"
  | "table"
  | "view"
  | "sequence"
  | "cte"
  | "column"
  | "function"
  | "routine"
  | "join"
  | "columns"
  | "snippet";

/** An item offered. */
export interface Item {
  readonly label: string;
  readonly kind: ItemKind;
  /** What is written in place of the word typed; the label if none. */
  readonly apply?: string;
  /** Its type, or signature. */
  readonly detail?: string;
  /** What its popup says. */
  readonly info?: string;
  /** Its rank: the higher first. */
  readonly boost: number;
}

/** What completion offers: its items, and from where they replace the text. */
export interface Offer {
  readonly from: number;
  readonly items: readonly Item[];
}

/** The rank of each kind, before its scope and recent use are added. */
const KIND_RANK: Readonly<Record<ItemKind, number>> = {
  join: 40,
  columns: 38,
  column: 30,
  cte: 28,
  table: 24,
  view: 22,
  schema: 18,
  sequence: 16,
  routine: 14,
  function: 12,
  snippet: 8,
  keyword: 4,
};
/** The rank added to what the statement's outermost query reads. */
const OUTER_RANK = 6;
/** The most rank recent use adds. */
const MOST_RECENT_RANK = 10;

/** The words that begin a statement. */
const STARTS = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "WITH",
  "VALUES",
  "TABLE",
  "CREATE",
  "ALTER",
  "DROP",
  "GRANT",
  "REVOKE",
  "COMMIT",
  "ROLLBACK",
  "SAVEPOINT",
  "RELEASE",
  "SET",
  "CALL",
  "EXPLAIN",
  "TRUNCATE",
  "DECLARE",
  "BEGIN",
  "EXECUTE",
  "PREPARE",
  "DEALLOCATE",
  "START",
];
/** The words after a table of FROM. */
const AFTER_OBJECT = [
  "AS",
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "OUTER",
  "CROSS",
  "NATURAL",
  "ON",
  "USING",
  "WHERE",
  "GROUP",
  "ORDER",
  "HAVING",
  "UNION",
  "EXCEPT",
  "INTERSECT",
  "FETCH",
  "OFFSET",
  "WINDOW",
];
/** The words of a value expression. */
const EXPRESSION = [
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "CAST",
  "NOT",
  "NULL",
  "IS",
  "IN",
  "BETWEEN",
  "LIKE",
  "EXISTS",
  "AND",
  "OR",
  "TRUE",
  "FALSE",
  "UNKNOWN",
  "DISTINCT",
  "ALL",
  "ANY",
  "SOME",
  "INTERVAL",
  "CURRENT_DATE",
  "CURRENT_TIME",
  "CURRENT_TIMESTAMP",
  "CURRENT_USER",
  "SESSION_USER",
  "USER",
  "COALESCE",
  "NULLIF",
];
/** The words that may follow a clause, by the clause. */
const FOLLOWING: Readonly<Record<string, readonly string[]>> = {
  SELECT: ["AS", "FROM", "INTO"],
  WHERE: ["GROUP", "ORDER", "HAVING", "UNION", "EXCEPT", "INTERSECT", "FETCH", "OFFSET"],
  "GROUP BY": ["HAVING", "ORDER", "UNION", "EXCEPT", "INTERSECT"],
  HAVING: ["ORDER", "UNION", "EXCEPT", "INTERSECT"],
  "ORDER BY": ["ASC", "DESC", "NULLS", "FIRST", "LAST", "FETCH", "OFFSET"],
  SET: ["WHERE", "DEFAULT"],
  ON: ["JOIN", "INNER", "LEFT", "RIGHT", "WHERE", "GROUP", "ORDER"],
  VALUES: ["DEFAULT"],
};

/** `word` in the case `keyWords` says. */
export function inCase(word: string, keyWords: KeyWordCase): string {
  return keyWords === "lower" ? word.toLowerCase() : word.toUpperCase();
}

/** The key words of `words` that are Turborel's, in the case the catalog's settings say. */
function keywords(catalog: CompletionCatalog, words: readonly string[]): Item[] {
  const known = new Set([...catalog.reserved, ...STATEMENT_WORDS, ...TYPE_WORDS]);
  return [...new Set(words)]
    .filter((w) => known.has(w))
    .map((w) => ({ label: inCase(w, catalog.keyWords), kind: "keyword", boost: KIND_RANK.keyword }));
}

/** The rank of an item of `kind`, labelled `label`, `outer` if of the outermost query's scope. */
function rank(catalog: CompletionCatalog, kind: ItemKind, label: string, outer = false): number {
  return KIND_RANK[kind] + (outer ? OUTER_RANK : 0) + Math.min(MOST_RECENT_RANK, catalog.recent(label) * 2);
}

/** A name as written: its quotes off, or in upper case. */
export function unquote(name: string): string {
  return name.startsWith('"') ? name.slice(1, -1).replaceAll('""', '"') : name.toUpperCase();
}

/** The source of `sources` that `name`, its parts as Turborel reads them, designates: by its alias, else its name. */
export function sourceNamed(sources: readonly ScopeSource[], name: readonly string[]): ScopeSource | undefined {
  const [first = "", second] = name;
  if (second !== undefined) {
    return (
      sources.find((s) => s.schema === first && s.name === second && s.alias === null) ?? {
        kind: "table",
        schema: first,
        name: second,
        alias: null,
        columns: null,
        outer: false,
      }
    );
  }
  return sources.find((s) => s.alias === first) ?? sources.find((s) => s.alias === null && s.name === first);
}

/** The columns of `source`, as named, with their types where the catalog gives them. */
async function columnsOf(
  catalog: CompletionCatalog,
  sources: readonly ScopeSource[],
  source: ScopeSource,
): Promise<{ name: string; column?: Column; table?: TableDetail }[]> {
  if (source.columns !== null) {
    return source.columns.map((name) => ({ name }));
  }
  if (source.kind === "cte") {
    const cte = sources.find((s) => s.kind === "cte" && s.name === source.name && s.columns !== null);
    return (cte?.columns ?? []).map((name) => ({ name }));
  }
  if (source.name === null) {
    return [];
  }
  const table = await catalog.table(source.schema, source.name);
  return (table?.columns ?? []).map((column) => ({ name: column.name, column, ...(table === null ? {} : { table }) }));
}

/** A column's item: its type its detail, its table, default and null in its popup. */
function columnItem(
  catalog: CompletionCatalog,
  written: string,
  c: { name: string; column?: Column; table?: TableDetail },
  outer: boolean,
): Item {
  const column = c.column;
  const info =
    column === undefined
      ? undefined
      : `${column.typeWritten}${column.nullable ? "" : " NOT NULL"}${column.default === null ? "" : `, DEFAULT ${column.default}`}${c.table === undefined ? "" : `, of ${c.table.schema}.${c.table.name}`}`;
  return {
    label: written,
    kind: "column",
    boost: rank(catalog, "column", written, outer),
    ...(column === undefined ? {} : { detail: column.typeWritten }),
    ...(info === undefined ? {} : { info }),
  };
}

/** The columns of every source of the scope, each qualified by its source where another source has one of its name. */
async function scopeColumns(catalog: CompletionCatalog, sources: readonly ScopeSource[]): Promise<Item[]> {
  const reserved = new Set(catalog.reserved);
  const visible = sources.filter(
    (s) =>
      !(
        s.kind === "cte" &&
        s.alias === null &&
        s.columns !== null &&
        sources.some((o) => o !== s && o.kind === "cte" && o.name === s.name && o.columns === null)
      ),
  );
  const read = await Promise.all(
    visible.map(async (s) => ({ source: s, columns: await columnsOf(catalog, sources, s) })),
  );
  const counts = new Map<string, number>();
  for (const { columns } of read) {
    for (const c of new Set(columns.map((x) => x.name))) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  return read.flatMap(({ source, columns }) =>
    columns.map((c) => {
      const qualifier = source.alias ?? source.name;
      const ambiguous = (counts.get(c.name) ?? 0) > 1 && qualifier !== null;
      const written = ambiguous
        ? `${sqlName(qualifier, reserved)}.${sqlName(c.name, reserved)}`
        : sqlName(c.name, reserved);
      return columnItem(catalog, written, c, source.outer);
    }),
  );
}

/** The schemas, and the default schema's tables, views and sequences, and the statement's common table expressions. */
function objects(catalog: CompletionCatalog, sources: readonly ScopeSource[], sequences: boolean): Item[] {
  const reserved = new Set(catalog.reserved);
  const own = catalog.defaultSchema === null ? [] : catalog.objects(catalog.defaultSchema);
  const items: Item[] = own
    .filter((o) => (o.kind === "sequence") === sequences)
    .map((o) => ({ label: sqlName(o.name, reserved), kind: o.kind, boost: rank(catalog, o.kind, o.name, true) }));
  items.push(
    ...catalog
      .schemas()
      .map((s) => ({ label: sqlName(s, reserved), kind: "schema" as const, boost: rank(catalog, "schema", s) })),
  );
  if (!sequences) {
    const ctes = [...new Set(sources.filter((s) => s.kind === "cte" && s.name !== null).map((s) => s.name ?? ""))];
    items.push(
      ...ctes.map((name) => ({
        label: sqlName(name, reserved),
        kind: "cte" as const,
        boost: rank(catalog, "cte", name, true),
      })),
    );
  }
  return items;
}

/** The objects of schema `schema`, or the columns of the source the qualifier names. */
async function qualified(
  catalog: CompletionCatalog,
  sources: readonly ScopeSource[],
  qualifier: readonly string[],
): Promise<Item[]> {
  const reserved = new Set(catalog.reserved);
  // The context gives each name as Turborel reads it, unquoted or in upper case.
  const [only] = qualifier;
  const schema = only !== undefined && catalog.schemas().includes(only);
  const isSource =
    qualifier.length > 1 || sources.some((s) => s.alias === only || (!schema && s.alias === null && s.name === only));
  if (!isSource && only !== undefined && schema) {
    const items: Item[] = catalog
      .objects(only)
      .map((o) => ({ label: sqlName(o.name, reserved), kind: o.kind, boost: rank(catalog, o.kind, o.name) }));
    items.push(
      ...catalog.routines(only).map((r) => ({
        label: sqlName(r.name, reserved),
        kind: "routine" as const,
        detail: r.kind,
        boost: rank(catalog, "routine", r.name),
      })),
    );
    return items;
  }
  const source = sourceNamed(sources, qualifier) ?? {
    kind: "table" as const,
    schema: catalog.defaultSchema,
    name: only ?? null,
    alias: null,
    columns: null,
    outer: false,
  };
  const columns = await columnsOf(catalog, sources, source);
  return columns.map((c) => columnItem(catalog, sqlName(c.name, reserved), c, true));
}

/** The built-in functions and the default schema's routines, each with its signature. */
async function routines(catalog: CompletionCatalog): Promise<Item[]> {
  const reserved = new Set(catalog.reserved);
  const builtIn: Item[] = catalog.builtIns.map((f) => ({
    label: inCase(f.name, catalog.keyWords),
    kind: "function",
    detail: f.signature,
    info: `${f.signature}: ${f.value} (Turborel's ${f.page}, ${f.heading})`,
    boost: rank(catalog, "function", f.name),
  }));
  const schema = catalog.defaultSchema;
  const own = schema === null ? [] : catalog.routines(schema);
  const signed = await Promise.all(
    own.map(async (r) => ({ r, signature: await catalog.signature(schema ?? "", r.specific) })),
  );
  const user: Item[] = signed.map(({ r, signature }) => ({
    label: sqlName(r.name, reserved),
    kind: "routine",
    detail: signature ?? r.kind,
    ...(signature === null ? {} : { info: signature }),
    boost: rank(catalog, "routine", r.name),
  }));
  const once = new Map<string, Item>();
  for (const item of [...builtIn, ...user]) {
    if (!once.has(item.label)) {
      once.set(item.label, item);
    }
  }
  return [...once.values()];
}

/** The written name of `source`'s rows: its alias, else its name. */
function written(source: ScopeSource, reserved: ReadonlySet<string>): string {
  return sqlName(source.alias ?? source.name ?? "", reserved);
}

/** The conditions of the foreign keys between `a` and `b`, each `x.C = y.D AND ...`. */
function keyConditions(
  a: { source: ScopeSource; table: TableDetail },
  b: { source: ScopeSource; table: TableDetail },
  reserved: ReadonlySet<string>,
): string[] {
  const of = (from: typeof a, to: typeof b) =>
    from.table.constraints
      .filter(
        (k: Constraint) =>
          k.references !== null && k.references.table === to.table.name && k.references.schema === to.table.schema,
      )
      .map((k) =>
        k.columns
          .map(
            (c, i) =>
              `${written(from.source, reserved)}.${sqlName(c, reserved)} = ${written(to.source, reserved)}.${sqlName(k.references?.columns[i] ?? "", reserved)}`,
          )
          .join(" AND "),
      );
  return [...of(a, b), ...of(b, a)];
}

/** After JOIN … ON, the conditions the foreign keys between the table joined and the others imply. */
async function joins(catalog: CompletionCatalog, sources: readonly ScopeSource[], joined: string): Promise<Item[]> {
  const reserved = new Set(catalog.reserved);
  const target = sources.find((s) => s.kind === "table" && (s.name === unquote(joined) || s.alias === unquote(joined)));
  if (target?.name === null || target === undefined) {
    return [];
  }
  const targetTable = await catalog.table(target.schema, target.name);
  if (targetTable === null) {
    return [];
  }
  const others = sources.filter((s) => s !== target && s.kind === "table" && s.name !== null);
  const conditions = await Promise.all(
    others.map(async (o) => {
      const table = await catalog.table(o.schema, o.name ?? "");
      return table === null
        ? []
        : keyConditions({ source: target, table: targetTable }, { source: o, table }, reserved);
    }),
  );
  return conditions.flat().map((c) => ({
    label: c,
    kind: "join",
    info: "the condition a foreign key implies",
    boost: rank(catalog, "join", c),
  }));
}

/** Inside INSERT INTO t (, the whole list of the columns that take a value, then each column. */
async function insertColumns(catalog: CompletionCatalog, table: readonly string[]): Promise<Item[]> {
  const reserved = new Set(catalog.reserved);
  const [schema, name] =
    table.length > 1 ? [unquote(table[0] ?? ""), unquote(table[1] ?? "")] : [null, unquote(table[0] ?? "")];
  const detail = await catalog.table(schema, name);
  if (detail === null) {
    return [];
  }
  const takes = detail.columns
    .filter((c) => c.identity !== "ALWAYS" && c.generated === null)
    .map((c) => sqlName(c.name, reserved));
  const whole: Item = {
    label: takes.join(", "),
    kind: "columns",
    info: `every column of ${detail.name} that takes a value`,
    boost: rank(catalog, "columns", detail.name),
  };
  return [
    whole,
    ...detail.columns.map((c) =>
      columnItem(catalog, sqlName(c.name, reserved), { name: c.name, column: c, table: detail }, true),
    ),
  ];
}

/** The snippets, each its template, which completion expands. */
function snippets(catalog: CompletionCatalog): Item[] {
  return catalog.snippets.map(([label, detail, template]) => ({
    label,
    kind: "snippet",
    detail,
    info: template.replaceAll(/#\{([^}]*)\}/gu, "$1"),
    apply: template,
    boost: rank(catalog, "snippet", label),
  }));
}

/** What may be written at the cursor of `context`, the statement reading `sources`. */
export async function complete(
  context: Context,
  sources: readonly ScopeSource[],
  catalog: CompletionCatalog,
): Promise<Offer> {
  const place = context.place;
  const from = context.from;
  switch (place.kind) {
    case "none":
      return { from, items: [] };
    case "start":
      return { from, items: [...keywords(catalog, STARTS), ...snippets(catalog)] };
    case "qualified":
      return { from, items: await qualified(catalog, sources, place.qualifier) };
    case "object":
      return {
        from,
        // A derived table may be LATERAL, reading the tables before it (T491).
        items: [
          ...objects(catalog, sources, place.sequences),
          ...(place.derived ? keywords(catalog, ["LATERAL"]) : []),
        ],
      };
    case "afterObject":
      return { from, items: keywords(catalog, AFTER_OBJECT) };
    case "joinOn":
      return {
        from,
        items: [...(await joins(catalog, sources, place.joined)), ...(await scopeColumns(catalog, sources))],
      };
    case "insertColumns":
      return { from, items: await insertColumns(catalog, place.table) };
    case "type":
      return { from, items: keywords(catalog, TYPE_WORDS) };
    case "expression":
      return expression(context, sources, catalog, place.clause);
  }
}

/** In a value expression: the scope's columns, the routines, the words of expressions and those after the clause; SELECT *'s columns. */
async function expression(
  context: Context,
  sources: readonly ScopeSource[],
  catalog: CompletionCatalog,
  clause: string,
): Promise<Offer> {
  const columns = await scopeColumns(catalog, sources);
  if (context.star !== null) {
    const outer = columns.filter((c) => sources.length === 0 || c.boost >= KIND_RANK.column + OUTER_RANK);
    const all = (outer.length > 0 ? outer : columns).map((c) => c.label);
    const expand: Item = {
      label: all.join(", "),
      kind: "columns",
      info: "SELECT * written as its columns",
      boost: rank(catalog, "columns", "*"),
    };
    return { from: context.star, items: all.length === 0 ? [] : [expand] };
  }
  const words = keywords(catalog, [...EXPRESSION, ...(FOLLOWING[clause] ?? [])]);
  return { from: context.from, items: [...columns, ...(await routines(catalog)), ...words, ...snippets(catalog)] };
}
