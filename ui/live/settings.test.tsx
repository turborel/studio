import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { HostedView, LiveSettings, LiveStatus, Participant } from "../ipc/live";
import { COMMANDS, type CommandContext } from "../commands/commands";
import type { Store } from "../state/store";
import { openWorksheet } from "../state/worksheets";
import { catalogBackend, must, opened, refused, settle, within } from "../test/catalog";
import { LiveSettingsDialog } from "./LiveDialogs";
import { changeLive, toggleShared } from "./live";
import { pointerOf, SYNC_MS, useLiveSync } from "./sync";

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
  choices: { rowLimit: 100, copy: false, productionValues: false, record: false },
  record: null,
};

/** The settings as first read. */
const SETTINGS: LiveSettings = {
  format: 1,
  enabled: true,
  name: "",
  environments: {
    development: { share: true, values: true },
    test: { share: true, values: true },
    production: { share: true, values: false },
  },
  rowLimit: 100,
  maskedColumns: [],
  allowCopy: false,
  allowSuggest: true,
  maxViewers: 10,
  inviteMinutes: 10,
  connectivity: { direct: true, port: 0, advertise: [], relay: false, relayAddress: "", relayFingerprint: "" },
  locked: false,
  records: { allowed: true, byDefault: false, sealed: false },
};

