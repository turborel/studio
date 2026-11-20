/**
 * The commands of saved connections (RULES.md D28, R-SEC-1). The front end
 * is told whether a password is saved, never the password; one typed goes
 * one way, to the backend.
 */
import { invoke } from "@tauri-apps/api/core";
import type { ConnectionSpec, Environment, Opened } from "./connections";

/** A saved connection. */
export interface SavedConnection {
  readonly id: string;
  readonly name: string;
  readonly folder: readonly string[];
  readonly spec: ConnectionSpec;
  readonly environment: Environment;
  readonly colour: string | null;
  readonly readOnly: boolean;
  readonly pinned: boolean;
}

/** A saved connection, and whether its password is in the keychain. */
export interface SavedView {
  readonly connection: SavedConnection;
  readonly passwordSaved: boolean;
}

/** Every saved connection, and those used last, the latest first. */
export interface SavedList {
  readonly connections: readonly SavedView[];
  readonly recent: readonly string[];
}

/** What a save does with the connection's password. */
export type PasswordChange =
  { readonly kind: "keep" } | { readonly kind: "save"; readonly password: string } | { readonly kind: "forget" };

/** Whether the keychain is open, and why not if not. */
export interface KeychainStatus {
  readonly available: boolean;
  readonly reason: string | null;
}

/** Every saved connection. */
export function listSavedConnections(): Promise<SavedList> {
  return invoke<SavedList>("list_saved_connections");
}

/** Saves a connection, new if its identifier is empty. */
export function saveConnection(connection: SavedConnection, password: PasswordChange): Promise<SavedConnection> {
  return invoke<SavedConnection>("save_connection", { connection, password });
}

/** Deletes a saved connection, and forgets its password. */
export function deleteSavedConnection(id: string): Promise<null> {
  return invoke<null>("delete_saved_connection", { id });
}

/** Opens a saved connection, proving `password` if given, else the keychain's. */
export function openSavedConnection(id: string, password: string | null): Promise<Opened> {
  return invoke<Opened>("open_saved_connection", { id, password });
}

/** Whether the keychain is open. */
export function keychainStatus(): Promise<KeychainStatus> {
  return invoke<KeychainStatus>("keychain_status");
}
