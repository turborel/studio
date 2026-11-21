/**
 * A model's table as the table forms edit it (RULES.md D46): its columns
 * of the create dialog's columns, a key of one column marked on the
 * column, a key of several, and each unique, check and foreign key, as a
 * constraint; and back.
 */
import type { Action, ColumnSpec, ConstraintSpec } from "../data/ddl";
import type { ModelForeignKey, ModelKey, ModelTable } from "./model";

/** A model's table as the forms edit it. */
export interface TableForm {
  readonly schema: string;
  readonly name: string;
  readonly columns: readonly ColumnSpec[];
  readonly constraints: readonly ConstraintSpec[];
  /** The indexes, each its name, its columns written between commas, and its method. */
  readonly indexes: readonly { readonly name: string; readonly columns: string; readonly method: string }[];
}

/** Whether `key` is of the one column `column`. */
function onlyOf(key: ModelKey | null | undefined, column: string): boolean {
  return key?.columns.length === 1 && key.columns[0] === column;
}

/** `t` as the forms edit it. */
export function formOf(t: ModelTable): TableForm {
  const primary = t.primaryKey;
  const single = (k: ModelKey) => k.columns.length === 1;
  return {
    schema: t.schema,
    name: t.name,
    columns: t.columns.map((c) => ({
      name: c.name,
      type: c.type,
      notNull: c.notNull,
      default: c.default ?? "",
      primaryKey: onlyOf(primary, c.name),
      unique: t.uniques.some((u) => onlyOf(u, c.name)),
    })),
    constraints: [
      ...(primary === null || single(primary)
        ? []
        : [{ kind: "primaryKey" as const, name: primary.name ?? "", columns: primary.columns }]),
      ...t.uniques
        .filter((u) => !single(u))
        .map((u) => ({ kind: "unique" as const, name: u.name ?? "", columns: u.columns })),
      ...t.checks.map((c) => ({ kind: "check" as const, name: c.name ?? "", condition: c.condition })),
      ...t.foreignKeys.map((f) => ({
        kind: "foreignKey" as const,
        name: f.name ?? "",
        columns: f.columns,
        table: `${f.references.schema}.${f.references.table}`,
        references: f.references.columns,
        onDelete: f.onDelete as Action,
      })),
    ],
    indexes: t.indexes.map((i) => ({ name: i.name, columns: i.columns.join(", "), method: i.method })),
  };
}

/** A name, or none for an empty one. */
function nameOrNone(name: string): string | null {
  return name.trim() === "" ? null : name.trim();
}

/** The foreign key of `c`, its table written SCHEMA.TABLE or TABLE of `schema`. */
function foreignOf(
  c: Extract<ConstraintSpec, { kind: "foreignKey" }>,
  schema: string,
  kept: readonly ModelForeignKey[],
): ModelForeignKey {
  const [first = "", second] = c.table.split(".").map((p) => p.trim());
  const to = second === undefined ? { schema, table: first } : { schema: first, table: second };
  const onUpdate = kept.find((k) => k.name === nameOrNone(c.name))?.onUpdate ?? "NO ACTION";
  return {
    name: nameOrNone(c.name),
    columns: c.columns,
    references: { ...to, columns: c.references },
    onDelete: c.onDelete,
    onUpdate,
  };
}

/** The model's table of `form`, kept where `old` was drawn. */
export function tableOf(form: TableForm, old: ModelTable | null): ModelTable {
  const keyColumns = form.columns.filter((c) => c.primaryKey).map((c) => c.name);
  const keys = form.constraints.flatMap((c) =>
    c.kind === "primaryKey" ? [{ name: nameOrNone(c.name), columns: c.columns }] : [],
  );
  const primary: ModelKey | null = keyColumns.length > 0 ? { name: null, columns: keyColumns } : (keys[0] ?? null);
  return {
    schema: form.schema.trim(),
    name: form.name.trim(),
    columns: form.columns.map((c) => ({
      name: c.name,
      type: c.type,
      notNull: c.notNull || c.primaryKey,
      default: nameOrNone(c.default),
    })),
    primaryKey: primary,
    uniques: [
      ...form.columns.filter((c) => c.unique && !c.primaryKey).map((c) => ({ name: null, columns: [c.name] })),
      ...form.constraints.flatMap((c) =>
        c.kind === "unique" ? [{ name: nameOrNone(c.name), columns: c.columns }] : [],
      ),
    ],
    checks: form.constraints.flatMap((c) =>
      c.kind === "check" ? [{ name: nameOrNone(c.name), condition: c.condition }] : [],
    ),
    foreignKeys: form.constraints.flatMap((c) =>
      c.kind === "foreignKey" ? [foreignOf(c, form.schema.trim(), old?.foreignKeys ?? [])] : [],
    ),
    indexes: form.indexes
      .filter((i) => i.name.trim() !== "")
      .map((i) => ({
        name: i.name.trim(),
        columns: i.columns
          .split(",")
          .map((n) => n.trim())
          .filter((n) => n !== ""),
        method: i.method,
      })),
    position: old?.position ?? null,
  };
}
