/**
 * Live Sessions in the window (RULES.md D56): the session hosted or
 * joined, as the backend tells it; the tabs the presenter picked to share;
 * the guests asking to be admitted, their hands and suggestions; and the
 * workspace this Studio is shown, held in memory alone, and let go as the
 * session ends.
 */
import type {
  GuestEvent,
  Grants,
  HostEvent,
  InviteView,
  LiveStatus,
  Pointer,
  Role,
  SharedWorkspace,
  TabIn,
  WorkspaceIn,
} from "../ipc/live";
import {
  liveAnswer,
  liveEnd,
  liveGrant,
  liveHand,
  liveHandOver,
  liveInvite,
  liveJoin,
  liveLeave,
  livePresent,
  liveRemove,
  liveStatus,
  liveSuggest,
} from "../ipc/live";
import type { Finding } from "../ipc/analyzer";
import type { StudioState, Store } from "../state/store";
import { isStudioError } from "../state/actions";
import { modelOf } from "../model/models";
import { changeWorksheet, openWorksheet, worksheetOf } from "../state/worksheets";
import { viewOf } from "../worksheet/editor/views";

/** A guest asking to be admitted. */
export interface Asking {
  readonly id: number;
  readonly name: string;
  readonly code: string;
}

/** SQL a viewer suggests. */
export interface Suggestion {
  readonly at: number;
  readonly id: number;
  readonly name: string;
  readonly tab: string;
  readonly sql: string;
}

/** The analyzer's findings shared, of a connection. */
export interface SharedFindings {
  readonly title: string;
  readonly connection: number | null;
  readonly findings: readonly Finding[];
}

/** Live Sessions, as the window holds them. */
export interface LiveState {
  /** The session hosted or joined, as last told. */
  readonly status: LiveStatus;
  /** The tabs shared, worksheets and models, by their identifiers. */
  readonly shared: readonly string[];
  /** The analyzer's findings shared, if any. */
  readonly findings: SharedFindings | null;
  /** The guests asking to be admitted. */
  readonly asking: readonly Asking[];
  /** The suggestions not yet taken or let go. */
  readonly suggestions: readonly Suggestion[];
  /** The latest invitation. */
  readonly invite: InviteView | null;
  /** The workspace this Studio is shown, and who presents it. */
  readonly shown: { readonly workspace: SharedWorkspace; readonly presenter: string } | null;
  /** The safety code a guest shows while it waits. */
  readonly waiting: string | null;
  /** Whether this guest's hand is up. */
  readonly hand: boolean;
  /** Whether the view follows the presenter's tab. */
  readonly follow: boolean;
  /** The tab chosen when not following. */
  readonly chosen: string | null;
  /** Where the presenter points, as this Studio presents. */
  readonly pointer: Pointer | null;
  /** What was last told: an ending, a refusal, a failure. */
  readonly told: string | null;
}

/** Live Sessions as the window starts. */
export const NO_LIVE: LiveState = {
  status: { hosted: null, joined: null },
  shared: [],
  findings: null,
  asking: [],
  suggestions: [],
  invite: null,
  shown: null,
  waiting: null,
  hand: false,
  follow: true,
  chosen: null,
  pointer: null,
  told: null,
};

/** The most rows of a result the window sends; the backend cuts to the session's limit. */
const MAX_SENT_ROWS = 10_000;
/** The most messages of a worksheet sent. */
const MAX_SENT_MESSAGES = 50;
/** The most suggestions held. */
const MAX_SUGGESTIONS = 50;

/** Changes the window's Live Sessions by `change`. */
export function changeLive(store: Store, change: (l: LiveState) => LiveState): void {
  store.update((now) => ({ ...now, live: change(now.live) }));
}

/** The failure's message of `thrown`. */
export function said(thrown: unknown): string {
  return isStudioError(thrown) ? thrown.message : String(thrown);
}

/** Runs `act`, telling its failure. */
async function telling(store: Store, act: () => Promise<unknown>): Promise<void> {
  try {
    await act();
  } catch (thrown: unknown) {
    changeLive(store, (l) => ({ ...l, told: said(thrown) }));
  }
}

/** Reads the status again. */
export async function refreshLive(store: Store): Promise<void> {
  await telling(store, async () => {
    const status = await liveStatus();
    changeLive(store, (l) => ({ ...l, status }));
  });
}

/** `status` with the joined session's role and grants changed. */
function joinedAs(status: LiveStatus, role: Role, grants: Grants): LiveStatus {
  return status.joined === null ? status : { ...status, joined: { ...status.joined, role, grants } };
}

