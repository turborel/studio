/**
 * The assistant's conversation in the window (RULES.md D55): the items of
 * its turns as the backend tells them, its questions waiting for the
 * user's answers, and what the user asks, with what they chose to send:
 * the worksheet's SQL, the plan, and the result's first rows, each only
 * when ticked.
 */
import type { PromptParts, Question, Stop, TurnEvent, Usage, Verdict } from "../ipc/assistant";
import { assistantAnswer, assistantAsk, assistantForget } from "../ipc/assistant";
import { isStudioError } from "../state/actions";
import type { Store } from "../state/store";
import { changeWorksheet, openWorksheet, type RunResult, worksheetOf } from "../state/worksheets";

/** An item of the conversation. */
export type ChatItem =
  | { readonly kind: "user"; readonly text: string; readonly sent: readonly string[] }
  | { readonly kind: "assistant"; readonly text: string }
  | { readonly kind: "tool"; readonly name: string; readonly outcome: string }
  | {
      readonly kind: "draft";
      readonly sql: string;
      readonly title: string;
      readonly why: string;
      readonly verdict: Verdict;
      readonly estimate: string | null;
    }
  | { readonly kind: "refused"; readonly category: string | null; readonly explanation: string | null }
  | { readonly kind: "ended"; readonly stop: Stop; readonly usage: Usage }
  | { readonly kind: "error"; readonly message: string };

/** The conversation. */
export interface Chat {
  readonly id: string;
  /** The saved connection it is of, once asked. */
  readonly saved: string | null;
  readonly items: readonly ChatItem[];
  /** Whether a turn is running. */
  readonly busy: boolean;
  /** The questions waiting for their answers. */
  readonly questions: readonly { readonly id: number; readonly question: Question }[];
}

/** A new conversation. */
export function newChat(): Chat {
  return { id: crypto.randomUUID(), saved: null, items: [], busy: false, questions: [] };
}

/** Changes the conversation by `change`. */
function changeChat(store: Store, change: (c: Chat) => Chat): void {
  store.update((now) => ({ ...now, chat: change(now.chat) }));
}

/** `items` with `event` of a turn added. */
export function withEvent(items: readonly ChatItem[], event: TurnEvent): ChatItem[] {
  const last = items.at(-1);
  switch (event.kind) {
    case "text":
      return last?.kind === "assistant"
        ? [...items.slice(0, -1), { kind: "assistant", text: last.text + event.text }]
        : [...items, { kind: "assistant", text: event.text }];
    case "toolBegun":
      return [...items, { kind: "tool", name: event.name, outcome: "running" }];
    case "tool": {
      const at = items.findLastIndex((i) => i.kind === "tool" && i.name === event.name && i.outcome === "running");
      const item: ChatItem = { kind: "tool", name: event.name, outcome: event.outcome };
      return at === -1 ? [...items, item] : items.map((i, n) => (n === at ? item : i));
    }
    case "draft":
      return [...items, { ...event }];
    case "refused":
      return [...items, { kind: "refused", category: event.category, explanation: event.explanation }];
    case "ended":
      return [...items, { kind: "ended", stop: event.stop, usage: event.usage }];
  }
}

/** Takes `event` of conversation `conversation`, if it is the window's. */
export function assistantTold(store: Store, conversation: string, event: TurnEvent): void {
  if (store.current().chat.id !== conversation) {
    return;
  }
  changeChat(store, (c) => ({ ...c, items: withEvent(c.items, event), busy: event.kind === "ended" ? false : c.busy }));
}

/** Takes question `id` of conversation `conversation`, if it is the window's; else answers it no. */
export function assistantAsked(store: Store, conversation: string, id: number, question: Question): void {
  if (store.current().chat.id !== conversation) {
    void assistantAnswer(id, false).catch(() => null);
    return;
  }
  changeChat(store, (c) => ({ ...c, questions: [...c.questions, { id, question }] }));
}

