/**
 * The analyzer's and the reports' commands (RULES.md D50, D52): what the
 * analyzer finds of a schema, and the reports, built-in and the user's
 * own, kept and forgotten.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Index } from "./catalog";

/** A setting as INFORMATION_SCHEMA.SETTINGS gives it. */
export interface Setting {
  readonly name: string;
  readonly value: string;
  readonly source: string;
  readonly default: string;
  readonly takesEffect: string;
  readonly description: string;
}

/** A finding of a rule: its identifier, what it is of, what it says, and its fix as SQL. */
export interface Finding {
  readonly rule: string;
  readonly object: string;
  readonly says: string;
  readonly fix: string;
}

/** An index of a schema, with the constraint it serves. */
export interface IndexRow {
  readonly table: string;
  readonly index: Index;
  readonly serves: string | null;
}

/** What the analyzer found of a schema. */
export interface Analysis {
  readonly indexes: readonly IndexRow[];
  readonly findings: readonly Finding[];
  readonly settings: readonly Setting[];
}

/** How a chart draws its rows. */
export type ChartKind = "bar" | "line";

/** A chart of a report's rows: its kind, the column naming its rows, and the columns it draws. */
export interface Chart {
  readonly kind: ChartKind;
  readonly label: string;
  readonly values: readonly string[];
}

/** A report: its query, and its chart, or none to show its rows as a table. */
export interface Report {
  readonly id: string;
  readonly name: string;
  readonly sql: string;
  readonly chart: Chart | null;
}

/** The reports: the built-in, then the user's own. */
export interface ReportList {
  readonly builtIn: readonly Report[];
  readonly own: readonly Report[];
}

/** What the analyzer finds of `schema` on `connection`. */
export function catalogAnalysis(connection: number, schema: string): Promise<Analysis> {
  return invoke<Analysis>("catalog_analysis", { connection, schema });
}

/** The reports. */
export function listReports(): Promise<ReportList> {
  return invoke<ReportList>("list_reports");
}

/** Keeps `report`: the user's reports then. */
export function keepReport(report: Report): Promise<Report[]> {
  return invoke<Report[]>("keep_report", { report });
}

/** Forgets the report `id`: the user's reports then. */
export function forgetReport(id: string): Promise<Report[]> {
  return invoke<Report[]>("forget_report", { id });
}
