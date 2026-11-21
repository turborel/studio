/**
 * The DDL the table dialogs write (RULES.md D44), as CREATE TABLE and
 * ALTER TABLE take it ([DOC sql/statements/create-table.md SYNOPSIS],
 * [DOC sql/statements/alter-table.md SYNOPSIS]): each name written as
 * Turborel reads it back, each type and default as the user wrote it.
 */
import { sqlName } from "../worksheet/dialect";

/** A column as the dialogs define one. */
export interface ColumnSpec {
  readonly name: string;
  /** Its data type, as SQL writes it. */
  readonly type: string;
  readonly notNull: boolean;
  /** Its default, as SQL writes it; empty for none. */
  readonly default: string;
  readonly primaryKey: boolean;
  readonly unique: boolean;
}

/** A referential action. */
export type Action = "NO ACTION" | "RESTRICT" | "CASCADE" | "SET NULL" | "SET DEFAULT";

/** A table constraint as the dialogs define one. */
export type ConstraintSpec =
  | { readonly kind: "primaryKey" | "unique"; readonly name: string; readonly columns: readonly string[] }
  | { readonly kind: "check"; readonly name: string; readonly condition: string }
  | {
      readonly kind: "foreignKey";
      readonly name: string;
      readonly columns: readonly string[];
      readonly table: string;
      readonly references: readonly string[];
      readonly onDelete: Action;
    };

/** A table as the create dialog defines it. */
export interface TableSpec {
  readonly schema: string;
  readonly name: string;
  readonly columns: readonly ColumnSpec[];
  readonly constraints: readonly ConstraintSpec[];
}

/** How names are written: bare where Turborel reads them back so, else delimited. */
export type Namer = (name: string) => string;

/** A namer of `reserved` words. */
export function namer(reserved: readonly string[]): Namer {
  const words = new Set(reserved);
  return (name) => sqlName(name, words);
}

/** A column's definition. */
export function columnDefinition(c: ColumnSpec, name: Namer): string {
  const parts = [name(c.name), c.type.trim()];
  if (c.default.trim() !== "") {
    parts.push(`DEFAULT ${c.default.trim()}`);
  }
  if (c.notNull) {
    parts.push("NOT NULL");
  }
  if (c.primaryKey) {
    parts.push("PRIMARY KEY");
  } else if (c.unique) {
    parts.push("UNIQUE");
  }
  return parts.join(" ");
}

/** A list of names, in parentheses. */
function names(list: readonly string[], name: Namer): string {
  return `(${list.map(name).join(", ")})`;
}

/** A table constraint's definition. */
export function constraintDefinition(c: ConstraintSpec, name: Namer): string {
  const named = c.name.trim() === "" ? "" : `CONSTRAINT ${name(c.name.trim())} `;
  switch (c.kind) {
    case "primaryKey":
      return `${named}PRIMARY KEY ${names(c.columns, name)}`;
    case "unique":
      return `${named}UNIQUE ${names(c.columns, name)}`;
    case "check":
      return `${named}CHECK (${c.condition.trim()})`;
    case "foreignKey": {
      const referenced = c.references.length === 0 ? "" : ` ${names(c.references, name)}`;
      const action = c.onDelete === "NO ACTION" ? "" : ` ON DELETE ${c.onDelete}`;
      return `${named}FOREIGN KEY ${names(c.columns, name)} REFERENCES ${c.table.trim()}${referenced}${action}`;
    }
  }
}

/** A table's qualified name. */
export function qualified(schema: string, table: string, name: Namer): string {
  return `${name(schema)}.${name(table)}`;
}

/** The CREATE TABLE of `spec`, an element a line. */
export function createTableSql(spec: TableSpec, name: Namer): string {
  const elements = [
    ...spec.columns.map((c) => columnDefinition(c, name)),
    ...spec.constraints.map((c) => constraintDefinition(c, name)),
  ];
  return `CREATE TABLE ${qualified(spec.schema, spec.name, name)} (\n${elements.map((e) => `    ${e}`).join(",\n")}\n)`;
}

/** What is wrong with `spec`, if anything, before it is written: a name missing, or a column of no name or type. */
export function tableProblem(spec: TableSpec): string | null {
  if (spec.name.trim() === "") {
    return "The table needs a name.";
  }
  if (spec.columns.length === 0) {
    return "The table needs a column.";
  }
  const bad = spec.columns.findIndex((c) => c.name.trim() === "" || c.type.trim() === "");
  if (bad !== -1) {
    return `Column ${String(bad + 1)} needs a name and a type.`;
  }
  const seen = new Set<string>();
  const twice = spec.columns.find((c) => (seen.has(c.name) ? true : (seen.add(c.name), false)));
  return twice === undefined ? null : `Two columns are named ${twice.name}.`;
}

/** A drop's behaviour. */
export type Behavior = "RESTRICT" | "CASCADE";

/** An action of ALTER TABLE, as the alter dialog stages one. */
export type AlterAction =
  | { readonly kind: "addColumn"; readonly column: ColumnSpec }
  | { readonly kind: "dropColumn"; readonly column: string; readonly behavior: Behavior }
  | { readonly kind: "renameColumn"; readonly column: string; readonly to: string }
  | { readonly kind: "setDefault"; readonly column: string; readonly default: string }
  | { readonly kind: "dropDefault"; readonly column: string }
  | { readonly kind: "setNotNull"; readonly column: string }
  | { readonly kind: "dropNotNull"; readonly column: string }
  | { readonly kind: "setDataType"; readonly column: string; readonly type: string }
  | { readonly kind: "addConstraint"; readonly constraint: ConstraintSpec }
  | { readonly kind: "dropConstraint"; readonly constraint: string; readonly behavior: Behavior }
  | { readonly kind: "renameTable"; readonly to: string };

/** The ALTER TABLE of `table` that does `action`: one statement each, as ALTER TABLE takes one action. */
export function alterSql(table: string, action: AlterAction, name: Namer): string {
  const head = `ALTER TABLE ${table}`;
  switch (action.kind) {
    case "addColumn":
      return `${head} ADD COLUMN ${columnDefinition(action.column, name)}`;
    case "dropColumn":
      return `${head} DROP COLUMN ${name(action.column)} ${action.behavior}`;
    case "renameColumn":
      return `${head} RENAME COLUMN ${name(action.column)} TO ${name(action.to)}`;
    case "setDefault":
      return `${head} ALTER COLUMN ${name(action.column)} SET DEFAULT ${action.default.trim()}`;
    case "dropDefault":
      return `${head} ALTER COLUMN ${name(action.column)} DROP DEFAULT`;
    case "setNotNull":
      return `${head} ALTER COLUMN ${name(action.column)} SET NOT NULL`;
    case "dropNotNull":
      return `${head} ALTER COLUMN ${name(action.column)} DROP NOT NULL`;
    case "setDataType":
      return `${head} ALTER COLUMN ${name(action.column)} SET DATA TYPE ${action.type.trim()}`;
    case "addConstraint":
      return `${head} ADD ${constraintDefinition(action.constraint, name)}`;
    case "dropConstraint":
      return `${head} DROP CONSTRAINT ${name(action.constraint)} ${action.behavior}`;
    case "renameTable":
      return `${head} RENAME TO ${name(action.to)}`;
  }
}

/** The script of `actions` on `table`, a statement each, each ended by a semicolon. */
export function alterScript(table: string, actions: readonly AlterAction[], name: Namer): string {
  return actions.map((a) => `${alterSql(table, a, name)};`).join("\n");
}
