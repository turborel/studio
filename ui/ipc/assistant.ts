/**
 * The assistant's commands (RULES.md D55): its settings, keys, policies
 * and log, and each conversation asked, its questions answered. A key is
 * sent once as it is saved, and never told back: the window hears only
 * whether one is saved.
 */
import { invoke } from "@tauri-apps/api/core";

/** The model the assistant asks. */
export type Provider = "claude" | "own";

/** A wire format. */
export type Wire = "anthropic" | "chatCompletions";

/** The assistant's settings. */
export interface AssistantSettings {
  readonly format: 1;
  readonly enabled: boolean;
  readonly provider: Provider;
  readonly claudeModel: string;
  readonly own: {
    readonly baseUrl: string;
    readonly model: string;
    readonly wire: Wire;
    readonly tools: boolean;
  };
}

/** The settings, whether each key is saved, and Claude's models. */
export interface SettingsView {
  readonly settings: AssistantSettings;
  readonly keys: KeysSaved;
  readonly claudeModels: readonly string[];
}

/** Whether each key is saved. */
export interface KeysSaved {
  readonly claude: boolean;
  readonly own: boolean;
}

/** How much the assistant may do on a connection. */
export type Level = "off" | "explainOnly" | "read" | "proposeChanges";

/** A class of statements, as the guards classify them. */
export type StatementClass =
  "read" | "transaction" | "session" | "writeRows" | "changeSchema" | "security" | "administration" | "unclassified";

/** A connection's policy. */
export interface ConnectionPolicy {
  readonly level: Level;
  readonly preview: boolean;
  readonly redactLiterals: boolean;
  readonly allowClasses: readonly StatementClass[];
  readonly denyClasses: readonly StatementClass[];
  readonly allowObjects: readonly string[];
  readonly denyObjects: readonly string[];
  readonly hidden: readonly string[];
  readonly limits: {
    readonly rows: number;
    readonly statementSeconds: number;
    readonly toolCalls: number;
    readonly tokens: number;
  };
  readonly login: string | null;
}

/** A statement classified. */
export interface Classified {
  readonly text: string;
  readonly class: StatementClass;
  readonly destroys: string | null;
  readonly floor: string | null;
  readonly object: string | null;
}

/** The policy's verdict of a statement. */
export interface Verdict {
  readonly allowed: boolean;
  readonly rule: string | null;
  readonly why: string | null;
  readonly class: StatementClass;
  readonly objects: readonly string[];
  readonly blocked: boolean;
  readonly confirm: string | null;
  readonly statements: readonly Classified[];
}

/** Why a reply stopped. */
export type Stop =
  | { readonly kind: "endTurn" }
  | { readonly kind: "toolUse" }
  | { readonly kind: "maxTokens" }
  | { readonly kind: "refusal"; readonly category: string | null; readonly explanation: string | null }
  | { readonly kind: "other"; readonly reason: string };

/** The tokens a turn took. */
export interface Usage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWritten: number;
}

/** What happens in a turn. */
export type TurnEvent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "toolBegun"; readonly name: string }
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
  | { readonly kind: "ended"; readonly stop: Stop; readonly usage: Usage };

/** What the user is asked. */
export type Question =
  | { readonly kind: "send"; readonly body: string }
  | {
      readonly kind: "run";
      readonly sql: string;
      readonly purpose: string;
      readonly verdict: Verdict;
      readonly estimate: string | null;
    };

/** An entry of the log. */
export interface AuditEntry {
  readonly format: 1;
  readonly time: number;
  readonly provider: string;
  readonly model: string;
  readonly connection: string;
  readonly sent: readonly string[];
  readonly tools: readonly { readonly name: string; readonly outcome: string }[];
  readonly stop: string;
  readonly usage: Usage;
}

/** A question, and what the user chose to send with it. */
export interface PromptParts {
  readonly text: string;
  readonly sql: string | null;
  readonly explain: string | null;
  readonly rows: string | null;
}

/** The assistant's settings. */
export function assistantSettings(): Promise<SettingsView> {
  return invoke<SettingsView>("assistant_settings");
}

/** Keeps the assistant's settings. */
export function saveAssistantSettings(settings: AssistantSettings): Promise<null> {
  return invoke<null>("save_assistant_settings", { settings });
}

/** Keeps `provider`'s key, or forgets it of null: whether each is saved then. */
export function setAssistantKey(provider: Provider, key: string | null): Promise<KeysSaved> {
  return invoke<KeysSaved>("set_assistant_key", { provider, key });
}

/** Saved connection `saved`'s policy. */
export function assistantPolicy(saved: string): Promise<ConnectionPolicy> {
  return invoke<ConnectionPolicy>("assistant_policy", { saved });
}

/** Keeps saved connection `saved`'s policy. */
export function saveAssistantPolicy(saved: string, policy: ConnectionPolicy): Promise<null> {
  return invoke<null>("save_assistant_policy", { saved, policy });
}

/** Saves the policies where the platform's dialog chooses: the path, or null. */
export function exportAssistantPolicy(): Promise<string | null> {
  return invoke<string | null>("export_assistant_policy");
}

/** Takes the policies of a file the platform's dialog chooses: whether one was chosen. */
export function importAssistantPolicy(): Promise<boolean> {
  return invoke<boolean>("import_assistant_policy");
}

/** Keeps the password of saved connection `saved`'s assistant login, or forgets it of null. */
export function setAssistantLoginPassword(saved: string, password: string | null): Promise<null> {
  return invoke<null>("set_assistant_login_password", { saved, password });
}

/** The log, the latest first. */
export function assistantAudit(): Promise<AuditEntry[]> {
  return invoke<AuditEntry[]>("assistant_audit");
}

/** Forgets the log. */
export function clearAssistantAudit(): Promise<null> {
  return invoke<null>("clear_assistant_audit");
}

/** Asks conversation `conversation`, of saved connection `saved` and schema `schema`. */
export function assistantAsk(
  conversation: string,
  saved: string,
  schema: string | null,
  prompt: PromptParts,
): Promise<null> {
  return invoke<null>("assistant_ask", { conversation, saved, schema, prompt });
}

/** Answers question `id`. */
export function assistantAnswer(id: number, yes: boolean): Promise<null> {
  return invoke<null>("assistant_answer", { id, yes });
}

/** Forgets conversation `conversation`. */
export function assistantForget(conversation: string): Promise<null> {
  return invoke<null>("assistant_forget", { conversation });
}
