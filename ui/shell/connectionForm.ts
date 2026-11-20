/**
 * The connection dialog's fields, and the saved connection and settings
 * they make (RULES.md D28): each setting a field of turborel-client's by
 * its name; a field left empty is no setting, so the layers below give it.
 */
import type { ConnectionSpec, Environment } from "../ipc/connections";
import type { PasswordChange, SavedConnection } from "../ipc/saved";

/** The fields of the dialog, each as typed. */
export interface ConnectionForm {
  readonly id: string;
  readonly name: string;
  readonly folder: string;
  readonly environment: Environment;
  readonly colour: string;
  readonly readOnly: boolean;
  readonly pinned: boolean;
  readonly spec: Readonly<Record<SpecField, string>>;
  readonly password: string;
  readonly savePassword: boolean;
  readonly favourites: SavedConnection["favourites"];
}

/** The settings' fields, as the dialog names them. */
export const SPEC_FIELDS = [
  "uri",
  "host",
  "port",
  "user",
  "tlsMode",
  "tlsRoots",
  "tlsSystemRoots",
  "tlsCertificate",
  "tlsKey",
  "serverName",
  "channelBinding",
  "service",
  "serviceFile",
  "passfile",
  "target",
  "loadBalance",
  "connectTimeout",
] as const;

/** A setting's field. */
export type SpecField = (typeof SPEC_FIELDS)[number];

/** What separates the folders of a folder's path, as typed. */
export const FOLDER_SEPARATOR = "/";

/** The TLS mode a new connection is given: verified (RULES.md D26). */
export const NEW_TLS_MODE = "verify-full";

/** The fields of a new connection. */
function newForm(): ConnectionForm {
  const spec = Object.fromEntries(SPEC_FIELDS.map((f) => [f, ""])) as Record<SpecField, string>;
  return {
    id: "",
    name: "",
    folder: "",
    environment: "development",
    colour: "",
    readOnly: false,
    pinned: false,
    spec: { ...spec, tlsMode: NEW_TLS_MODE },
    password: "",
    savePassword: false,
    favourites: [],
  };
}

/** The fields of `saved`, or of a new connection. */
export function formOf(saved: SavedConnection | null): ConnectionForm {
  if (saved === null) {
    return newForm();
  }
  const spec = Object.fromEntries(SPEC_FIELDS.map((f) => [f, saved.spec[f] ?? ""])) as Record<SpecField, string>;
  return {
    ...newForm(),
    id: saved.id,
    name: saved.name,
    folder: saved.folder.join(` ${FOLDER_SEPARATOR} `),
    environment: saved.environment,
    colour: saved.colour ?? "",
    readOnly: saved.readOnly,
    pinned: saved.pinned,
    favourites: saved.favourites,
    spec,
  };
}

/** The settings of `form`, its empty fields left out. */
export function specOf(form: ConnectionForm): ConnectionSpec {
  const spec: Record<string, string> = {};
  for (const field of SPEC_FIELDS) {
    const value = form.spec[field].trim();
    if (value !== "") {
      spec[field] = value;
    }
  }
  return spec;
}

/** The saved connection of `form`. */
export function savedOf(form: ConnectionForm): SavedConnection {
  return {
    id: form.id,
    name: form.name.trim(),
    folder: form.folder
      .split(FOLDER_SEPARATOR)
      .map((f) => f.trim())
      .filter((f) => f !== ""),
    spec: specOf(form),
    environment: form.environment,
    colour: form.colour === "" ? null : form.colour.toUpperCase(),
    readOnly: form.readOnly,
    pinned: form.pinned,
    favourites: form.favourites,
  };
}

/** What saving `form` does with its password: saves one typed if asked, else keeps what is saved. */
export function passwordChangeOf(form: ConnectionForm): PasswordChange {
  return form.savePassword && form.password !== "" ? { kind: "save", password: form.password } : { kind: "keep" };
}

/** Why `form` cannot be saved, if it cannot. */
export function invalid(form: ConnectionForm): string | null {
  if (form.name.trim() === "") {
    return "A connection needs a name.";
  }
  if (form.spec.uri.trim() === "" && form.spec.user.trim() === "" && form.spec.service.trim() === "") {
    return "Give a URI, a user or a service.";
  }
  return null;
}