/** Sets the status to `status`. */
function as(store: Store, status: LiveStatus): void {
  act(() => {
    changeLive(store, (l) => ({ ...l, status }));
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Live Sessions' settings", () => {
  it("are read, edited and kept, and the log shown and cleared [DESIGN] D56", async () => {
    const asked = catalogBackend({
      live_settings: () => SETTINGS,
      save_live_settings: () => null,
      live_audit: () => [{ format: 1, time: 1_700_000_000, what: "admitted", who: "Bob", detail: "x" }],
      clear_live_audit: () => null,
    });
    const store = await opened();
    within(store, <LiveSettingsDialog />);
    await settle();
    fireEvent.change(screen.getByRole("textbox", { name: "Your name, as others see it" }), {
      target: { value: "Ann" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Live Sessions are on" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Production: share its tabs" }));
    fireEvent.click(screen.getAllByRole("checkbox", { name: "and its values" })[0] ?? document.body);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Rows of a result shared" }), { target: { value: "20" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Masked columns, a name a line" }), {
      target: { value: "PAY\n\nSSN" },
    });
    for (const name of [
      "Viewers may copy text out",
      "A viewer may be let suggest SQL",
      "Lock: a session may not widen these",
      "Through a relay",
      "Directly, on this network or by address",
    ]) {
      fireEvent.click(screen.getByRole("checkbox", { name }));
    }
    fireEvent.change(screen.getByRole("spinbutton", { name: "Viewers at most" }), { target: { value: "3" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Minutes an invitation lasts" }), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "UDP port (0 for any)" }), { target: { value: "4500" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Addresses to name (this machine's found, if none)" }), {
      target: { value: "192.0.2.7  198.51.100.1" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Relay's address" }), { target: { value: "relay:4433" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Relay's fingerprint" }), { target: { value: "AB" } });
    fireEvent.click(screen.getByRole("button", { name: "Show the Log" }));
    await settle();
    expect(screen.getByRole("list", { name: "Live Sessions' log" }).textContent).toContain("admitted · Bob · x");
    fireEvent.click(screen.getByRole("button", { name: "Clear the Log" }));
    await settle();
    expect(screen.getByText("Nothing is logged.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Record each session from its start" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Seal records with a key kept in the keychain" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "A session may be recorded" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await settle();
    expect(asked.find((a) => a.command === "save_live_settings")?.args["settings"]).toEqual({
      ...SETTINGS,
      records: { allowed: false, byDefault: true, sealed: true },
      enabled: false,
      name: "Ann",
      environments: {
        ...SETTINGS.environments,
        development: { share: true, values: false },
        production: { share: false, values: false },
      },
      rowLimit: 20,
      maskedColumns: ["PAY", "SSN"],
      allowCopy: true,
      allowSuggest: false,
      locked: true,
      maxViewers: 3,
      inviteMinutes: 5,
      connectivity: {
        direct: false,
        port: 4500,
        advertise: ["192.0.2.7", "198.51.100.1"],
        relay: true,
        relayAddress: "relay:4433",
        relayFingerprint: "AB",
      },
    });
    expect(store.current().dialog).toBeNull();
  });

  it("tell a failure to read or keep them [DESIGN] D56", async () => {
    let reads = false;
    catalogBackend({
      live_settings: () => (reads ? SETTINGS : refused({ sqlcode: -910, sqlstate: "HY000", message: "unreadable" })),
      save_live_settings: () =>
        refused({ sqlcode: -910, sqlstate: "HY000", message: "the rows shared are from 1 to 10000" }),
      live_audit: () => refused({ sqlcode: -910, sqlstate: "HY000", message: "no" }),
    });
    const store = await opened();
    within(store, <LiveSettingsDialog />);
    await settle();
    expect(screen.getByRole("status").textContent).toBe("unreadable");
    cleanup();
    reads = true;
    within(store, <LiveSettingsDialog />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Show the Log" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await settle();
    expect(screen.getByRole("status").textContent).toContain("1 to 10000");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(store.current().dialog).toBeNull();
  });
});

describe("the workspace kept shared", () => {
  it("is sent as it changes while this Studio presents, and the pointer told [DESIGN] D56", async () => {
    const asked = catalogBackend({ live_publish: () => null });
    const store = await opened();
    function Sync() {
      useLiveSync(store);
      return null;
    }
    vi.useFakeTimers();
    const sheet = openWorksheet(store, "SELECT 1");
    toggleShared(store, sheet);
    within(store, <Sync />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_MS * 2);
    });
    expect(asked.some((a) => a.command === "live_publish")).toBe(false);
    as(store, { hosted: HOSTED, joined: null });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_MS * 3);
    });
    expect(asked.filter((a) => a.command === "live_publish")).toHaveLength(1);
    const pointer = pointerOf(store, sheet);
    const target = document.createElement("div");
    target.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => null,
    });
    act(() => {
      pointer.onMouseMove({
        currentTarget: target,
        clientX: 50,
        clientY: 25,
        timeStamp: 1000,
      } as unknown as React.MouseEvent<HTMLElement>);
      pointer.onMouseMove({
        currentTarget: target,
        clientX: 0,
        clientY: 0,
        timeStamp: 1010,
      } as unknown as React.MouseEvent<HTMLElement>);
    });
    expect(store.current().live.pointer).toEqual({ tab: 0, x: 0.25, y: 0.25 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_MS * 2);
    });
    expect(asked.filter((a) => a.command === "live_publish").length).toBe(2);
    act(() => {
      pointer.onMouseLeave();
    });
    expect(store.current().live.pointer).toBeNull();
  });
});

describe("Live Sessions' commands", () => {
  it("open the panel, present, join, share, end, leave and open the settings [DESIGN] D56", async () => {
    const asked = catalogBackend({ live_present: () => ({ hosted: HOSTED, joined: null }) });
    const store = await opened();
    const shown: string[] = [];
    const context: CommandContext = { store, resetLayout: () => undefined, showPanel: (id) => shown.push(id) };
    const run = async (id: string) => {
      const command = must(COMMANDS.find((c) => c.id === id));
      expect(command.enabled(context)).toBe(true);
      await act(async () => {
        await command.run(context);
      });
    };
    await run("live.open");
    await run("live.join");
    expect(store.current().dialog).toEqual({ kind: "liveJoin" });
    await run("live.present");
    expect(asked.some((a) => a.command === "live_present")).toBe(true);
    openWorksheet(store, "SELECT 1");
    await run("live.share");
    expect(store.current().live.shared).toHaveLength(1);
    await run("live.end");
    as(store, { hosted: null, joined: { code: "1", role: "viewer", grants: { copy: false, suggest: false } } });
    await run("live.leave");
    await run("live.settings");
    expect(store.current().dialog).toEqual({ kind: "liveSettings" });
    expect(shown).toEqual(["live", "live", "live"]);
  });
});
