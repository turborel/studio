/**
 * The application's commands, typed (RULES.md D1, R-SEC-5). The webview
 * reaches the backend through these alone; each name is one the backend's
 * `commands.rs` registers and the window's capability grants.
 */
import { invoke } from "@tauri-apps/api/core";

/** What the About box shows. */
export interface AppInfo {
  /** Studio's version, the Turborel release it is made for. */
  readonly version: string;
  /** The Turborel commit its client library is built from. */
  readonly turborelCommit: string;
  /** The user's home folder, which paths are shown beneath as `~`, if one is known. */
  readonly home: string | null;
}

/** Studio's version and the Turborel commit it is built from. */
export function appInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("app_info");
}
