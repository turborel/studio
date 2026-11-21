/**
 * The tasks of data and definitions (RULES.md D42 to D45, D62), each a
 * dialog of a table, schema or open connection: its rows edited,
 * imported, exported or compared; a table made or altered; a `.sql` file
 * run on it.
 */

/** A table of an open connection. */
export interface TableOf {
  readonly connection: number;
  readonly schema: string;
  readonly table: string;
}

/** A task's dialog, and what it is of. */
export type DataTask =
  | ({ readonly kind: "editRows" } & TableOf)
  | ({ readonly kind: "import" } & TableOf)
  | { readonly kind: "importNew"; readonly connection: number; readonly schema: string }
  | ({ readonly kind: "export" } & TableOf)
  | ({ readonly kind: "compare" } & TableOf)
  | ({ readonly kind: "alterTable" } & TableOf)
  | { readonly kind: "createTable"; readonly connection: number; readonly schema: string }
  | { readonly kind: "generate"; readonly connection: number; readonly schema: string }
  | { readonly kind: "compareSchemas"; readonly connection: number; readonly schema: string }
  | { readonly kind: "runSqlFile"; readonly connection: number };

/** A name as a delimited identifier. */
export function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** A table's name as SQL writes it, its schema's and its own delimited. */
export function tableSql(of: { readonly schema: string; readonly table: string }): string {
  return `${quoted(of.schema)}.${quoted(of.table)}`;
}

/** Whether `name` is a regular identifier, as Turborel reads one: a letter, then letters, digits and underscores. */
function regular(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*$/u.test(name);
}

/** The column a heading names, as an import reads it: a regular identifier in upper case, else as written. */
export function headingColumn(heading: string): string {
  const name = heading.trim();
  return regular(name) ? name.toUpperCase() : name;
}

/**
 * The column each of a file's `count` fields goes into at first: by its heading's name, if the file has headings,
 * else by its place; null where no column is of it.
 */
export function firstFields(
  headings: readonly string[] | null,
  count: number,
  columns: readonly string[],
): (string | null)[] {
  if (headings === null) {
    return Array.from({ length: count }, (_, i) => columns[i] ?? null);
  }
  return headings.map((h) => {
    const name = headingColumn(h);
    return columns.find((c) => c === name) ?? columns.find((c) => c.toUpperCase() === name.toUpperCase()) ?? null;
  });
}
