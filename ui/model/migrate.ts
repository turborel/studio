/**
 * The DDL that takes a schema to a model (RULES.md D47): of each table of
 * the model the schema lacks, a CREATE TABLE; of each table the model
 * lacks, a DROP TABLE … RESTRICT; of each table of both, an ALTER TABLE of
 * each column added, dropped or changed and of each constraint added or
 * dropped; and CREATE INDEX and DROP INDEX of the indexes that differ, as
 * main's statements write them ([DOC sql/statements/alter-table.md SYNOPSIS],
 * [DOC sql/statements/create-index.md SYNOPSIS]). Constraints and indexes
 * are matched by what they are, not by their names.
 */
import type { Namer } from "../data/ddl";
import type { Model, ModelCheck, ModelColumn, ModelForeignKey, ModelIndex, ModelKey, ModelTable } from "./model";
import { tableKey } from "./model";

/** A difference between a model and a schema, as the compare lists it. */
export interface Difference {
  /** The table it is of. */
  readonly table: string;
  /** What differs, in words. */
  readonly what: string;
}

/** The statements of a migration, in the order they run, and what they change. */
export interface Migration {
  readonly statements: readonly string[];
  readonly differences: readonly Difference[];
}

/** The other names of types, each with the name the Information Schema gives it. */
const SYNONYMS: readonly (readonly [RegExp, string])[] = [
  [/^VARCHAR\b/u, "CHARACTER VARYING"],
  [/^CHAR VARYING\b/u, "CHARACTER VARYING"],
  [/^CHAR\b/u, "CHARACTER"],
  [/^INT\b/u, "INTEGER"],
  [/^DEC\b/u, "DECIMAL"],
  [/^VARBINARY\b/u, "BINARY VARYING"],
  [/^CLOB\b/u, "CHARACTER LARGE OBJECT"],
  [/^BLOB\b/u, "BINARY LARGE OBJECT"],
  [/^DOUBLE$/u, "DOUBLE PRECISION"],
];

/** `type` written as the Information Schema writes it: in upper case, its spaces single, by its standard name. */
function normalType(type: string): string {
  const plain = type.trim().toUpperCase().replaceAll(/\s+/gu, " ").replaceAll(" (", "(");
  const found = SYNONYMS.find(([word]) => word.test(plain));
  return found === undefined ? plain : plain.replace(found[0], found[1]);
}

/** Whether `a` and `b` are the same type: the same by their standard names, or of one name where one gives no length. */
export function sameType(a: string, b: string): boolean {
  const [x, y] = [normalType(a), normalType(b)];
  const base = (t: string) => t.replace(/\(.*\)$/u, "");
  return x === y || (base(x) === base(y) && (x === base(x) || y === base(y)));
}

/** A table's name as SQL writes it. */
function tableName(t: { readonly schema: string; readonly name: string }, name: Namer): string {
  return `${name(t.schema)}.${name(t.name)}`;
}

/** A column's definition. */
export function columnSql(c: ModelColumn, name: Namer): string {
  return `${name(c.name)} ${c.type}${c.default === null ? "" : ` DEFAULT ${c.default}`}${c.notNull ? " NOT NULL" : ""}`;
}

/** A list of names, in parentheses. */
function list(columns: readonly string[], name: Namer): string {
  return `(${columns.map(name).join(", ")})`;
}

/** A constraint's name clause, if it has a name. */
function constraintName(n: string | null, name: Namer): string {
  return n === null ? "" : `CONSTRAINT ${name(n)} `;
}

/** A primary key or unique constraint's definition. */
function keySql(k: ModelKey, word: string, name: Namer): string {
  return `${constraintName(k.name, name)}${word} ${list(k.columns, name)}`;
}

/** A check's definition. */
function checkSql(c: ModelCheck, name: Namer): string {
  return `${constraintName(c.name, name)}CHECK (${c.condition})`;
}

/** A foreign key's definition. */
function foreignSql(f: ModelForeignKey, name: Namer): string {
  const rules = `${f.onUpdate === "NO ACTION" ? "" : ` ON UPDATE ${f.onUpdate}`}${f.onDelete === "NO ACTION" ? "" : ` ON DELETE ${f.onDelete}`}`;
  const to = `${name(f.references.schema)}.${name(f.references.table)} ${list(f.references.columns, name)}`;
  return `${constraintName(f.name, name)}FOREIGN KEY ${list(f.columns, name)} REFERENCES ${to}${rules}`;
}

