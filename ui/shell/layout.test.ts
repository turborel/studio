import type { DockviewApi } from "dockview-react";
import { defaultLayout, PANELS, showPanel, SIDE_WIDTH } from "./layout";

describe("the dock's first layout", () => {
  it("puts the explorer left, and details and the assistant right of the centre [DESIGN] D14", () => {
    const added: unknown[] = [];
    const api = { addPanel: (options: unknown) => added.push(options) } as unknown as DockviewApi;
    defaultLayout(api);
    expect(added).toEqual([
      { id: PANELS.welcome.id, component: PANELS.welcome.id, title: "Start" },
      {
        id: PANELS.explorer.id,
        component: PANELS.explorer.id,
        title: "Explorer",
        position: { referencePanel: PANELS.welcome.id, direction: "left" },
        initialWidth: SIDE_WIDTH,
      },
      {
        id: PANELS.details.id,
        component: PANELS.details.id,
        title: "Details",
        position: { referencePanel: PANELS.welcome.id, direction: "right" },
        initialWidth: SIDE_WIDTH,
      },
      {
        id: PANELS.assistant.id,
        component: PANELS.assistant.id,
        title: "Assistant",
        position: { referencePanel: PANELS.details.id, direction: "within" },
        inactive: true,
      },
    ]);
  });
});

describe("a panel shown", () => {
  it("is made active if the layout has it, else added beside details, or alone [DESIGN] D55", () => {
    const made: string[] = [];
    const added: unknown[] = [];
    const panels: Record<string, { id: string; api: { setActive: () => void } }> = {};
    const api = {
      getPanel: (id: string) => panels[id],
      addPanel: (options: unknown) => added.push(options),
    } as unknown as DockviewApi;
    showPanel(api, "assistant");
    panels["details"] = { id: "details", api: { setActive: () => made.push("details") } };
    showPanel(api, "assistant");
    showPanel(api, "details");
    expect(made).toEqual(["details"]);
    expect(added).toEqual([
      { id: "assistant", component: "assistant", title: "Assistant" },
      {
        id: "assistant",
        component: "assistant",
        title: "Assistant",
        position: { referencePanel: "details", direction: "within" },
      },
    ]);
  });
});