/** Takes `event` of the session hosted. */
export function hostTold(store: Store, event: HostEvent): void {
  switch (event.kind) {
    case "asked":
      changeLive(store, (l) => ({ ...l, asking: [...l.asking, { id: event.id, name: event.name, code: event.code }] }));
      return;
    case "turned":
      changeLive(store, (l) => ({ ...l, asking: l.asking.filter((a) => a.name !== event.name) }));
      return;
    case "suggested":
      changeLive(store, (l) => ({
        ...l,
        suggestions: [
          ...l.suggestions,
          { at: Date.now(), id: event.id, name: event.name, tab: event.tab, sql: event.sql },
        ].slice(-MAX_SUGGESTIONS),
      }));
      return;
    case "state":
      changeLive(store, (l) => ({ ...l, shown: { workspace: event.state, presenter: event.presenter } }));
      return;
    case "joined":
    case "left":
    case "hand":
      changeLive(store, (l) => ({ ...l, asking: l.asking.filter((a) => a.id !== event.id) }));
      void refreshLive(store);
  }
}

/** What a guest's session's end says. */
const ENDINGS = {
  removed: "The presenter removed you from the session.",
  ended: "The presenter ended the session.",
  lost: "The session was lost: the presenter can no longer be reached.",
} as const;

/** Takes `event` of the session joined. */
export function guestTold(store: Store, event: GuestEvent): void {
  switch (event.kind) {
    case "waiting":
      changeLive(store, (l) => ({ ...l, waiting: event.code, told: null }));
      return;
    case "admitted":
    case "role":
      changeLive(store, (l) => ({ ...l, waiting: null, status: joinedAs(l.status, event.role, event.grants) }));
      return;
    case "state":
      changeLive(store, (l) => ({ ...l, shown: { workspace: event.state, presenter: event.presenter } }));
      return;
    case "refused":
      leftSession(store, `Not admitted: ${event.why}`);
      return;
    default:
      leftSession(store, ENDINGS[event.kind]);
  }
}

/** Lets go of the session joined, and all it showed, telling `told`. */
function leftSession(store: Store, told: string): void {
  changeLive(store, (l) => ({
    ...NO_LIVE,
    shared: l.shared,
    follow: l.follow,
    told,
    status: { ...l.status, joined: null },
  }));
}

/** Hosts a session. */
export async function present(store: Store): Promise<void> {
  await telling(store, async () => {
    const status = await livePresent();
    changeLive(store, (l) => ({ ...l, status, told: null, shown: null }));
  });
}

/** Makes a new invitation. */
export async function invite(store: Store): Promise<void> {
  await telling(store, async () => {
    const made = await liveInvite();
    changeLive(store, (l) => ({ ...l, invite: made }));
  });
}

/** Admits guest `id`, or refuses it. */
export async function answer(store: Store, id: number, yes: boolean): Promise<void> {
  changeLive(store, (l) => ({ ...l, asking: l.asking.filter((a) => a.id !== id) }));
  await telling(store, () => liveAnswer(id, yes));
}

/** Removes guest `id`. */
export async function remove(store: Store, id: number): Promise<void> {
  await telling(store, () => liveRemove(id));
  await refreshLive(store);
}

/** Grants guest `id` Suggest, or takes it back. */
export async function grant(store: Store, id: number, suggest: boolean): Promise<void> {
  await telling(store, () => liveGrant(id, suggest));
  await refreshLive(store);
}

/** Hands the presenter's role to guest `id`, or takes it back of null. */
export async function handOver(store: Store, id: number | null): Promise<void> {
  await telling(store, () => liveHandOver(id));
  if (id === null) {
    changeLive(store, (l) => ({ ...l, shown: null }));
  }
  await refreshLive(store);
}

/** Ends the session hosted, and lets go of all it held. */
export async function endSession(store: Store): Promise<void> {
  await telling(store, () => liveEnd());
  changeLive(store, (l) => ({ ...NO_LIVE, follow: l.follow, told: "The session is ended." }));
}

/** Joins the session of invitation `code`. */
export async function join(store: Store, code: string): Promise<boolean> {
  try {
    const status = await liveJoin(code);
    changeLive(store, (l) => ({ ...l, status, told: null, shown: null, hand: false }));
    return true;
  } catch (thrown: unknown) {
    changeLive(store, (l) => ({ ...l, told: said(thrown) }));
    return false;
  }
}

