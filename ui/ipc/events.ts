/**
 * What the backend tells unasked (RULES.md D24): notices, sessions changed
 * and connections lost, the assistant's turns and questions (D55), and
 * Live Sessions' events (D56) and links (D66), the user's asking to quit (D59), and the
 * progress of a `.sql` file (D62) and an import (D63), as the event
 * `studio:event`.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Diagnostics, SessionState, StudioError } from "./connections";
import type { Question, TurnEvent } from "./assistant";
import type { FileProgress, ImportProgress } from "./data";
import type { GuestEvent, HostEvent, LinkOpened } from "./live";

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
  | { readonly kind: "lost"; readonly connection: number; readonly error: StudioError }
  | { readonly kind: "sqlFile"; readonly connection: number; readonly progress: FileProgress }
  | { readonly kind: "import"; readonly connection: number; readonly progress: ImportProgress }
  | { readonly kind: "assistant"; readonly conversation: string; readonly event: TurnEvent }
  | { readonly kind: "assistantAsks"; readonly conversation: string; readonly id: number; readonly question: Question }
  | { readonly kind: "liveHost"; readonly event: HostEvent }
  | { readonly kind: "liveGuest"; readonly event: GuestEvent }
  | { readonly kind: "liveLink"; readonly opened: LinkOpened }
  | { readonly kind: "quitAsked" };

/** Calls `handler` with each event the backend tells, until unlistened. */
export function onStudioEvent(handler: (event: StudioEvent) => void): Promise<UnlistenFn> {
  return listen<StudioEvent>(STUDIO_EVENT, (event) => {
    handler(event.payload);
  });
}
