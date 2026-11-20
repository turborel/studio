/**
 * What the backend tells unasked (RULES.md D24): notices, sessions changed
 * and connections lost, as the event `studio:event`.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Diagnostics, SessionState, StudioError } from "./connections";

/** The name of the event every backend event comes as. */
export const STUDIO_EVENT = "studio:event";

/** Something the backend tells. */
export type StudioEvent =
  | {
      readonly kind: "notice";
      readonly connection: number;
      readonly sqlstate: string;
      readonly message: string;
      readonly diagnostics: Diagnostics;
    }
  | { readonly kind: "session"; readonly connection: number; readonly session: SessionState }
  | { readonly kind: "lost"; readonly connection: number; readonly error: StudioError };

/** Calls `handler` with each event the backend tells, until unlistened. */
export function onStudioEvent(handler: (event: StudioEvent) => void): Promise<UnlistenFn> {
  return listen<StudioEvent>(STUDIO_EVENT, (event) => {
    handler(event.payload);
  });
}