/** Leaves the session joined. */
export async function leave(store: Store): Promise<void> {
  await telling(store, () => liveLeave());
  leftSession(store, "You left the session.");
}

/** Raises this Studio's hand, or lowers it. */
export async function raiseHand(store: Store, up: boolean): Promise<void> {
  changeLive(store, (l) => ({ ...l, hand: up }));
  await telling(store, () => liveHand(up));
}

/** Suggests `sql` into the presenter's tab `tab`. */
export async function suggest(store: Store, tab: string, sql: string): Promise<boolean> {
  try {
    await liveSuggest(tab, sql);
    return true;
  } catch (thrown: unknown) {
    changeLive(store, (l) => ({ ...l, told: said(thrown) }));
    return false;
  }
}

/** Opens suggestion `s` in a worksheet of the presenter's tab's connection, and lets it go. */
export function takeSuggestion(store: Store, s: Suggestion): string {
  const tab = worksheetOf(store.current(), s.tab);
  const id = openWorksheet(store, s.sql, `Suggested by ${s.name}`);
  if (tab !== undefined) {
    changeWorksheet(store, id, (w) => ({ ...w, connection: tab.connection, savedConnection: tab.savedConnection }));
  }
  changeLive(store, (l) => ({ ...l, suggestions: l.suggestions.filter((x) => x !== s) }));
  return id;
}

/** Lets suggestion `s` go. */
export function dropSuggestion(store: Store, s: Suggestion): void {
  changeLive(store, (l) => ({ ...l, suggestions: l.suggestions.filter((x) => x !== s) }));
}

/** Shares tab `id`, or stops sharing it. */
export function toggleShared(store: Store, id: string): void {
  changeLive(store, (l) => ({
    ...l,
    shared: l.shared.includes(id) ? l.shared.filter((s) => s !== id) : [...l.shared, id],
  }));
}

/** Whether this Studio presents now: hosting with no guest presenting, or a guest handed the role. */
export function presenting(live: LiveState): boolean {
  const { hosted, joined } = live.status;
  return (hosted !== null && hosted.presenter === null) || joined?.role === "presenter";
}

/** Worksheet `id` of `now` as a tab to share; none if it is not open. */
function worksheetTab(now: StudioState, id: string): TabIn | null {
  const w = worksheetOf(now, id);
  if (w === undefined) {
    return null;
  }
  const run = w.runs.find((r) => r.id === w.shown) ?? w.runs.at(-1);
  const selection = viewOf(id)?.state.selection.main;
  return {
    id,
    kind: "worksheet",
    title: w.title,
    connection: w.connection,
    text: w.text,
    selection: selection === undefined ? null : { from: selection.from, to: selection.to },
    results:
      run === undefined || run.columns.length === 0
        ? null
        : {
            columns: run.columns.map((c) => ({ name: c.name, typeName: c.typeName ?? c.typeWritten })),
            rows: run.rows.slice(0, MAX_SENT_ROWS),
          },
    messages: w.messages.slice(-MAX_SENT_MESSAGES).map((m) => m.text),
    plan: w.plans.at(-1)?.lines ?? [],
    document: null,
  };
}

/** Model `id` of `now` as a tab to share; none if it is not open. */
function modelTab(now: StudioState, id: string): TabIn | null {
  const doc = modelOf(now, id);
  if (doc === undefined) {
    return null;
  }
  const document = { model: doc.model, grouped: doc.grouped, hidden: doc.hidden };
  return {
    id,
    kind: "model",
    title: doc.model.name,
    connection: doc.connection,
    text: "",
    selection: null,
    results: null,
    messages: [],
    plan: [],
    document,
  };
}

/** The workspace of `now` to share: the tabs picked, the analyzer's findings if shared, and where the presenter points. */
export function workspaceOf(now: StudioState): WorkspaceIn {
  const tabs = now.live.shared
    .map((id) => worksheetTab(now, id) ?? modelTab(now, id))
    .filter((t): t is TabIn => t !== null);
  const f = now.live.findings;
  if (f !== null) {
    tabs.push({
      id: "findings",
      kind: "findings",
      title: f.title,
      connection: f.connection,
      text: "",
      selection: null,
      results: null,
      messages: [],
      plan: [],
      document: f.findings,
    });
  }
  const showing =
    [now.activeWorksheet, now.activeModel].find((a) => a !== null && tabs.some((t) => t.id === a)) ?? null;
  return { tabs, active: showing, pointer: now.live.pointer };
}