/** Answers question `id`. */
export async function answer(store: Store, id: number, yes: boolean): Promise<void> {
  changeChat(store, (c) => ({ ...c, questions: c.questions.filter((q) => q.id !== id) }));
  await assistantAnswer(id, yes).catch(() => null);
}

/** What to send with a question. */
export interface Include {
  readonly sql: boolean;
  readonly plan: boolean;
  readonly rows: boolean;
}

/** The most rows of a result the user includes. */
export const INCLUDED_ROWS = 20;

/** The text of `run`'s first rows, a header of its columns' names first; null of a run of no columns. */
function rowsText(run: RunResult | undefined): string | null {
  if (run === undefined || run.columns.length === 0) {
    return null;
  }
  const names = run.columns.map((c, i) => c.name ?? `(${String(i + 1)})`);
  const rows = run.rows.slice(0, INCLUDED_ROWS).map((r) => r.map((c) => c ?? "NULL").join(" | "));
  return [names.join(" | "), ...rows].join("\n");
}

/** The parts of the active worksheet `include` sends: its text, its latest plan, and its result's first rows. */
export function included(store: Store, include: Include): Omit<PromptParts, "text"> {
  const now = store.current();
  const w = worksheetOf(now, now.activeWorksheet);
  if (w === undefined) {
    return { sql: null, explain: null, rows: null };
  }
  const run = w.runs.find((r) => r.id === w.shown) ?? w.runs.at(-1);
  const plan = w.plans.at(-1);
  return {
    sql: include.sql && w.text.trim() !== "" ? w.text : null,
    explain: include.plan && plan !== undefined ? plan.lines.join("\n") : null,
    rows: include.rows ? rowsText(run) : null,
  };
}

/** Asks the assistant `text` on the active connection, with what `include` says. */
export async function ask(store: Store, text: string, include: Include): Promise<void> {
  const now = store.current();
  const open = now.open.find((c) => c.id === now.active);
  if (open === undefined || open.savedId === null) {
    changeChat(store, (c) => ({
      ...c,
      items: [...c.items, { kind: "error", message: "The assistant works on a saved connection: open one first." }],
    }));
    return;
  }
  const parts = { text, ...included(store, include) };
  const sent = [
    "schema",
    ...(parts.sql === null ? [] : ["sql"]),
    ...(parts.explain === null ? [] : ["explain"]),
    ...(parts.rows === null ? [] : ["rows"]),
  ];
  const chat = now.chat;
  if (chat.saved !== null && chat.saved !== open.savedId) {
    await assistantForget(chat.id).catch(() => null);
    changeChat(store, () => ({ ...newChat() }));
  }
  const savedId = open.savedId;
  changeChat(store, (c) => ({ ...c, saved: savedId, busy: true, items: [...c.items, { kind: "user", text, sent }] }));
  try {
    await assistantAsk(store.current().chat.id, savedId, open.session.schema, parts);
  } catch (thrown: unknown) {
    const message = isStudioError(thrown) ? thrown.message : String(thrown);
    changeChat(store, (c) => ({ ...c, busy: false, items: [...c.items, { kind: "error", message }] }));
  }
}

/** Begins a new conversation, the old forgotten. */
export async function startOver(store: Store): Promise<void> {
  const old = store.current().chat.id;
  changeChat(store, () => newChat());
  await assistantForget(old).catch(() => null);
}

/** Opens a draft in a worksheet of the active connection: one blocked for the assistant runs only once its word is typed. */
export function openDraft(store: Store, draft: Extract<ChatItem, { kind: "draft" }>): string {
  const id = openWorksheet(store, draft.sql, draft.title === "" ? "Assistant's draft" : draft.title);
  changeWorksheet(store, id, (w) => ({
    ...w,
    draft: { blocked: draft.verdict.blocked, confirm: draft.verdict.confirm },
  }));
  return id;
}
