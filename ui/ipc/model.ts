/**
 * The model's commands (RULES.md D46, D64): a model's file opened by the
 * platform's dialog, an image saved where the dialog chooses, and a DDL
 * script run into an in-memory database to read a model of.
 */
import { invoke } from "@tauri-apps/api/core";
import type { OpenedFile } from "./worksheet";

/** Asks which model to open, and reads it: null if the user cancelled. */
export function openModelFile(): Promise<OpenedFile | null> {
  return invoke<OpenedFile | null>("open_model_file");
}

/** A statement of a DDL script left out of its model: its line, its text, and why. */
export interface LeftOut {
  readonly line: number;
  readonly statement: string;
  readonly why: string;
}

/** A DDL script run into an in-memory database: the connection to read its model of, then close; its schemas; and what was left out. */
export interface DdlModel {
  readonly connection: number;
  readonly schemas: readonly string[];
  readonly statements: number;
  readonly leftOut: readonly LeftOut[];
  readonly leftOutCount: number;
}

/** Imports the DDL script `path`, one chosen, into an in-memory database, its unqualified names of `schema`. */
export function ddlModel(path: string, schema: string): Promise<DdlModel> {
  return invoke<DdlModel>("ddl_model", { path, schema });
}

/** Asks where to save `octets`, Base64, suggesting `name`: the path written, or null if the user cancelled. */
export function saveBinaryFile(name: string, octets: string): Promise<string | null> {
  return invoke<string | null>("save_binary_file", { name, octets });
}
