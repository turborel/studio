/**
 * The commands of embedded databases (RULES.md D59): a database's folder
 * and keys folder chosen by the platform's dialog and looked at first; a
 * database opened, made, or kept in memory; what an embedded connection
 * was given; and Studio's quitting, each open transaction ended as the
 * user answered.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Guards, Opened } from "./connections";

/** Where an embedded database is kept. */
export type Place = { readonly kind: "directory"; readonly path: string } | { readonly kind: "memory" };

/** What opens an embedded database. */
export interface EmbeddedSpec {
  readonly place: Place;
  readonly create: boolean;
  readonly keys: string | null;
  readonly checksumKey: string | null;
  readonly pluginDirectories: string | null;
  readonly user: string | null;
}

/** What a folder holds, as a database's. */
export type Holds = "nothing" | "empty" | "database" | "other";

/** A server found that may serve a database another process holds. */
export type FoundServer =
  { readonly kind: "socket"; readonly path: string } | { readonly kind: "port"; readonly port: number };

/** What a folder chosen holds, looked at before anything is opened or made. */
export interface DirectoryCheck {
  readonly holds: Holds;
  readonly held: boolean;
  readonly server: FoundServer | null;
}

/** A folder chosen, and what it holds. */
export interface DirectoryChoice {
  readonly path: string;
  readonly check: DirectoryCheck;
}

/** A plug-in an embedded database may need: loaded or not, and why. */
export interface PlugIn {
  readonly name: string;
  readonly kind: string;
  readonly loaded: boolean;
  readonly note: string;
}

/** An embedded database, as a connection of it shows it. */
export interface EmbeddedInfo {
  readonly place: Place;
  readonly user: string;
  readonly plugIns: readonly PlugIn[];
}

/** How quitting ends each open transaction. */
export type Ending = "commit" | "rollback";

/** Asks for a database's folder, the dialog titled `title`: none if cancelled. */
export function chooseDatabaseDirectory(title: string): Promise<DirectoryChoice | null> {
  return invoke<DirectoryChoice | null>("choose_database_directory", { title });
}

/** Asks for an encrypted database's keys folder: none if cancelled. */
export function chooseKeysDirectory(): Promise<string | null> {
  return invoke<string | null>("choose_keys_directory");
}

/** What the folder `path`, one chosen, holds now. */
export function checkDatabaseDirectory(path: string): Promise<DirectoryCheck> {
  return invoke<DirectoryCheck>("check_database_directory", { path });
}

/** Opens or makes the embedded database `spec` says, under `guards`. */
export function openEmbedded(spec: EmbeddedSpec, guards: Guards): Promise<Opened> {
  return invoke<Opened>("open_embedded", { spec, guards });
}

/** What the embedded database of `connection` was given; null of a server's. */
export function embeddedInfo(connection: number): Promise<EmbeddedInfo | null> {
  return invoke<EmbeddedInfo | null>("embedded_info", { connection });
}

/** The identifier a new database's owner is offered. */
export function defaultOwner(): Promise<string> {
  return invoke<string>("default_owner");
}

/** Quits Studio, each open transaction ended as `ending` says. */
export function quitStudio(ending: Ending): Promise<null> {
  return invoke<null>("quit_studio", { ending });
}
