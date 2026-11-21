/**
 * The results' commands (RULES.md D39): a large object read whole for a
 * viewer, and a query's rows exported to a file the platform's dialog
 * chooses.
 */
import { invoke } from "@tauri-apps/api/core";

/** A large object read whole, or as far as Studio reads one. */
export type ValueRead =
  | { readonly kind: "text"; readonly text: string; readonly octets: number; readonly cut: boolean }
  | { readonly kind: "binary"; readonly base64: string; readonly octets: number; readonly cut: boolean };

/** How a query's rows are exported. */
export type ExportKind = "csv" | "native";

/** A query's rows exported. */
export interface Exported {
  readonly path: string;
  readonly rows: number;
}

/** The large object of a result's row `row`, column `column`, read whole. */
export function resultValue(connection: number, result: number, row: number, column: number): Promise<ValueRead> {
  return invoke<ValueRead>("result_value", { connection, result, row, column });
}

/** Asks where to export the rows of `sql`, suggesting `name`, and exports them there: null if the user cancelled. */
export function exportQuery(connection: number, sql: string, kind: ExportKind, name: string): Promise<Exported | null> {
  return invoke<Exported | null>("export_query", { request: { connection, sql, kind, name } });
}