/** An index's CREATE INDEX. */
function indexSql(t: ModelTable, i: ModelIndex, name: Namer): string {
  const using = i.method.toLowerCase() === "btree" ? "" : ` USING ${i.method.toLowerCase()}`;
  return `CREATE INDEX ${name(i.name)} ON ${tableName(t, name)} ${list(i.columns, name)}${using};`;
}

/** The CREATE TABLE of `t`, of its columns, keys and checks; its foreign keys are added after every table is made. */
export function createSql(t: ModelTable, name: Namer): string {
  const elements = [
    ...t.columns.map((c) => columnSql(c, name)),
    ...(t.primaryKey === null ? [] : [keySql(t.primaryKey, "PRIMARY KEY", name)]),
    ...t.uniques.map((u) => keySql(u, "UNIQUE", name)),
    ...t.checks.map((c) => checkSql(c, name)),
  ];
  return `CREATE TABLE ${tableName(t, name)} (\n${elements.map((e) => `    ${e}`).join(",\n")}\n);`;
}

/** A key's identity: its columns. */
function keyId(k: ModelKey): string {
  return k.columns.join(",");
}

/** A check's identity: its condition, its spaces collapsed. */
function checkId(c: ModelCheck): string {
  return c.condition.replaceAll(/\s+/gu, " ").trim();
}

/** A foreign key's identity: its columns, what it references and its rules. */
function foreignId(f: ModelForeignKey): string {
  return JSON.stringify([
    f.columns,
    f.references.schema,
    f.references.table,
    f.references.columns,
    f.onDelete,
    f.onUpdate,
  ]);
}

/** An index's identity: its columns and method. */
function indexId(i: ModelIndex): string {
  return JSON.stringify([i.columns, i.method.toLowerCase()]);
}

/** The items of `ours` that `theirs` lacks, by identity. */
function lacking<T>(ours: readonly T[], theirs: readonly T[], id: (t: T) => string): T[] {
  const have = new Set(theirs.map(id));
  return ours.filter((o) => !have.has(id(o)));
}

/** The statements, by when they run. */
class Steps {
  readonly dropForeign: string[] = [];
  readonly dropIndex: string[] = [];
  readonly dropConstraint: string[] = [];
  readonly dropTable: string[] = [];
  readonly create: string[] = [];
  readonly columns: string[] = [];
  readonly addConstraint: string[] = [];
  readonly addForeign: string[] = [];
  readonly createIndex: string[] = [];
  readonly differences: Difference[] = [];

  /** Every statement, in the order they run. */
  all(): string[] {
    return [
      ...this.dropForeign,
      ...this.dropIndex,
      ...this.dropConstraint,
      ...this.dropTable,
      ...this.create,
      ...this.columns,
      ...this.addConstraint,
      ...this.addForeign,
      ...this.createIndex,
    ];
  }
}

/** The changes of `t`'s columns to `want`'s. */
function columnSteps(steps: Steps, { want, have }: { want: ModelTable; have: ModelTable }, name: Namer): void {
  const alter = `ALTER TABLE ${tableName(want, name)}`;
  const label = tableKey(want);
  for (const c of want.columns) {
    const old = have.columns.find((h) => h.name === c.name);
    if (old === undefined) {
      steps.columns.push(`${alter} ADD COLUMN ${columnSql(c, name)};`);
      steps.differences.push({ table: label, what: `column ${c.name} is added` });
      continue;
    }
    const column = `${alter} ALTER COLUMN ${name(c.name)}`;
    if (!sameType(old.type, c.type)) {
      steps.columns.push(`${column} SET DATA TYPE ${c.type};`);
      steps.differences.push({ table: label, what: `column ${c.name}'s type is ${c.type}, not ${old.type}` });
    }
    if (old.default !== c.default) {
      steps.columns.push(c.default === null ? `${column} DROP DEFAULT;` : `${column} SET DEFAULT ${c.default};`);
      steps.differences.push({ table: label, what: `column ${c.name}'s default is ${c.default ?? "none"}` });
    }
    if (old.notNull !== c.notNull) {
      steps.columns.push(`${column} ${c.notNull ? "SET" : "DROP"} NOT NULL;`);
      steps.differences.push({ table: label, what: `column ${c.name} is ${c.notNull ? "" : "not "}NOT NULL` });
    }
  }
  for (const c of lacking(have.columns, want.columns, (x) => x.name)) {
    steps.columns.push(`${alter} DROP COLUMN ${name(c.name)} RESTRICT;`);
    steps.differences.push({ table: label, what: `column ${c.name} is dropped` });
  }
}

