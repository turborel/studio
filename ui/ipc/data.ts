/**
 * The data commands (RULES.md D43, D62): a file to import chosen by the
 * platform's dialog, previewed, and its rows imported into a table; a
 * `.sql` file scanned, run, cancelled, and its log saved.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Cell, Confirm, StatementClass } from "./connections";

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

/** How a file's text is encoded. */
export type Encoding = "utf8" | "utf16Le" | "utf16Be";

/** A statement of a file a scan lists: its line, and what it is. */
export interface Listed {
  readonly line: number;
  readonly what: string;
}

/** What a `.sql` file holds, as a scan found it (RULES.md D62). */
export interface Scan {
  readonly bytes: number;
  readonly encoding: Encoding;
  readonly statements: number;
  readonly classes: Readonly<Partial<Record<StatementClass, number>>>;
  readonly destroys: readonly Listed[];
  readonly destroysCount: number;
  readonly unclassified: readonly Listed[];
  readonly unclassifiedCount: number;
  readonly firstWrite: Listed | null;
  readonly readWrite: Listed | null;
  readonly connects: Listed | null;
}

/** How a file's statements are made transactions. */
export type Transactions =
  { readonly kind: "autocommit" } | { readonly kind: "whole" } | { readonly kind: "every"; readonly every: number };

/** How a file is run. */
export interface FileOptions {
  readonly transactions: Transactions;
  readonly stopOnError: boolean;
}

/** A statement of a file that failed. */
export interface FileFailure {
  readonly number: number;
  readonly line: number;
  readonly sqlstate: string;
  readonly sqlcode: number;
  readonly message: string;
  readonly statement: string;
}

/** What a run of a file did. */
export interface FileReport {
  readonly ending: "finished" | "stopped" | "cancelled";
  readonly statements: number;
  readonly rowsAffected: number;
  readonly failed: number;
  readonly log: readonly FileFailure[];
  readonly rolledBack: boolean;
  readonly millis: number;
}

/** How far a run of a file has come. */
export interface FileProgress {
  readonly statements: number;
  readonly bytes: number;
  readonly total: number;
  readonly failed: number;
}

/** What running a file answers: what it did, or the guards' question and the scan they judged. */
export type FileAnswer =
  | { readonly kind: "ran"; readonly report: FileReport }
  | { readonly kind: "confirm"; readonly confirm: Confirm; readonly scan: Scan };

/** Asks which `.sql` file to run: its path, or null if the user cancelled. */
export function chooseSqlFile(): Promise<string | null> {
  return invoke<string | null>("choose_sql_file");
}

/** What `path` holds, and what `connection`'s guards would ask of it. */
export function scanSqlFile(connection: number, path: string): Promise<[Scan, Confirm | null]> {
  return invoke<[Scan, Confirm | null]>("scan_sql_file", { connection, path });
}

/** Runs `path` on `connection` as `options` say, the guards asked unless `confirmed`. */
export function runSqlFile(
  connection: number,
  path: string,
  options: FileOptions,
  confirmed: boolean,
): Promise<FileAnswer> {
  return invoke<FileAnswer>("run_sql_file", { connection, path, options, confirmed });
}

/** Cancels the file running on `connection`. */
export function cancelSqlFile(connection: number): Promise<void> {
  return invoke<undefined>("cancel_sql_file", { connection });
}

/** Saves the log of `report`, a run of `path`, where the platform's dialog chooses: the path, or null. */
export function saveSqlFileLog(path: string, report: FileReport): Promise<string | null> {
  return invoke<string | null>("save_sql_file_log", { path, report });
}
