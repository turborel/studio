import type { DockviewApi } from "dockview-react";
import { Store } from "../state/store";
import { must } from "../test/catalog";
import { changeWorksheet, openWorksheet } from "../state/worksheets";
import { syncWorksheets, tabTitle, WORKSHEET_PANEL } from "./Dock";

/** A panel of the fake dock. */
interface FakePanel {
  id: string;
  title: string;
  params: unknown;
  api: { setTitle: (t: string) => void; setActive: () => void };
}

/** A dock of no layout, as dockview's API is used: its panels, and its listeners told by hand. */
function fakeDock() {
  const panels: FakePanel[] = [
    { id: "welcome", title: "Start", params: {}, api: { setTitle: () => undefined, setActive: () => undefined } },
  ];
  let removed: (p: FakePanel) => void = () => undefined;
  let activated: (e: { panel: FakePanel | undefined }) => void = () => undefined;
  const dock = {
    panels,
    activePanel: undefined as FakePanel | undefined,
    addPanel: (options: { id: string; title: string; params: unknown }) => {
      const panel: FakePanel = {
        ...options,
        api: {
          setTitle: (t) => {
            panel.title = t;
          },
          setActive: () => {
            dock.activePanel = panel;
          },
        },
      };
      panels.push(panel);
    },
    removePanel: (panel: FakePanel) => {
      panels.splice(panels.indexOf(panel), 1);
      removed(panel);
    },
    getPanel: (id: string) => panels.find((p) => p.id === id),
    onDidRemovePanel: (listener: (p: FakePanel) => void) => {
      removed = listener;
      return { dispose: () => undefined };
    },
    onDidActivePanelChange: (listener: (e: { panel: FakePanel | undefined }) => void) => {
      activated = listener;
      return { dispose: () => undefined };
    },
  };
  return {
    dock,
    closeByHand: (p: FakePanel) => {
      dock.removePanel(p);
    },
    activate: (p: FakePanel | undefined) => {
      activated({ panel: p });
    },
  };
}

describe("the dock's worksheets", () => {
  it("are a panel each, titled, shown when active, and closed with the worksheet or by its tab [DESIGN] D36", () => {
    const store = new Store();
    const { dock, closeByHand, activate } = fakeDock();
    const a = openWorksheet(store, "VALUES (1)", "A");
    const stop = syncWorksheets(dock as unknown as DockviewApi, store);
    const b = openWorksheet(store, "", "B");
    expect(dock.panels.map((p) => p.id)).toEqual(["welcome", WORKSHEET_PANEL + a, WORKSHEET_PANEL + b]);
    expect(dock.activePanel?.id).toBe(WORKSHEET_PANEL + b);
    changeWorksheet(store, a, (w) => ({ ...w, pinned: true }));
    expect(dock.getPanel(WORKSHEET_PANEL + a)?.title).toBe("A • (pinned)");
    activate(dock.getPanel(WORKSHEET_PANEL + a));
    expect(store.current().activeWorksheet).toBe(a);
    activate(dock.getPanel("welcome"));
    activate(undefined);
    const panelB = dock.getPanel(WORKSHEET_PANEL + b);
    if (panelB !== undefined) {
      closeByHand(panelB);
    }
    expect(store.current().worksheets.map((w) => w.id)).toEqual([a]);
    store.update((now) => ({ ...now, worksheets: [] }));
    expect(dock.panels.map((p) => p.id)).toEqual(["welcome"]);
    expect(tabTitle({ ...must(store.current().closedWorksheets[0]), modified: false, pinned: false })).toBe("B");
    stop();
  });
});
