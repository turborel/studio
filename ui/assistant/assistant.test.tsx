import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import type { AuditEntry, ConnectionPolicy, SettingsView, TurnEvent, Verdict } from "../ipc/assistant";
import { told } from "../state/actions";
import { runStatements } from "../state/running";
import type { Store } from "../state/store";
import { changeWorksheet, openWorksheet, type RunResult, worksheetOf } from "../state/worksheets";
import { parsePlan } from "../plan/plan";
import { PromptDialog } from "../shell/PromptDialog";
import { catalogBackend, must, opened, refused, settle, within } from "../test/catalog";
import { AssistantPanel, standing } from "./AssistantPanel";
import { AssistantSettingsDialog, entries } from "./AssistantSettings";
import { ask, included, INCLUDED_ROWS, openDraft, withEvent } from "./chat";

/** A verdict of a read, allowed. */
const READ: Verdict = {
  allowed: true,
  rule: null,
  why: null,
  class: "read",
  objects: ["ANN.STAFF"],
  blocked: false,
  confirm: null,
  statements: [{ text: "SELECT 1", class: "read", destroys: null, floor: null, object: null }],
};

/** A verdict of a statement past the hard floor, blocked. */
const BLOCKED: Verdict = {
  ...READ,
  allowed: false,
  rule: "HARD-FLOOR",
  why: "it drops a schema",
  class: "changeSchema",
  blocked: true,
  confirm: "ANN",
  statements: [
    {
      text: "DROP SCHEMA ANN CASCADE",
      class: "changeSchema",
      destroys: "schema ANN",
      floor: "drops a schema",
      object: "ANN",
    },
  ],
};

/** The policy of a development connection. */
const POLICY: ConnectionPolicy = {
  level: "read",
  preview: true,
  redactLiterals: false,
  allowClasses: [],
  denyClasses: [],
  allowObjects: [],
  denyObjects: [],
  hidden: [],
  limits: { rows: 100, statementSeconds: 30, toolCalls: 20, tokens: 64000 },
  login: null,
};

/** The settings as first read. */
const SETTINGS: SettingsView = {
  settings: {
    format: 1,
    enabled: false,
    provider: "claude",
    claudeModel: "claude-opus-5-5",
    own: { baseUrl: "http://localhost:11434", model: "", wire: "chatCompletions", tools: true },
  },
  keys: { claude: false, own: false },
  claudeModels: ["claude-opus-5-5"],
};

/** A run of column N and `rows` rows. */
function ran(rows: number): RunResult {
  return {
    id: 1,
    sql: "SELECT N FROM T",
    from: 0,
    to: 15,
    connection: 1,
    started: 0,
    millis: 1,
    outcome: null,
    columns: [{ name: "N", typeWritten: "INTEGER", typeName: "INTEGER", notNull: false }],
    rows: Array.from({ length: rows }, (_, i) => [i === 0 ? null : String(i)]),
    complete: true,
    warnings: [],
    error: null,
    serverTime: null,
    plan: null,
    values: [],
    lobs: [],
    pinned: false,
    query: null,
    editing: null,
  };
}

/** Tells the store `event` of its conversation. */
function tell(store: Store, event: TurnEvent): void {
  act(() => {
    told(store, { kind: "assistant", conversation: store.current().chat.id, event });
  });
}

afterEach(cleanup);

