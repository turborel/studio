/**
 * The analyzer's rule of a plan (RULES.md D50), SCAN-NO-INDEX: a table
 * the physical plan reads whole under a filter comparing one of its
 * columns with a constant, by a comparison an index answers (Turborel's
 * `sql/statements/create-index.md`: `=`, a range, BETWEEN, IN of
 * constants, and LIKE of a pattern that begins with characters), where no
 * index of the table leads that column. Its fix makes such an index,
 * which a what-if tries first (D51).
 */
import type { Namer } from "../data/ddl";
import type { TableDetail } from "../ipc/catalog";
import { type Plan, type PlanNode } from "../worksheet/plan";

/** The rule's identifier. */
export const SCAN_UNINDEXED = "SCAN-NO-INDEX";

/** A table the plan scans: its schema and name, as EXPLAIN writes them. */
export interface Scanned {
  readonly schema: string;
  readonly table: string;
}

/** A finding of the rule: the table and column, what it says, the index that would serve it, and its drop. */
export interface ScanFinding {
  readonly rule: string;
  readonly schema: string;
  readonly table: string;
  readonly column: string;
  readonly says: string;
  readonly index: string;
  readonly create: string;
  readonly drop: string;
}

/** The comparisons an index answers, of a column and a constant. */
const COMPARISON =
  /^([A-Za-z_][\w$]*|"(?:[^"]|"")+")\.([A-Za-z_][\w$]*|"(?:[^"]|"")+") (=|<|>|<=|>=|BETWEEN|IN|LIKE) (.+)$/u;
/** A column of a table, qualified, outside strings: a constant holds none. */
const QUALIFIED = /(?:^|[^\w$"'])(?:[A-Za-z_][\w$]*|"(?:[^"]|"")+")\.(?:[A-Za-z_][\w$]*|"(?:[^"]|"")+")/u;

/** A name as EXPLAIN writes it, its quotes taken off. */
function unquoted(name: string): string {
  return name.startsWith('"') ? name.slice(1, -1).replaceAll('""', '"') : name;
}

/** `condition` split at each AND outside parentheses and strings. */
export function conjuncts(condition: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let from = 0;
  for (let i = 0; i < condition.length; i += 1) {
    const c = condition[i];
    if (c === "'") {
      quoted = !quoted;
    } else if (!quoted && c === "(") {
      depth += 1;
    } else if (!quoted && c === ")") {
      depth -= 1;
    } else if (!quoted && depth === 0 && condition.startsWith(" AND ", i)) {
      parts.push(condition.slice(from, i));
      from = i + " AND ".length;
    }
  }
  parts.push(condition.slice(from));
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

/** The column a conjunct compares with a constant, as an index answers, or null. */
export function comparedColumn(conjunct: string): string | null {
  const found = COMPARISON.exec(conjunct);
  if (found === null) {
    return null;
  }
  const [, , column = "", operator = "", value = ""] = found;
  const outsideStrings = value.replace(/'(?:[^']|'')*'/gu, "''");
  if (QUALIFIED.test(outsideStrings)) {
    return null;
  }
  if (operator === "LIKE" && !/^'[^%_']/u.test(value)) {
    return null;
  }
  return unquoted(column);
}

/** The table a scan's detail names, as `ANN.PARTS`. */
function scannedOf(node: PlanNode): Scanned | null {
  const found = /^([^\s.]+|"(?:[^"]|"")+")\.([^\s.]+|"(?:[^"]|"")+")/u.exec(node.detail);
  return found === null ? null : { schema: unquoted(found[1] ?? ""), table: unquoted(found[2] ?? "") };
}

/** Whether `node` reads its table whole: a scan, not by an index. */
function fullScan(node: PlanNode): boolean {
  return node.operator.endsWith("Scan") && !node.operator.startsWith("Index");
}

/** Each scan of `roots` that reads its table whole under a filter, with the columns its filter compares. */
export function filteredScans(roots: readonly PlanNode[]): (Scanned & { readonly columns: readonly string[] })[] {
  return roots.flatMap((node) => {
    const [only] = node.children;
    const here =
      node.operator === "Filter" && node.children.length === 1 && only !== undefined && fullScan(only)
        ? [scannedOf(only)].flatMap((s) =>
            s === null
              ? []
              : [
                  {
                    ...s,
                    columns: conjuncts(node.detail).flatMap((c) => [comparedColumn(c)].filter((x) => x !== null)),
                  },
                ],
          )
        : [];
    return [...here, ...filteredScans(node.children)];
  });
}

/** Whether an index of `t` leads `column`: a btree index of it first, or a hash index of it alone. */
function indexed(t: TableDetail, column: string): boolean {
  return t.indexes.some((i) => {
    const method = i.method.toLowerCase();
    return (
      (method === "btree" && i.columns[0] === column) ||
      (method === "hash" && i.columns.length === 1 && i.columns[0] === column)
    );
  });
}

/** A name of an index of `t`'s `column`, of no index of `t`'s. */
function indexName(t: TableDetail, column: string): string {
  const base = `${t.name}_${column}`.replace(/[^\w$]/gu, "_");
  let name = `${base}_INDEX`;
  for (let n = 2; t.indexes.some((i) => i.name === name); n += 1) {
    name = `${base}_INDEX${String(n)}`;
  }
  return name;
}

/** The tables the physical stage of `plan` reads whole under a filter. */
export function scannedTables(plan: Plan): Scanned[] {
  const physical = plan.stages.find((s) => s.name === "physical");
  const seen = new Set<string>();
  return filteredScans(physical?.roots ?? []).filter((s) => {
    const key = `${s.schema}.${s.table}`;
    const fresh = !seen.has(key) && s.columns.length > 0;
    seen.add(key);
    return fresh;
  });
}

/** The findings of SCAN-NO-INDEX of `plan`, of the tables read, `tables`, each column once. */
export function scanFindings(plan: Plan, tables: readonly TableDetail[], name: Namer): ScanFinding[] {
  const physical = plan.stages.find((s) => s.name === "physical");
  const found = new Map<string, ScanFinding>();
  for (const scan of filteredScans(physical?.roots ?? [])) {
    const t = tables.find((x) => x.schema === scan.schema && x.name === scan.table);
    for (const column of scan.columns) {
      const key = `${scan.schema}.${scan.table}.${column}`;
      if (t === undefined || found.has(key) || indexed(t, column) || !t.columns.some((c) => c.name === column)) {
        continue;
      }
      const index = indexName(t, column);
      const table = `${name(t.schema)}.${name(t.name)}`;
      found.set(key, {
        rule: SCAN_UNINDEXED,
        schema: t.schema,
        table: t.name,
        column,
        says: `The plan reads ${table} whole to compare ${column} with a constant, and no index of the table leads ${column}.`,
        index,
        create: `CREATE INDEX ${name(index)} ON ${table} (${name(column)})`,
        drop: `DROP INDEX ${name(index)}`,
      });
    }
  }
  return [...found.values()];
}
