import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import type { HostedView, LiveStatus, Participant, SharedWorkspace } from "../ipc/live";
import { openModel } from "../model/models";
import { emptyModel } from "../model/model";
import { told } from "../state/actions";
import type { Store } from "../state/store";
import { changeWorksheet, openWorksheet, type RunResult, worksheetOf } from "../state/worksheets";
import { catalogBackend, must, opened, refused, settle, within } from "../test/catalog";
import { tabMenu } from "../worksheet/menus";
import { JoinDialog } from "./LiveDialogs";
import { LivePanel } from "./LivePanel";
import { changeLive, dropSuggestion, presenting, takeSuggestion, toggleShared, workspaceOf } from "./live";
import { SharedView, shownTab } from "./SharedView";

/** A participant, Bob, a viewer of no grants. */
const BOB: Participant = { id: 1, name: "Bob", role: "viewer", grants: { copy: false, suggest: false }, hand: true };

/** The session hosted, of Bob. */
const HOSTED: HostedView = {
  session: "0123456789abcdef0123456789abcdef",
  fingerprint: "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89",
  direct: ["192.0.2.7:4500"],
  relay: null,
  participants: [BOB],
  presenter: null,
  choices: { rowLimit: 100, copy: false, productionValues: false },
};

/** A workspace shown of a worksheet, a diagram and findings. */
const SHOWN: SharedWorkspace = {
  tabs: [
    {
      id: "w1",
      kind: "worksheet",
      title: "Sales",
      environment: "development",
      values: true,
      text: "SELECT ID, PAY FROM T",
      selection: { from: 7, to: 9 },
      results: {
        columns: [
          { name: "ID", typeName: "INTEGER", masked: false },
          { name: "PAY", typeName: "DECIMAL", masked: true },
        ],
        rows: [["1", null]],
        cut: true,
      },
      messages: ["1 row"],
      plan: ["-- physical:", "SeqScan ANN.T  (rows=4)"],
      document: null,
    },
    {
      id: "w2",
      kind: "worksheet",
      title: "Prod",
      environment: "production",
      values: false,
      text: "SELECT 1",
      selection: null,
      results: { columns: [{ name: null, typeName: "INTEGER", masked: false }], rows: [], cut: true },
      messages: [],
      plan: [],
      document: null,
    },
    {
      id: "m1",
      kind: "model",
      title: "Diagram",
      environment: null,
      values: true,
      text: "",
      selection: null,
      results: null,
      messages: [],
      plan: [],
      document: { model: emptyModel("Diagram"), grouped: false, hidden: [] },
    },
    {
      id: "f1",
      kind: "findings",
      title: "Findings",
      environment: null,
      values: true,
      text: "",
      selection: null,
      results: null,
      messages: [],
      plan: [],
      document: [{ rule: "TABLE-NO-KEY", object: "ANN.T", says: "no key", fix: "" }],
    },
  ],
  active: "w1",
  pointer: { tab: 0, x: 0.5, y: 0.5 },
  copy: false,
};