describe("the assistant's conversation", () => {
  it("joins the text streamed, and ends each tool call it began [DESIGN] D55", () => {
    let items = withEvent([], { kind: "text", text: "Hel" });
    items = withEvent(items, { kind: "text", text: "lo" });
    items = withEvent(items, { kind: "toolBegun", name: "list_tables" });
    items = withEvent(items, { kind: "tool", name: "list_tables", outcome: "3 tables" });
    items = withEvent(items, { kind: "tool", name: "explain", outcome: "blocked: LEVEL" });
    items = withEvent(items, { kind: "text", text: "Done" });
    items = withEvent(items, { kind: "refused", category: "cyber", explanation: null });
    expect(items).toEqual([
      { kind: "assistant", text: "Hello" },
      { kind: "tool", name: "list_tables", outcome: "3 tables" },
      { kind: "tool", name: "explain", outcome: "blocked: LEVEL" },
      { kind: "assistant", text: "Done" },
      { kind: "refused", category: "cyber", explanation: null },
    ]);
  });

  it("takes its own conversation's events alone, and answers no to another's question [DESIGN] D55", async () => {
    const asked = catalogBackend();
    const store = await opened();
    act(() => {
      told(store, { kind: "assistant", conversation: "other", event: { kind: "text", text: "no" } });
      told(store, { kind: "assistantAsks", conversation: "other", id: 7, question: { kind: "send", body: "{}" } });
    });
    await settle();
    expect(store.current().chat.items).toEqual([]);
    expect(asked.filter((a) => a.command === "assistant_answer")).toEqual([
      { command: "assistant_answer", args: { id: 7, yes: false } },
    ]);
  });

  it("sends the worksheet's SQL, its plan and its first rows only as ticked [DESIGN] D55", async () => {
    catalogBackend();
    const store = await opened();
    expect(included(store, { sql: true, plan: true, rows: true })).toEqual({ sql: null, explain: null, rows: null });
    const id = openWorksheet(store, "SELECT N FROM T");
    const plan = parsePlan(["-- physical:", "SeqScan ANN.T  (rows=30)"]);
    changeWorksheet(store, id, (w) => ({ ...w, runs: [ran(30)], plans: [plan] }));
    const all = included(store, { sql: true, plan: true, rows: true });
    expect(all.sql).toBe("SELECT N FROM T");
    expect(all.explain).toBe("-- physical:\nSeqScan ANN.T  (rows=30)");
    const lines = must(all.rows).split("\n");
    expect(lines).toHaveLength(INCLUDED_ROWS + 1);
    expect(lines.slice(0, 3)).toEqual(["N", "NULL", "1"]);
    expect(included(store, { sql: false, plan: false, rows: false })).toEqual({ sql: null, explain: null, rows: null });
    changeWorksheet(store, id, (w) => ({ ...w, text: " ", runs: [{ ...ran(0), columns: [] }] }));
    expect(included(store, { sql: true, plan: false, rows: true })).toEqual({ sql: null, explain: null, rows: null });
  });

  it("is asked of the active saved connection, a new one begun as the connection changes [DESIGN] D55", async () => {
    const asked = catalogBackend({ assistant_ask: () => null });
    const store = await opened();
    openWorksheet(store, "SELECT 1");
    await ask(store, "What is slow?", { sql: true, plan: true, rows: false });
    const first = store.current().chat;
    expect(first.saved).toBe("ab");
    expect(first.busy).toBe(true);
    expect(first.items).toEqual([{ kind: "user", text: "What is slow?", sent: ["schema", "sql"] }]);
    expect(asked.find((a) => a.command === "assistant_ask")?.args).toEqual({
      conversation: first.id,
      saved: "ab",
      schema: "ANN",
      prompt: { text: "What is slow?", sql: "SELECT 1", explain: null, rows: null },
    });
    act(() => {
      store.update((now) => ({ ...now, chat: { ...now.chat, saved: "other" } }));
    });
    await ask(store, "Again", { sql: false, plan: false, rows: false });
    expect(asked.some((a) => a.command === "assistant_forget" && a.args["conversation"] === first.id)).toBe(true);
    expect(store.current().chat.id).not.toBe(first.id);
    expect(store.current().chat.items).toHaveLength(1);
  });

  it("says why it was not asked: no saved connection, or the backend's refusal [DESIGN] D55", async () => {
    catalogBackend({
      assistant_ask: () => refused({ sqlcode: -910, sqlstate: "HY000", message: "the assistant is off" }),
    });
    const none = await opened();
    act(() => {
      none.update((now) => ({ ...now, open: now.open.map((c) => ({ ...c, savedId: null })) }));
    });
    await ask(none, "Hi", { sql: false, plan: false, rows: false });
    expect(none.current().chat.items).toEqual([
      { kind: "error", message: "The assistant works on a saved connection: open one first." },
    ]);
    const store = await opened();
    await ask(store, "Hi", { sql: false, plan: false, rows: false });
    expect(store.current().chat.busy).toBe(false);
    expect(store.current().chat.items.at(-1)).toEqual({ kind: "error", message: "the assistant is off" });
  });
});

