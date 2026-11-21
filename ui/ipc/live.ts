/**
 * Live Sessions' commands (RULES.md D56): the settings and the log; a
 * session hosted, its invitations, guests, roles and choices; the
 * workspace shared, which the backend filters before it leaves; and a
 * session joined. What happens comes as the events `liveHost` and
 * `liveGuest`.
 */
import { invoke } from "@tauri-apps/api/core";

/** What a participant is. */
export type Role = "presenter" | "viewer";

/** What a participant may do, beside its role. */
export interface Grants {
  readonly copy: boolean;
  readonly suggest: boolean;
}

/** A participant, as the host sees it. */
export interface Participant {
  readonly id: number;
  readonly name: string;
  readonly role: Role;
  readonly grants: Grants;
  readonly hand: boolean;
}

/** What a presenter chooses of a session. */
export interface SessionChoices {
  readonly rowLimit: number;
  readonly copy: boolean;
  readonly productionValues: boolean;
}

/** The session hosted. */
export interface HostedView {
  readonly session: string;
  readonly fingerprint: string;
  readonly direct: readonly string[];
  readonly relay: string | null;
  readonly participants: readonly Participant[];
  readonly presenter: number | null;
  readonly choices: SessionChoices;
}

/** The session joined. */
export interface JoinedView {
  readonly code: string;
  readonly role: Role;
  readonly grants: Grants;
}

/** Live Sessions now. */
export interface LiveStatus {
  readonly hosted: HostedView | null;
  readonly joined: JoinedView | null;
}

/** An invitation. */
export interface InviteView {
  readonly code: string;
  readonly expires: number;
}

/** A connection's environment. */
export type EnvironmentName = "development" | "test" | "production";

/** What an environment shares. */
export interface Sharing {
  readonly share: boolean;
  readonly values: boolean;
}

/** Live Sessions' settings. */
export interface LiveSettings {
  readonly format: 1;
  readonly enabled: boolean;
  readonly name: string;
  readonly environments: Readonly<Record<EnvironmentName, Sharing>>;
  readonly rowLimit: number;
  readonly maskedColumns: readonly string[];
  readonly allowCopy: boolean;
  readonly allowSuggest: boolean;
  readonly maxViewers: number;
  readonly inviteMinutes: number;
  readonly connectivity: {
    readonly direct: boolean;
    readonly port: number;
    readonly advertise: readonly string[];
    readonly relay: boolean;
    readonly relayAddress: string;
    readonly relayFingerprint: string;
  };
  readonly locked: boolean;
}

/** A tab's kind. */
export type TabKind = "worksheet" | "model" | "findings";

/** A part of a text chosen. */
export interface Selection {
  readonly from: number;
  readonly to: number;
}

/** A tab, as the window sends it to be shared. */
export interface TabIn {
  readonly id: string;
  readonly kind: TabKind;
  readonly title: string;
  readonly connection: number | null;
  readonly text: string;
  readonly selection: Selection | null;
  readonly results: {
    readonly columns: readonly { readonly name: string | null; readonly typeName: string }[];
    readonly rows: readonly (readonly (string | null)[])[];
  } | null;
  readonly messages: readonly string[];
  readonly plan: readonly string[];
  readonly document: unknown;
}

/** Where the presenter points: a tab by its place, and a place in it from 0 to 1. */
export interface Pointer {
  readonly tab: number;
  readonly x: number;
  readonly y: number;
}

/** The workspace, as the window sends it to be shared. */
export interface WorkspaceIn {
  readonly tabs: readonly TabIn[];
  readonly active: string | null;
  readonly pointer: Pointer | null;
}

/** A tab, as it is shared. */
export interface SharedTab {
  readonly id: string;
  readonly kind: TabKind;
  readonly title: string;
  readonly environment: EnvironmentName | null;
  readonly values: boolean;
  readonly text: string;
  readonly selection: Selection | null;
  readonly results: {
    readonly columns: readonly { readonly name: string | null; readonly typeName: string; readonly masked: boolean }[];
    readonly rows: readonly (readonly (string | null)[])[];
    readonly cut: boolean;
  } | null;
  readonly messages: readonly string[];
  readonly plan: readonly string[];
  readonly document: unknown;
}

