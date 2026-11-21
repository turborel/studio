/**
 * The embedded database dialog's fields, and what they open and save
 * (RULES.md D59): Open Database takes a folder that holds a database, New
 * Database an empty or new one, each looked at before anything is opened
 * or made; a folder another process holds is refused, and its server
 * offered if one was found.
 */
import type { ConnectionSpec, Environment } from "../ipc/connections";
import type { DirectoryCheck, EmbeddedSpec, FoundServer } from "../ipc/embedded";
import type { SavedConnection } from "../ipc/saved";
import { FOLDER_SEPARATOR } from "./connectionForm";

/** Whether the dialog opens a database or makes one. */
export type EmbeddedMode = "open" | "new";

/** The fields of the dialog, each as typed. */
export interface EmbeddedForm {
  readonly id: string;
  readonly mode: EmbeddedMode;
  readonly directory: string;
  readonly name: string;
  readonly folder: string;
  readonly environment: Environment;
  readonly colour: string;
  readonly readOnly: boolean;
  readonly pinned: boolean;
  readonly user: string;
  readonly keys: string;
  readonly checksumKey: string;
  readonly pluginDirectories: string;
  readonly favourites: SavedConnection["favourites"];
}

/** The last part of `path`, as a database's name is offered. */
export function baseName(path: string): string {
  return (
    path
      .split(/[\\/]/u)
      .filter((p) => p !== "")
      .pop() ?? ""
  );
}

/** The fields of a database to open or make, `user` offered as a new one's owner. */
function newEmbeddedForm(mode: EmbeddedMode, user: string): EmbeddedForm {
  return {
    id: "",
    mode,
    directory: "",
    name: "",
    folder: "",
    environment: "development",
    colour: "",
    readOnly: false,
    pinned: false,
    user: mode === "new" ? user : "",
    keys: "",
    checksumKey: "",
    pluginDirectories: "",
    favourites: [],
  };
}

/** The fields of `saved`, or of a database to open or make, `user` offered as a new one's owner. */
export function embeddedFormOf(saved: SavedConnection | null, mode: EmbeddedMode, user: string): EmbeddedForm {
  const e = saved?.embedded;
  if (saved === null || e == null) {
    return newEmbeddedForm(mode, user);
  }
  return {
    ...newEmbeddedForm("open", ""),
    id: saved.id,
    directory: e.directory,
    name: saved.name,
    folder: saved.folder.join(` ${FOLDER_SEPARATOR} `),
    environment: saved.environment,
    colour: saved.colour ?? "",
    readOnly: saved.readOnly,
    pinned: saved.pinned,
    user: e.user ?? "",
    keys: e.keys ?? "",
    checksumKey: e.checksumKey ?? "",
    pluginDirectories: e.pluginDirectories ?? "",
    favourites: saved.favourites,
  };
}

/** `text` trimmed, or null if empty. */
function given(text: string): string | null {
  const t = text.trim();
  return t === "" ? null : t;
}

/** What opens or makes the database of `form`. */
export function embeddedSpecOf(form: EmbeddedForm): EmbeddedSpec {
  return {
    place: { kind: "directory", path: form.directory },
    create: form.mode === "new",
    keys: given(form.keys),
    checksumKey: given(form.checksumKey),
    pluginDirectories: given(form.pluginDirectories),
    user: given(form.user),
  };
}

/** The saved connection of `form`: it opens its database, never makes it. */
export function savedOfEmbedded(form: EmbeddedForm): SavedConnection {
  const spec = embeddedSpecOf(form);
  return {
    id: form.id,
    name: form.name.trim(),
    folder: form.folder
      .split(FOLDER_SEPARATOR)
      .map((f) => f.trim())
      .filter((f) => f !== ""),
    spec: {},
    environment: form.environment,
    colour: form.colour === "" ? null : form.colour.toUpperCase(),
    readOnly: form.readOnly,
    pinned: form.pinned,
    favourites: form.favourites,
    embedded: {
      directory: form.directory,
      keys: spec.keys,
      checksumKey: spec.checksumKey,
      pluginDirectories: spec.pluginDirectories,
      user: spec.user,
    },
  };
}

/** What the dialog tells of a folder looked at: whether it may go on, why not, and a server to offer. */
export interface Judged {
  readonly ok: boolean;
  readonly message: string | null;
  readonly server: FoundServer | null;
}

/** What `check` of the folder `path` means for `mode`. */
export function judge(mode: EmbeddedMode, path: string, check: DirectoryCheck): Judged {
  if (check.held) {
    const where =
      check.server === null
        ? "Connect to the server that serves it, if one does."
        : check.server.kind === "socket"
          ? `A server's socket is in it: connect to that server instead.`
          : `A server answers on this computer's port ${String(check.server.port)}: connect to it instead, if it serves this database.`;
    return {
      ok: false,
      message: `The database in ${path} is open in another process, a server or a program. ${where}`,
      server: check.server,
    };
  }
  const refused = (message: string): Judged => ({ ok: false, message, server: null });
  if (mode === "open") {
    switch (check.holds) {
      case "database":
        return { ok: true, message: null, server: null };
      case "nothing":
        return refused(`There is no folder ${path}.`);
      case "empty":
      case "other":
        return refused(`${path} holds no database. New Database… makes one.`);
    }
  }
  switch (check.holds) {
    case "nothing":
    case "empty":
      return { ok: true, message: null, server: null };
    case "database":
      return refused(`${path} holds a database already. Open Database… opens it.`);
    case "other":
      return refused(`${path} is not empty: a new database is made in an empty or new folder.`);
  }
}

/** The settings that reach the server `server` found on this computer. */
export function serverSpec(server: FoundServer): ConnectionSpec {
  return server.kind === "socket"
    ? { host: server.path }
    : { host: "localhost", port: String(server.port), tlsMode: "verify-full" };
}

/** Why `form` cannot go on, if it cannot: a folder not chosen, or a name or owner missing. */
export function invalidEmbedded(form: EmbeddedForm): string | null {
  if (form.directory === "") {
    return "Choose the database's folder.";
  }
  if (form.name.trim() === "") {
    return "A database needs a name.";
  }
  if (form.mode === "new" && !/^[A-Za-z][A-Za-z0-9_]{0,127}$/u.test(form.user.trim())) {
    return "The owner is letters, digits and underscores, beginning with a letter.";
  }
  return null;
}