describe("the assistant's panel", () => {
  it("shows each turn's items, asks the user and answers, and starts over [DESIGN] D55", async () => {
    const asked = catalogBackend({ assistant_ask: () => null });
    const store = await opened();
    within(store, <AssistantPanel />);
    await settle();
    expect(screen.getByText(/off until it is turned on/)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Ask the assistant" }), { target: { value: " Why? " } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Include its result's first rows" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await settle();
    expect(asked.find((a) => a.command === "assistant_ask")?.args["prompt"]).toEqual({
      text: "Why?",
      sql: null,
      explain: null,
      rows: null,
    });
    expect(screen.getByText("Working…")).toBeTruthy();
    tell(store, { kind: "text", text: "Because." });
    tell(store, { kind: "toolBegun", name: "run_query" });
    act(() => {
      const conversation = store.current().chat.id;
      told(store, { kind: "assistantAsks", conversation, id: 1, question: { kind: "send", body: '{"model":"m"}' } });
      told(store, {
        kind: "assistantAsks",
        conversation,
        id: 2,
        question: {
          kind: "run",
          sql: "SELECT 1",
          purpose: "count",
          verdict: READ,
          estimate: "Project 1  (est. rows=1)",
        },
      });
    });
    expect(screen.getByText('{"model":"m"}')).toBeTruthy();
    expect(screen.getByText(/Class read · of ANN.STAFF/).textContent).toContain(
      "EXPLAIN estimates: Project 1  (est. rows=1)",
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(screen.getByRole("button", { name: "Don't Run" }));
    await settle();
    expect(asked.filter((a) => a.command === "assistant_answer").map((a) => a.args)).toEqual([
      { id: 1, yes: true },
      { id: 2, yes: false },
    ]);
    tell(store, { kind: "tool", name: "run_query", outcome: "declined" });
    tell(store, { kind: "tool", name: "explain", outcome: "blocked: HIDDEN" });
    tell(store, { kind: "refused", category: "cyber", explanation: "not this" });
    tell(store, {
      kind: "ended",
      stop: { kind: "endTurn" },
      usage: { input: 10, output: 5, cacheRead: 4, cacheWritten: 0 },
    });
    tell(store, {
      kind: "ended",
      stop: { kind: "other", reason: "pause_turn" },
      usage: { input: 0, output: 0, cacheRead: 0, cacheWritten: 0 },
    });
    tell(store, {
      kind: "ended",
      stop: { kind: "maxTokens" },
      usage: { input: 0, output: 0, cacheRead: 0, cacheWritten: 0 },
    });
    tell(store, { kind: "refused", category: null, explanation: null });
    expect(screen.getByText(/run_query: declined/).className).toBe("assistant-tool");
    expect(screen.getByText(/explain: blocked: HIDDEN/).className).toBe("assistant-tool assistant-danger");
    expect(screen.getByText(/The model declined \(cyber\): not this/)).toBeTruthy();
    expect(screen.getByText(/10 tokens in, 5 out, 4 of the cache/)).toBeTruthy();
    expect(screen.getByText("Stopped: pause_turn")).toBeTruthy();
    expect(screen.getByText("Stopped: maxTokens")).toBeTruthy();
    expect(screen.queryByText("Working…")).toBeNull();
    const id = store.current().chat.id;
    fireEvent.click(screen.getByRole("button", { name: "New Conversation" }));
    await settle();
    expect(asked.some((a) => a.command === "assistant_forget" && a.args["conversation"] === id)).toBe(true);
    expect(store.current().chat.items).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Assistant Settings/ }));
    expect(store.current().dialog).toEqual({ kind: "assistantSettings" });
  });

  it("opens a draft in a worksheet, one blocked marked and run only once its word is typed [DESIGN] D55", async () => {
    const asked = catalogBackend({ run_statement: () => ({ kind: "ran", answer: null }) });
    const store = await opened();
    within(store, <AssistantPanel />);
    tell(store, {
      kind: "draft",
      sql: "DROP SCHEMA ANN CASCADE",
      title: "",
      why: "asked to",
      verdict: BLOCKED,
      estimate: null,
    });
    expect(
      screen.getByText(/destroys: schema ANN · blocked for the assistant: drops a schema · stopped by HARD-FLOOR/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open in Worksheet" }));
    const sheet = must(worksheetOf(store.current(), store.current().activeWorksheet));
    expect(sheet.title).toBe("Assistant's draft");
    expect(sheet.draft).toEqual({ blocked: true, confirm: "ANN" });
    const declined = runStatements(store, sheet.id, [{ sql: "DROP SCHEMA ANN CASCADE", from: 0, to: 23 }]);
    const question = store.current().dialog;
    if (question?.kind !== "prompt") {
      throw new Error("no question");
    }
    within(store, <PromptDialog {...question} />);
    fireEvent.change(screen.getAllByRole("textbox").at(-1) ?? document.body, { target: { value: "no" } });
    fireEvent.submit(screen.getAllByRole("textbox").at(-1) ?? document.body);
    await declined;
    expect(asked.some((a) => a.command === "run_statement")).toBe(false);
    expect(must(worksheetOf(store.current(), sheet.id)).messages.at(-1)?.text).toMatch(
      /runs only once its word is typed/,
    );
    const unblocked = openDraft(store, {
      kind: "draft",
      sql: "SELECT 1",
      title: "Count",
      why: "",
      verdict: READ,
      estimate: null,
    });
    expect(must(worksheetOf(store.current(), unblocked)).draft).toEqual({ blocked: false, confirm: null });
  });
});

describe("the assistant's standing", () => {
  it("says it is off, or that its model calls no tools [DESIGN] D55", () => {
    expect(standing(null)).toMatch(/off until/);
    const on = { ...SETTINGS, settings: { ...SETTINGS.settings, enabled: true } };
    expect(standing(on)).toBeNull();
    const own = {
      ...on,
      settings: { ...on.settings, provider: "own" as const, own: { ...on.settings.own, tools: false } },
    };
    expect(standing(own)).toMatch(/calls no tools/);
    expect(standing({ ...own, settings: { ...own.settings, own: { ...own.settings.own, tools: true } } })).toBeNull();
  });
});

describe("the assistant's settings", () => {
  it("keeps the model, its key and the connection's policy, and never shows a key [DESIGN] D55", async () => {
    let policy = POLICY;
    const asked = catalogBackend({
      assistant_settings: () => SETTINGS,
      assistant_policy: () => policy,
      save_assistant_settings: () => null,
      save_assistant_policy: (args) => {
        policy = args["policy"] as ConnectionPolicy;
        return null;
      },
      set_assistant_key: (args) => ({ claude: args["key"] !== null, own: false }),
      set_assistant_login_password: () => null,
    });
    const store = await opened();
    within(store, <AssistantSettingsDialog />);
    await settle();
    fireEvent.click(screen.getByRole("checkbox", { name: "Turn the assistant on" }));
    fireEvent.change(screen.getByLabelText("Claude's model"), {
      target: { value: "claude-sonnet-5-5" },
    });
    expect(screen.getByLabelText("Key (not saved)")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Key (not saved)"), { target: { value: "sk-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Key" }));
    await settle();
    expect(screen.getByLabelText("Key (saved)")).toHaveProperty("value", "");
    expect(screen.getByRole("status").textContent).toBe("The key is saved in the keychain.");
    fireEvent.click(screen.getByRole("button", { name: "Forget Key" }));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("The key is forgotten.");
    fireEvent.change(screen.getByRole("combobox", { name: "The assistant may" }), {
      target: { value: "proposeChanges" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Show what will be sent before each request" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Replace SQL's literals by placeholders" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Hidden schemas and tables, a line each" }), {
      target: { value: "HR\n\n ANN.PAY " },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Rows returned to the model" }), {
      target: { value: "50" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "The assistant's own login" }), {
      target: { value: "HELPER" },
    });
    fireEvent.change(screen.getByLabelText("Its password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Password" }));
    await settle();
    expect(asked.find((a) => a.command === "set_assistant_login_password")?.args).toEqual({
      saved: "ab",
      password: "pw",
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await settle();
    expect(asked.find((a) => a.command === "save_assistant_settings")?.args["settings"]).toMatchObject({
      enabled: true,
      claudeModel: "claude-sonnet-5-5",
    });
    expect(policy).toMatchObject({
      level: "proposeChanges",
      preview: false,
      redactLiterals: true,
      hidden: ["HR", "ANN.PAY"],
      login: "HELPER",
    });
    expect(policy.limits.rows).toBe(50);
    expect(store.current().dialog).toBeNull();
    expect(JSON.stringify(asked.filter((a) => a.command !== "set_assistant_key"))).not.toContain("sk-1");
  });

  it("sets the user's own model, and tells each failure [DESIGN] D55", async () => {
    const asked = catalogBackend({
      assistant_settings: () => SETTINGS,
      assistant_policy: () => POLICY,
      save_assistant_settings: () => refused({ sqlcode: -910, sqlstate: "HY000", message: "an endpoint is HTTPS" }),
      set_assistant_key: () => refused({ sqlcode: -910, sqlstate: "HY000", message: "no keychain" }),
      set_assistant_login_password: () => refused({ sqlcode: -910, sqlstate: "HY000", message: "no keychain here" }),
    });
    const store = await opened();
    within(store, <AssistantSettingsDialog />);
    await settle();
    fireEvent.change(screen.getByRole("combobox", { name: "Model of" }), { target: { value: "own" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Endpoint" }), { target: { value: "http://example.test" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Model" }), { target: { value: "local" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Wire format" }), { target: { value: "anthropic" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /It calls tools/ }));
    fireEvent.change(screen.getByLabelText("Key (not saved)"), { target: { value: "k" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Key" }));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("no keychain");
    fireEvent.change(screen.getByLabelText("Its password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Password" }));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("no keychain here");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("an endpoint is HTTPS");
    expect(asked.find((a) => a.command === "save_assistant_settings")?.args["settings"]).toMatchObject({
      provider: "own",
      own: { baseUrl: "http://example.test", model: "local", wire: "anthropic", tools: false },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Model of" }), { target: { value: "claude" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Model of" }), { target: { value: "own" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Wire format" }), { target: { value: "chatCompletions" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(store.current().dialog).toBeNull();
  });

  it("exports and imports the policies, and shows and clears the log [DESIGN] D55", async () => {
    const entry: AuditEntry = {
      format: 1,
      time: 1_700_000_000,
      provider: "claude",
      model: "claude-opus-5-5",
      connection: "Orders",
      sent: ["schema", "sql"],
      tools: [{ name: "explain", outcome: "ok" }],
      stop: "end_turn",
      usage: { input: 100, output: 20, cacheRead: 0, cacheWritten: 0 },
    };
    let exported: string | null = "/home/ann/assistant-policy.json";
    catalogBackend({
      assistant_settings: () => SETTINGS,
      assistant_policy: () => POLICY,
      export_assistant_policy: () => exported,
      import_assistant_policy: () => true,
      assistant_audit: () => [entry],
      clear_assistant_audit: () => null,
    });
    const store = await opened();
    within(store, <AssistantSettingsDialog />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Export Policies…" }));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("Exported to /home/ann/assistant-policy.json.");
    exported = null;
    fireEvent.click(screen.getByRole("button", { name: "Export Policies…" }));
    await settle();
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Import Policies…" }));
    await settle();
    expect(screen.getByRole("status").textContent).toMatch(/Imported/);
    fireEvent.click(screen.getByRole("button", { name: "Show the Log" }));
    await settle();
    const log = screen.getByRole("table", { name: "The assistant's log" });
    expect(log.textContent).toContain("explain: ok");
    expect(log.textContent).toContain("100 / 20");
    fireEvent.click(screen.getByRole("button", { name: "Clear the Log" }));
    await settle();
    expect(screen.getByText("Nothing is logged.")).toBeTruthy();
  });

  it("waits for its settings, and asks for a saved connection to set a policy [DESIGN] D55", async () => {
    catalogBackend({
      assistant_settings: () => new Promise(() => undefined),
      export_assistant_policy: () => refused({ sqlcode: -910, sqlstate: "HY000", message: "cannot write" }),
    });
    const store = await opened();
    act(() => {
      store.update((now) => ({ ...now, open: now.open.map((c) => ({ ...c, savedId: null })) }));
    });
    within(store, <AssistantSettingsDialog />);
    await settle();
    expect(screen.getByText("Reading the settings…")).toBeTruthy();
    expect(screen.getByText("Open a saved connection to set its policy.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Export Policies…" }));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("cannot write");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await settle();
    expect(store.current().dialog).toBeNull();
    expect(entries(" A \n\nB")).toEqual(["A", "B"]);
  });
});

describe("the assistant at its edges", () => {
  it("names a column of no name by its place, and tells a failure of any kind [DESIGN] D55", async () => {
    catalogBackend({
      assistant_ask: () => {
        throw new Error("boom");
      },
      assistant_forget: () => refused({ sqlcode: -910, sqlstate: "HY000", message: "gone" }),
    });
    const store = await opened();
    const id = openWorksheet(store, "VALUES (1)");
    changeWorksheet(store, id, (w) => ({
      ...w,
      runs: [{ ...ran(1), columns: [{ ...must(ran(1).columns[0]), name: null }] }],
    }));
    expect(included(store, { sql: false, plan: false, rows: true }).rows).toBe("(1)\nNULL");
    act(() => {
      store.update((now) => ({ ...now, chat: { ...now.chat, saved: "other" } }));
    });
    await ask(store, "Hi", { sql: false, plan: false, rows: false });
    expect(store.current().chat.items.at(-1)).toEqual({ kind: "error", message: "Error: boom" });
    within(store, <AssistantPanel />);
    expect(screen.getByText("Error: boom").className).toBe("assistant-danger");
  });

  it("reads its settings, policy and log as none where the backend fails [DESIGN] D55", async () => {
    const failing = () => refused({ sqlcode: -910, sqlstate: "HY000", message: "no" });
    catalogBackend({ assistant_settings: failing, assistant_policy: failing, assistant_audit: failing });
    const store = await opened();
    within(store, <AssistantPanel />);
    within(store, <AssistantSettingsDialog />);
    await settle();
    expect(screen.getByText("Reading the settings…")).toBeTruthy();
    expect(screen.getByText(/off until it is turned on/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show the Log" }));
    await settle();
    expect(screen.getByText("Nothing is logged.")).toBeTruthy();
  });

  it("runs a blocked draft of no word named once RUN is typed [DESIGN] D55", async () => {
    const asked = catalogBackend();
    const store = await opened();
    const sheet = openDraft(store, {
      kind: "draft",
      sql: "CALL P()",
      title: "t",
      why: "",
      verdict: { ...BLOCKED, confirm: null },
      estimate: null,
    });
    const running = runStatements(store, sheet, [{ sql: "CALL P()", from: 0, to: 8 }]);
    const question = store.current().dialog;
    if (question?.kind !== "prompt") {
      throw new Error("no question");
    }
    expect(question.label).toMatch(/Type RUN/);
    within(store, <PromptDialog {...question} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "run" } });
    fireEvent.submit(screen.getByRole("textbox"));
    await running;
    expect(asked.some((a) => a.command === "run_statement")).toBe(true);
  });
});