/** The workspace, as it is shared. */
export interface SharedWorkspace {
  readonly tabs: readonly SharedTab[];
  readonly active: string | null;
  readonly pointer: Pointer | null;
  readonly copy: boolean;
}

/** What happens at the session hosted. */
export type HostEvent =
  | { readonly kind: "asked"; readonly id: number; readonly name: string; readonly code: string }
  | { readonly kind: "joined"; readonly id: number; readonly name: string }
  | { readonly kind: "left"; readonly id: number; readonly name: string }
  | { readonly kind: "hand"; readonly id: number; readonly up: boolean }
  | {
      readonly kind: "suggested";
      readonly id: number;
      readonly name: string;
      readonly tab: string;
      readonly sql: string;
    }
  | { readonly kind: "state"; readonly state: SharedWorkspace; readonly presenter: string }
  | { readonly kind: "turned"; readonly name: string; readonly why: string };

/** What happens to the session joined. */
export type GuestEvent =
  | { readonly kind: "waiting"; readonly code: string }
  | { readonly kind: "admitted"; readonly role: Role; readonly grants: Grants }
  | { readonly kind: "refused"; readonly why: string }
  | { readonly kind: "state"; readonly state: SharedWorkspace; readonly presenter: string }
  | { readonly kind: "role"; readonly role: Role; readonly grants: Grants }
  | { readonly kind: "removed" }
  | { readonly kind: "ended" }
  | { readonly kind: "lost" };

/** An entry of Live Sessions' log. */
export interface LiveEntry {
  readonly format: 1;
  readonly time: number;
  readonly what: string;
  readonly who: string | null;
  readonly detail: string | null;
}

/** Live Sessions' settings. */
export function liveSettings(): Promise<LiveSettings> {
  return invoke<LiveSettings>("live_settings");
}

/** Keeps Live Sessions' settings. */
export function saveLiveSettings(settings: LiveSettings): Promise<null> {
  return invoke<null>("save_live_settings", { settings });
}

/** Live Sessions now. */
export function liveStatus(): Promise<LiveStatus> {
  return invoke<LiveStatus>("live_status");
}

/** Hosts a session. */
export function livePresent(): Promise<LiveStatus> {
  return invoke<LiveStatus>("live_present");
}

/** A new invitation. */
export function liveInvite(): Promise<InviteView> {
  return invoke<InviteView>("live_invite");
}

/** Admits guest `id`, or refuses it. */
export function liveAnswer(id: number, yes: boolean): Promise<null> {
  return invoke<null>("live_answer", { id, yes });
}

/** Removes guest `id`. */
export function liveRemove(id: number): Promise<null> {
  return invoke<null>("live_remove", { id });
}

/** Grants guest `id` Suggest, or takes it back. */
export function liveGrant(id: number, suggest: boolean): Promise<null> {
  return invoke<null>("live_grant", { id, suggest });
}

/** Hands the presenter's role to guest `id`, or takes it back of null. */
export function liveHandOver(id: number | null): Promise<null> {
  return invoke<null>("live_hand_over", { id });
}

/** Sets the session's choices. */
export function liveChoose(choices: SessionChoices): Promise<null> {
  return invoke<null>("live_choose", { choices });
}

/** Shares `workspace`, where this Studio presents. */
export function livePublish(workspace: WorkspaceIn): Promise<null> {
  return invoke<null>("live_publish", { workspace });
}

/** Ends the session hosted. */
export function liveEnd(): Promise<null> {
  return invoke<null>("live_end");
}

/** Joins the session of invitation `code`. */
export function liveJoin(code: string): Promise<LiveStatus> {
  return invoke<LiveStatus>("live_join", { code });
}

/** Raises this Studio's hand, or lowers it. */
export function liveHand(up: boolean): Promise<null> {
  return invoke<null>("live_hand", { up });
}

/** Suggests `sql` into the presenter's tab `tab`. */
export function liveSuggest(tab: string, sql: string): Promise<null> {
  return invoke<null>("live_suggest", { tab, sql });
}

/** Leaves the session joined. */
export function liveLeave(): Promise<null> {
  return invoke<null>("live_leave");
}

/** Live Sessions' log. */
export function liveAudit(): Promise<LiveEntry[]> {
  return invoke<LiveEntry[]>("live_audit");
}

/** Forgets Live Sessions' log. */
export function clearLiveAudit(): Promise<null> {
  return invoke<null>("clear_live_audit");
}
