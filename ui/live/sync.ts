/**
 * The workspace kept shared (RULES.md D56): while this Studio presents,
 * the tabs picked are read a few times a second, and sent when they
 * changed, the backend filtering them before they leave; and where the
 * presenter's pointer is over a tab shared, its place in it.
 */
import { useEffect } from "react";
import { livePublish } from "../ipc/live";
import type { Store } from "../state/store";
import { changeLive, presenting, said, workspaceOf } from "./live";

/** How often the workspace is read, in milliseconds. */
export const SYNC_MS = 250;
/** How often the pointer is told, at most, in milliseconds. */
const POINTER_MS = 100;

/** Sends the workspace each `SYNC_MS` it changed, while this Studio presents. */
export function useLiveSync(store: Store): void {
  useEffect(() => {
    let last = "";
    let busy = false;
    const timer = setInterval(() => {
      const now = store.current();
      if (!presenting(now.live)) {
        last = "";
        return;
      }
      const workspace = workspaceOf(now);
      const text = JSON.stringify(workspace);
      if (busy || text === last) {
        return;
      }
      last = text;
      busy = true;
      livePublish(workspace)
        .catch((thrown: unknown) => {
          changeLive(store, (l) => ({ ...l, told: said(thrown) }));
        })
        .finally(() => {
          busy = false;
        });
    }, SYNC_MS);
    return () => {
      clearInterval(timer);
    };
  }, [store]);
}

/** The handlers that tell where the pointer is over tab `id`'s element, while it is shared and this Studio presents. */
export function pointerOf(
  store: Store,
  id: string,
): { onMouseMove: (e: React.MouseEvent<HTMLElement>) => void; onMouseLeave: () => void } {
  let told = 0;
  return {
    onMouseMove: (e) => {
      const now = store.current();
      if (!presenting(now.live) || !now.live.shared.includes(id) || e.timeStamp - told < POINTER_MS) {
        return;
      }
      told = e.timeStamp;
      const box = e.currentTarget.getBoundingClientRect();
      const tab = workspaceOf(now).tabs.findIndex((t) => t.id === id);
      const clamp = (v: number) => Math.min(1, Math.max(0, v));
      const x = box.width > 0 ? clamp((e.clientX - box.left) / box.width) : 0;
      const y = box.height > 0 ? clamp((e.clientY - box.top) / box.height) : 0;
      changeLive(store, (l) => ({ ...l, pointer: tab < 0 ? null : { tab, x, y } }));
    },
    onMouseLeave: () => {
      if (store.current().live.pointer !== null) {
        changeLive(store, (l) => ({ ...l, pointer: null }));
      }
    },
  };
}
