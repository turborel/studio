/**
 * The data commands (RULES.md D43): a file to import chosen by the
 * platform's dialog, previewed, and its rows imported into a table.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Cell, Confirm } from "./connections";

/** How a file to import is read. */
export interface Reading {
  readonly format: "csv" | "tsv";
  readonly header: boolean;
  readonly delimiter: string | null;
  readonly null: string | null;
}

/** A file's first records. */
export interface Preview {
  readonly headings: readonly string[] | null;
  readonly records: readonly (readonly Cell[])[];
}

/** An import: the file, how it is read, the table as SQL writes it, the column of each field or none, the batch, and whether to skip rows refused. */
export interface ImportSpec {
  readonly path: string;
  readonly reading: Reading;
  readonly table: string;
  readonly fields: readonly (string | null)[];
  readonly batch: number;
  readonly skip: boolean;
}

/** What an import did. */
export interface ImportReport {
  readonly rows: number;
  readonly rejected: number;
  readonly skipped: readonly string[];
}

/** What an import answers: its report, or the guards' question. */
export type ImportAnswer =
  { readonly kind: "imported"; readonly answer: ImportReport } | { readonly kind: "confirm"; readonly answer: Confirm };

/** Asks which file to import: its path, or null if the user cancelled. */
export function chooseImportFile(): Promise<string | null> {
  return invoke<string | null>("choose_import_file");
}

/** The first records of `path`, read as `reading` says. */
export function previewImport(path: string, reading: Reading): Promise<Preview> {
  return invoke<Preview>("preview_import", { path, reading });
}

/** Imports the rows `spec` says on `connection`, the guards asked unless `confirmed`. */
export function importRows(connection: number, spec: ImportSpec, confirmed: boolean): Promise<ImportAnswer> {
  return invoke<ImportAnswer>("import_rows", { connection, spec, confirmed });
}