/** A run of column N, of one row. */
function ran(): RunResult {
  return {
    id: 1,
    sql: "SELECT N FROM T",
    from: 0,
    to: 15,
    connection: 1,
    started: 0,
    millis: 1,
    outcome: null,
    columns: [{ name: "N", typeWritten: "INTEGER", typeName: null, notNull: false }],
    rows: [["7"]],
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

/** Sets the status to `status`. */
function as(store: Store, status: LiveStatus): void {
  act(() => {
    changeLive(store, (l) => ({ ...l, status }));
  });
}

afterEach(cleanup);

describe("the window's Live Sessions", () => {
  it("takes the host's events: asking, turned, suggestions, a guest's presenting and the rest [DESIGN] D56", async () => {
    const asked = catalogBackend({ live_status: () => ({ hosted: HOSTED, joined: null }) });
    const store = await opened();
    act(() => {
      told(store, { kind: "liveHost", event: { kind: "asked", id: 1, name: "Bob", code: "123 456" } });
      told(store, { kind: "liveHost", event: { kind: "asked", id: 2, name: "Eve", code: "654 321" } });
      told(store, { kind: "liveHost", event: { kind: "turned", name: "Eve", why: "not admitted" } });
      told(store, { kind: "liveHost", event: { kind: "suggested", id: 1, name: "Bob", tab: "w9", sql: "SELECT 2" } });
      told(store, { kind: "liveHost", event: { kind: "state", state: SHOWN, presenter: "Bob" } });
      told(store, { kind: "liveHost", event: { kind: "joined", id: 1, name: "Bob" } });
    });
    await settle();
    const live = store.current().live;
    expect(live.asking).toEqual([]);
    expect(live.suggestions.map((s) => s.sql)).toEqual(["SELECT 2"]);
    expect(live.shown?.presenter).toBe("Bob");
    expect(live.status.hosted?.participants).toEqual([BOB]);
    expect(asked.some((a) => a.command === "live_status")).toBe(true);
    const suggestion = must(live.suggestions[0]);
    const id = takeSuggestion(store, suggestion);
    expect(worksheetOf(store.current(), id)?.title).toBe("Suggested by Bob");
    expect(store.current().live.suggestions).toEqual([]);
  });

  it("takes the guest's events, and lets all go as the session ends [DESIGN] D56", async () => {
    catalogBackend();
    const store = await opened();
    as(store, { hosted: null, joined: { code: "111 222", role: "viewer", grants: { copy: false, suggest: false } } });
    act(() => {
      told(store, { kind: "liveGuest", event: { kind: "waiting", code: "111 222" } });
    });
    expect(store.current().live.waiting).toBe("111 222");
    act(() => {
      told(store, {
        kind: "liveGuest",
        event: { kind: "admitted", role: "viewer", grants: { copy: true, suggest: false } },
      });
      told(store, { kind: "liveGuest", event: { kind: "state", state: SHOWN, presenter: "Ann" } });
      told(store, {
        kind: "liveGuest",
        event: { kind: "role", role: "presenter", grants: { copy: true, suggest: true } },
      });
    });
    expect(store.current().live.waiting).toBeNull();
    expect(presenting(store.current().live)).toBe(true);
    for (const [kind, says] of [
      ["removed", "removed you"],
      ["ended", "ended the session"],
      ["lost", "lost"],
    ] as const) {
      as(store, { hosted: null, joined: { code: "1", role: "viewer", grants: { copy: false, suggest: false } } });
      act(() => {
        told(store, { kind: "liveGuest", event: { kind } });
      });
      expect(store.current().live.told).toContain(says);
      expect(store.current().live.shown).toBeNull();
      expect(store.current().live.status.joined).toBeNull();
    }
    act(() => {
      told(store, { kind: "liveGuest", event: { kind: "refused", why: "the invitation was used" } });
    });
    expect(store.current().live.told).toBe("Not admitted: the invitation was used");
  });

  it("shares the tabs picked: a worksheet's text, result, messages and plan, a model, and the findings [DESIGN] D56", async () => {
    catalogBackend();
    const store = await opened();
    const sheet = openWorksheet(store, "SELECT N FROM T");
    changeWorksheet(store, sheet, (w) => ({
      ...w,
      runs: [ran()],
      messages: [{ at: 0, kind: "notice", text: "hello", position: null }],
    }));
    const model = openModel(store, emptyModel("Sales"), { connection: 1 });
    toggleShared(store, sheet);
    toggleShared(store, model);
    toggleShared(store, "gone");
    changeLive(store, (l) => ({
      ...l,
      findings: { title: "Findings of ANN", connection: 1, findings: [] },
      pointer: { tab: 0, x: 0.1, y: 0.2 },
    }));
    const shared = workspaceOf(store.current());
    expect(shared.tabs.map((t) => t.kind)).toEqual(["worksheet", "model", "findings"]);
    const [w, m] = shared.tabs;
    expect(w?.results?.columns).toEqual([{ name: "N", typeName: "INTEGER" }]);
    expect(w?.messages).toEqual(["hello"]);
    expect(w?.connection).toBe(1);
    expect(m?.title).toBe("Sales");
    expect(shared.active).toBe(sheet);
    expect(shared.pointer).toEqual({ tab: 0, x: 0.1, y: 0.2 });
    toggleShared(store, model);
    expect(store.current().live.shared).toEqual([sheet, "gone"]);
    dropSuggestion(store, { at: 0, id: 1, name: "B", tab: "x", sql: "S" });
    const menu = tabMenu(store, sheet, [sheet]);
    expect(menu.some((i) => i !== "separator" && i.label === "Stop Sharing in Live Session")).toBe(true);
  });
});

describe("the Live Session panel", () => {
  it("presents, invites, admits, grants, hands over, removes, takes suggestions and ends [DESIGN] D56", async () => {
    let hosted: HostedView = HOSTED;
    const asked = catalogBackend({
      live_present: () => ({ hosted, joined: null }),
      live_status: () => ({ hosted, joined: null }),
      live_invite: () => ({
        code: "turborel-live:abc",
        link: "turborel-studio://join?code=abc",
        expires: 1_900_000_000,
      }),
      live_hand_over: (args) => {
        hosted = {
          ...hosted,
          presenter: args["id"] as number | null,
          participants: [{ ...BOB, role: args["id"] === null ? "viewer" : "presenter" }],
        };
        return null;
      },
      live_choose: () => refused({ sqlcode: -910, sqlstate: "HY000", message: "the settings are locked" }),
    });
    const store = await opened();
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: (t: string) => Promise.resolve(copied.push(t)) },
      configurable: true,
    });
    within(store, <LivePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Present" }));
    await settle();
    expect(screen.getByText(/192.0.2.7:4500/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New Invitation" }));
    await settle();
    expect(screen.getByRole("textbox", { name: "Invitation code" })).toHaveProperty("value", "turborel-live:abc");
    fireEvent.click(screen.getByRole("button", { name: "Copy Invitation" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy Invite Link" }));
    expect(copied).toEqual(["turborel-live:abc", "turborel-studio://join?code=abc"]);
    act(() => {
      told(store, { kind: "liveHost", event: { kind: "asked", id: 3, name: "Cy", code: "123 456" } });
      told(store, { kind: "liveHost", event: { kind: "asked", id: 4, name: "Dee", code: "654 321" } });
    });
    expect(screen.getByText("123 456")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Admit" })[0] ?? document.body);
    fireEvent.click(screen.getAllByRole("button", { name: "Refuse" })[0] ?? document.body);
    await settle();
    expect(asked.filter((a) => a.command === "live_answer").map((a) => a.args)).toEqual([
      { id: 3, yes: true },
      { id: 4, yes: false },
    ]);
    expect(screen.getByLabelText("hand raised")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "May suggest" }));
    fireEvent.click(screen.getByRole("button", { name: "Make Presenter" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Take Back" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await settle();
    expect(asked.find((a) => a.command === "live_grant")?.args).toEqual({ id: 1, suggest: true });
    expect(asked.filter((a) => a.command === "live_hand_over").map((a) => a.args)).toEqual([{ id: 1 }, { id: null }]);
    expect(asked.find((a) => a.command === "live_remove")?.args).toEqual({ id: 1 });
    fireEvent.click(screen.getByRole("checkbox", { name: "Viewers may copy" }));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("the settings are locked");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Rows of a result shared" }), { target: { value: "5" } });
    fireEvent.blur(screen.getByRole("spinbutton", { name: "Rows of a result shared" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Share production's values" }));
    await settle();
    expect(asked.filter((a) => a.command === "live_choose").map((a) => a.args["choices"])).toContainEqual({
      rowLimit: 5,
      copy: false,
      productionValues: false,
    });
    const sheet = openWorksheet(store, "SELECT 1");
    act(() => {
      told(store, { kind: "liveHost", event: { kind: "suggested", id: 1, name: "Bob", tab: sheet, sql: "SELECT 9" } });
      changeLive(store, (l) => ({ ...l, findings: { title: "Findings of ANN", connection: null, findings: [] } }));
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Untitled" }));
    expect(store.current().live.shared).toContain(sheet);
    fireEvent.click(screen.getByRole("checkbox", { name: "Findings of ANN" }));
    expect(store.current().live.findings).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open in Worksheet" }));
    expect(store.current().worksheets.at(-1)?.text).toBe("SELECT 9");
    fireEvent.click(screen.getByRole("button", { name: "End Session" }));
    await settle();
    expect(store.current().live.told).toBe("The session is ended.");
    expect(screen.getByRole("button", { name: "Join…" })).toBeTruthy();
  });

  it("shows a viewer its safety code, its hand, the workspace, and leaves [DESIGN] D56", async () => {
    const asked = catalogBackend();
    const store = await opened();
    as(store, { hosted: null, joined: { code: "111 222", role: "viewer", grants: { copy: false, suggest: true } } });
    act(() => {
      changeLive(store, (l) => ({ ...l, waiting: "111 222" }));
    });
    within(store, <LivePanel />);
    expect(screen.getByText("111 222")).toBeTruthy();
    act(() => {
      told(store, {
        kind: "liveGuest",
        event: { kind: "admitted", role: "viewer", grants: { copy: false, suggest: true } },
      });
      told(store, { kind: "liveGuest", event: { kind: "state", state: SHOWN, presenter: "Ann" } });
    });
    expect(screen.getByText("Presented by Ann")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Raise Hand" }));
    await settle();
    expect(asked.find((a) => a.command === "live_hand")?.args).toEqual({ up: true });
    fireEvent.change(screen.getByRole("textbox", { name: "SQL to suggest" }), { target: { value: "SELECT 3" } });
    fireEvent.submit(screen.getByRole("textbox", { name: "SQL to suggest" }));
    await settle();
    expect(asked.find((a) => a.command === "live_suggest")?.args).toEqual({ tab: "w1", sql: "SELECT 3" });
    as(store, { hosted: null, joined: { code: "1", role: "presenter", grants: { copy: false, suggest: false } } });
    expect(screen.getByText(/You present/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    await settle();
    expect(store.current().live.told).toBe("You left the session.");
  });

  it("joins by an invitation, and tells why not [DESIGN] D56", async () => {
    let fail = true;
    catalogBackend({
      live_join: () =>
        fail
          ? refused({ sqlcode: -910, sqlstate: "HY000", message: "the invitation has expired" })
          : { hosted: null, joined: { code: "1", role: "viewer", grants: { copy: false, suggest: false } } },
    });
    const store = await opened();
    within(store, <JoinDialog opened={null} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Invitation" }), { target: { value: "turborel-live:x" } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("the invitation has expired");
    fail = false;
    act(() => {
      store.update((now) => ({ ...now, dialog: { kind: "liveJoin" } }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await settle();
    expect(store.current().dialog).toBeNull();
    expect(store.current().live.status.joined?.code).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });
});

describe("the shared workspace", () => {
  it("draws the SQL marked, the result masked and cut, messages, plan, diagram and findings, and stops copying [DESIGN] D56", async () => {
    catalogBackend();
    const store = await opened();
    act(() => {
      changeLive(store, (l) => ({ ...l, shown: { workspace: SHOWN, presenter: "Ann" } }));
    });
    within(store, <SharedView canSuggest={false} />);
    expect(document.querySelector("mark")?.textContent).toBe("ID");
    expect(screen.getByRole("table", { name: "Result" }).textContent).toContain("•••");
    expect(screen.getByText("The first 1 rows are shared.")).toBeTruthy();
    expect(screen.getByText("1 row")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Shared plan" })).toBeTruthy();
    const panel = screen.getByRole("tabpanel");
    expect(panel.className).toContain("live-nocopy");
    expect(fireEvent.copy(panel)).toBe(false);
    expect(panel.querySelector(".live-pointer")).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Prod" }));
    expect(screen.getByText(/not its values/)).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Follow the presenter" })).toHaveProperty("checked", false);
    fireEvent.click(screen.getByRole("tab", { name: "Diagram" }));
    fireEvent.click(screen.getByRole("tab", { name: "Findings" }));
    expect(screen.getByRole("table", { name: "Findings" }).textContent).toContain("TABLE-NO-KEY");
    fireEvent.click(screen.getByRole("checkbox", { name: "Follow the presenter" }));
    expect(store.current().live.follow).toBe(true);
    act(() => {
      changeLive(store, (l) => ({ ...l, shown: { workspace: { ...SHOWN, tabs: [], copy: true }, presenter: "Ann" } }));
    });
    expect(screen.getByText("The presenter shares no tab now.")).toBeTruthy();
    expect(shownTab({ ...SHOWN, active: null }, true, null)?.id).toBe("w1");
  });

  it("says it waits, and draws a diagram it cannot as such [DESIGN] D56", async () => {
    catalogBackend();
    const store = await opened();
    within(store, <SharedView canSuggest={false} />);
    expect(screen.getByText(/Waiting for the presenter/)).toBeTruthy();
    const broken = { ...SHOWN, tabs: [{ ...must(SHOWN.tabs[2]), document: { model: null } }], active: "m1" };
    act(() => {
      changeLive(store, (l) => ({ ...l, shown: { workspace: broken, presenter: "Ann" } }));
    });
    expect(screen.getByText("This diagram cannot be drawn.")).toBeTruthy();
  });
});
