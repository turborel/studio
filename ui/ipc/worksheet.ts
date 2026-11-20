/**
 * The commands of worksheets, typed as the backend gives them (RULES.md
 * D36, R-TS-2): a script split and judged, a statement's parameters, the
 * history, the worksheets and favourite queries kept, and `.sql` files.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Confirm, StatementClass } from "./connections";

/** A statement, classified by Turborel's own parser. */
export interface Classified {
  readonly text: string;
  readonly class: StatementClass;
  readonly destroys: string | null;
  readonly floor: string | null;
  readonly readWrite: boolean;
  readonly connects: boolean;
}

/** A statement of a script, and its place in it, in UTF-16 code units. */
export interface Piece {
  readonly from: number;
  readonly to: number;
  readonly statement: Classified;
}

/** A statement that ran, as the history keeps it. */
export interface HistoryEntry {
  readonly sql: string;
  readonly at: number;
  readonly connection: string;
  readonly saved: string | null;
  readonly millis: number;
  readonly rows: number | null;
  readonly sqlstate: string;
}

/** A worksheet, as kept between sessions. */
export interface KeptWorksheet {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly connection: string | null;
  readonly pinned: boolean;
  readonly path: string | null;
  readonly modified: boolean;
}

/** A favourite query. */
export interface FavouriteQuery {
  readonly id: string;
  readonly name: string;
  readonly sql: string;
}

/** A file read. */
export interface OpenedFile {
  readonly path: string;
  readonly name: string;
  readonly text: string;
}

/** The reserved words of Turborel's SQL. */
export function sqlWords(): Promise<string[]> {
  return invoke<string[]>("sql_words");
}

/** The statements of `text`, each with its place and class. */
export function splitScript(text: string): Promise<Piece[]> {
  return invoke<Piece[]>("split_script", { text });
}

/** What a connection's guards would ask of `sql` before it runs, if anything. */
export function judgeScript(connection: number, sql: string): Promise<Confirm | null> {
  return invoke<Confirm | null>("judge_script", { connection, sql });
}

/** The types of a statement's dynamic parameters, in order. */
export function statementParameters(connection: number, sql: string): Promise<string[]> {
  return invoke<string[]>("statement_parameters", { connection, sql });
}

/** The history's entries holding `text`, the latest first. */
export function searchHistory(text: string, limit: number): Promise<HistoryEntry[]> {
  return invoke<HistoryEntry[]>("search_history", { text, limit });
}

/** Keeps `entry` in the history: whether it was kept. */
export function recordHistory(entry: HistoryEntry): Promise<boolean> {
  return invoke<boolean>("record_history", { entry });
}

/** Forgets the history. */
export function clearHistory(): Promise<null> {
  return invoke<null>("clear_history");
}

/** The worksheets, as last kept. */
export function loadWorksheets(): Promise<KeptWorksheet[]> {
  return invoke<KeptWorksheet[]>("load_worksheets");
}

/** Keeps `worksheets` in place of those kept. */
export function keepWorksheets(worksheets: readonly KeptWorksheet[]): Promise<null> {
  return invoke<null>("keep_worksheets", { worksheets });
}

/** The favourite queries. */
export function listQueries(): Promise<FavouriteQuery[]> {
  return invoke<FavouriteQuery[]>("list_queries");
}

/** Keeps a favourite query: the queries then. */
export function keepQuery(query: FavouriteQuery): Promise<FavouriteQuery[]> {
  return invoke<FavouriteQuery[]>("keep_query", { query });
}

/** Forgets a favourite query: the queries then. */
export function forgetQuery(id: string): Promise<FavouriteQuery[]> {
  return invoke<FavouriteQuery[]>("forget_query", { id });
}

/** Asks which `.sql` file to open, and reads it; null if cancelled. */
export function openSqlFile(): Promise<OpenedFile | null> {
  return invoke<OpenedFile | null>("open_sql_file");
}

/** Reads a file chosen this session, or a project's. */
export function readSqlFile(path: string): Promise<OpenedFile> {
  return invoke<OpenedFile>("read_sql_file", { path });
}

/** Writes a file chosen this session, or a project's. */
export function writeSqlFile(path: string, text: string): Promise<null> {
  return invoke<null>("write_sql_file", { path, text });
}

/** The project folders. */
export function projectFolders(): Promise<string[]> {
  return invoke<string[]>("project_folders");
}

/** Asks which folder to keep as a project: the folders then, or null if cancelled. */
export function addProjectFolder(): Promise<string[] | null> {
  return invoke<string[] | null>("add_project_folder");
}

/** Lets a project folder go: the folders then. */
export function removeProjectFolder(folder: string): Promise<string[]> {
  return invoke<string[]>("remove_project_folder", { folder });
}

/** The `.sql` files of a project folder, by their paths within it. */
export function projectFiles(folder: string): Promise<string[]> {
  return invoke<string[]>("project_files", { folder });
}

/** Tells the user, by the platform's notification, that a run has finished. */
export function notifyFinished(title: string, body: string): Promise<null> {
  return invoke<null>("notify_finished", { title, body });
}
