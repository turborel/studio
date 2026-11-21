import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { AssistantPanel } from "../assistant/AssistantPanel";
import { AssistantSettingsDialog } from "../assistant/AssistantSettings";
import { MonitorPanel } from "../admin/MonitorPanel";
import { SecurityDialog } from "../admin/SecurityDialog";
import { LivePanel } from "../live/LivePanel";
import { JoinDialog, LiveSettingsDialog } from "../live/LiveDialogs";
import { changeLive } from "../live/live";
import { catalogBackend, opened, settle, within } from "../test/catalog";

/** The roles of controls, each of which needs a name. */
const ROLES = ["button", "textbox", "checkbox", "combobox", "spinbutton", "tab", "radio"] as const;

/** Asserts no control drawn is of no accessible name. */
function everyControlNamed(): void {
  for (const role of ROLES) {
    expect(screen.queryAllByRole(role, { name: "" }).map((e) => e.outerHTML.slice(0, 120))).toEqual([]);
  }
}

afterEach(cleanup);

describe("keyboard and reader reach", () => {
  it("names every control of the assistant, Live Sessions and administration [RULE] R-UI-3", async () => {
    catalogBackend({
      assistant_settings: () => ({
        settings: {
          format: 1,
          enabled: true,
          provider: "own",
          claudeModel: "m",
          own: { baseUrl: "http://localhost:1", model: "x", wire: "anthropic", tools: true },
        },
        keys: { claude: false, own: false },
        claudeModels: ["m"],
      }),
      assistant_policy: () => ({
        level: "read",
        preview: true,
        redactLiterals: false,
        allowClasses: [],
        denyClasses: [],
        allowObjects: [],
        denyObjects: [],
        hidden: [],
        limits: { rows: 1, statementSeconds: 1, toolCalls: 1, tokens: 1024 },
        login: null,
      }),
      live_settings: () => ({
        format: 1,
        enabled: true,
        name: "Ann",
        environments: {
          development: { share: true, values: true },
          test: { share: true, values: true },
          production: { share: true, values: false },
        },
        rowLimit: 1,
        maskedColumns: [],
        allowCopy: false,
        allowSuggest: true,
        maxViewers: 1,
        inviteMinutes: 1,
        connectivity: { direct: true, port: 0, advertise: [], relay: false, relayAddress: "", relayFingerprint: "" },
        locked: false,
      }),
      admin_view: () => ({ columns: ["ID", "STATE"], rows: [["1", "RUNNING"]], absent: false }),
    });
    const store = await opened();
    act(() => {
      changeLive(store, (l) => ({
        ...l,
        status: {
          hosted: {
            session: "0".repeat(32),
            fingerprint: "AB",
            direct: [],
            relay: null,
            participants: [
              { id: 1, name: "Bob", role: "viewer", grants: { copy: false, suggest: false }, hand: false },
            ],
            presenter: null,
            choices: { rowLimit: 1, copy: false, productionValues: false },
          },
          joined: null,
        },
        asking: [{ id: 2, name: "Cy", code: "123 456" }],
        invite: { code: "turborel-live:x", link: "turborel-studio://join?code=x", expires: 0 },
      }));
    });
    const views: ReactNode[] = [
      <LivePanel key="live" />,
      <JoinDialog key="join" opened={null} />,
      <LiveSettingsDialog key="live-settings" />,
      <AssistantPanel key="assistant" />,
      <AssistantSettingsDialog key="assistant-settings" />,
      <MonitorPanel key="monitor" />,
      <SecurityDialog key="user" connection={1} form={{ kind: "createUser" }} />,
      <SecurityDialog key="grant" connection={1} form={{ kind: "privileges", table: "T", title: "T" }} />,
    ];
    for (const view of views) {
      within(store, view);
      await settle();
      everyControlNamed();
      cleanup();
    }
    within(store, <MonitorPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    await settle();
    everyControlNamed();
  });
});