/** A constraint of a table, by what it is: its name, its definition and its identity. */
interface Kept {
  readonly name: string | null;
  readonly sql: string;
  readonly id: string;
  readonly foreign: boolean;
}

/** `t`'s constraints but NOT NULL, each as kept. */
function constraintsOf(t: ModelTable, name: Namer): Kept[] {
  return [
    ...(t.primaryKey === null
      ? []
      : [
          {
            name: t.primaryKey.name,
            sql: keySql(t.primaryKey, "PRIMARY KEY", name),
            id: `P${keyId(t.primaryKey)}`,
            foreign: false,
          },
        ]),
    ...t.uniques.map((u) => ({ name: u.name, sql: keySql(u, "UNIQUE", name), id: `U${keyId(u)}`, foreign: false })),
    ...t.checks.map((c) => ({ name: c.name, sql: checkSql(c, name), id: `C${checkId(c)}`, foreign: false })),
    ...t.foreignKeys.map((f) => ({ name: f.name, sql: foreignSql(f, name), id: `F${foreignId(f)}`, foreign: true })),
  ];
}

/** The changes of a table's constraints and indexes, from `have`'s to `want`'s. */
function constraintSteps(steps: Steps, { want, have }: { want: ModelTable; have: ModelTable }, name: Namer): void {
  const alter = `ALTER TABLE ${tableName(want, name)}`;
  const label = tableKey(want);
  const wanted = constraintsOf(want, name);
  const had = constraintsOf(have, name);
  for (const c of lacking(had, wanted, (k) => k.id)) {
    (c.foreign ? steps.dropForeign : steps.dropConstraint).push(
      `${alter} DROP CONSTRAINT ${name(c.name ?? "")} RESTRICT;`,
    );
    steps.differences.push({ table: label, what: `constraint ${c.name ?? ""} is dropped` });
  }
  for (const c of lacking(wanted, had, (k) => k.id)) {
    (c.foreign ? steps.addForeign : steps.addConstraint).push(`${alter} ADD ${c.sql};`);
    steps.differences.push({ table: label, what: `${c.sql} is added` });
  }
  for (const i of lacking(have.indexes, want.indexes, indexId)) {
    steps.dropIndex.push(`DROP INDEX ${name(i.name)};`);
    steps.differences.push({ table: label, what: `index ${i.name} is dropped` });
  }
  for (const i of lacking(want.indexes, have.indexes, indexId)) {
    steps.createIndex.push(indexSql(want, i, name));
    steps.differences.push({ table: label, what: `index ${i.name} is made` });
  }
}

/** A table made: its CREATE TABLE, its foreign keys added after, and its indexes. */
function createSteps(steps: Steps, t: ModelTable, name: Namer): void {
  steps.create.push(createSql(t, name));
  steps.addForeign.push(...t.foreignKeys.map((f) => `ALTER TABLE ${tableName(t, name)} ADD ${foreignSql(f, name)};`));
  steps.createIndex.push(...t.indexes.map((i) => indexSql(t, i, name)));
  steps.differences.push({ table: tableKey(t), what: "the table is made" });
}

/** The migration that takes the schema whose tables `actual` holds to the model `desired`. */
export function migration(desired: Model, actual: Model, name: Namer): Migration {
  const steps = new Steps();
  const have = new Map(actual.tables.map((t) => [tableKey(t), t]));
  for (const want of desired.tables) {
    const old = have.get(tableKey(want));
    if (old === undefined) {
      createSteps(steps, want, name);
    } else {
      columnSteps(steps, { want, have: old }, name);
      constraintSteps(steps, { want, have: old }, name);
    }
  }
  for (const t of lacking(actual.tables, desired.tables, tableKey)) {
    steps.dropTable.push(`DROP TABLE ${tableName(t, name)} RESTRICT;`);
    steps.differences.push({ table: tableKey(t), what: "the table is dropped" });
  }
  return { statements: steps.all(), differences: steps.differences };
}
