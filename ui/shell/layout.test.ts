import type { DockviewApi } from "dockview-react";
import { defaultLayout, PANELS, SIDE_WIDTH } from "./layout";

describe("the dock's first layout", () => {
  it("puts the explorer left and details right of the centre [DESIGN] D14", () => {
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
    ]);
  });
});
