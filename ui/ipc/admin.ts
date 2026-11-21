/**
 * Administration's commands (RULES.md D57): a view of the server read,
 * and an act run through the connection's guards, its statement written
 * by the backend of what is asked here.
 */
import { invoke } from "@tauri-apps/api/core";
import type { RunAnswer } from "./connections";

/** A view of the server, its database and its sessions. */
export type ViewName =
  | "connections"
  | "connectionAttributes"
  | "server"
  | "jobs"
  | "files"
  | "fileFormats"
  | "memoryReservations"
  | "backups"
  | "archivedSegments"
  | "restorePoints"
  | "replicas"
  | "settings";

/** A view's rows, each cell as text, a null null. */
export interface ViewRows {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | null)[])[];
  /** Whether the database has not the view, as REPLICAS of a node of no replica group. */
  readonly absent: boolean;
}

/** A privilege on a table. */
export type Privilege = "select" | "insert" | "update" | "delete" | "references" | "trigger";

/** A setting's value. */
export type SettingValue =
  { readonly kind: "value"; readonly value: string; readonly integer: boolean } | { readonly kind: "default" };

/** An act of administration; each name SQL as written. */
export type Act =
  | { readonly kind: "endConnection"; readonly id: number }
  | { readonly kind: "cancelConnection"; readonly id: number }
  | { readonly kind: "setSession"; readonly name: string; readonly value: SettingValue }
  | { readonly kind: "setDatabase"; readonly name: string; readonly value: SettingValue }
  | { readonly kind: "createUser"; readonly name: string; readonly password: string }
  | { readonly kind: "changePassword"; readonly name: string; readonly password: string }
  | { readonly kind: "allowCreateRole"; readonly name: string; readonly allowed: boolean }
  | { readonly kind: "dropUser"; readonly name: string }
  | { readonly kind: "createRole"; readonly name: string }
  | { readonly kind: "dropRole"; readonly name: string; readonly cascade: boolean }
  | { readonly kind: "grantRole"; readonly role: string; readonly grantee: string; readonly admin: boolean }
  | { readonly kind: "revokeRole"; readonly role: string; readonly grantee: string; readonly cascade: boolean }
  | {
      readonly kind: "grantPrivileges";
      readonly privileges: readonly Privilege[];
      readonly table: string;
      readonly grantee: string;
      readonly grantOption: boolean;
    }
  | {
      readonly kind: "revokePrivileges";
      readonly privileges: readonly Privilege[];
      readonly table: string;
      readonly grantee: string;
      readonly cascade: boolean;
    };

/** The rows of `view` on `connection`. */
export function adminView(connection: number, view: ViewName): Promise<ViewRows> {
  return invoke<ViewRows>("admin_view", { connection, view });
}

/** Runs `act` on `connection` through its guards: what it gave, or what to confirm, unless `confirmed`. */
export function adminAct(connection: number, act: Act, confirmed: boolean): Promise<RunAnswer> {
  return invoke<RunAnswer>("admin_act", { connection, act, confirmed });
}
