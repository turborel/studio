/**
 * Administration in the window (RULES.md D57): an act asked of the
 * backend, which writes its statement; what the guards ask confirmed as
 * any statement's is; the users and roles read again after it, and the
 * session as the server tells it.
 */
import type { Act } from "../ipc/admin";
import { adminAct } from "../ipc/admin";
import { isStudioError, session } from "../state/actions";
import { reloadSecurity } from "../state/catalog";
import { confirmed } from "../state/running";
import type { Store } from "../state/store";

/** What an act came to: done, let go at the guards' question, or failed and why. */
export type ActOutcome =
  { readonly kind: "done" } | { readonly kind: "declined" } | { readonly kind: "failed"; readonly why: string };

/** Whether `act` changes users, roles or privileges, so they are read again. */
function security(act: Act): boolean {
  return !["endConnection", "cancelConnection", "setSession", "setDatabase"].includes(act.kind);
}

/** Runs `act` on `connection`, asking first what the guards ask. */
export async function runAct(store: Store, connection: number, act: Act): Promise<ActOutcome> {
  try {
    let answer = await adminAct(connection, act, false);
    if (answer.kind === "confirm") {
      if (!(await confirmed(store, answer.answer))) {
        return { kind: "declined" };
      }
      answer = await adminAct(connection, act, true);
    }
    if (answer.kind === "ran") {
      session(store, connection, answer.answer.session);
    }
    if (security(act)) {
      await reloadSecurity(store, connection);
    }
    return { kind: "done" };
  } catch (thrown: unknown) {
    return { kind: "failed", why: isStudioError(thrown) ? thrown.message : String(thrown) };
  }
}
