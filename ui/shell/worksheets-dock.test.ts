import type { DockviewApi } from "dockview-react";
import { Store } from "../state/store";
import { must } from "../test/catalog";
import { changeWorksheet, openWorksheet } from "../state/worksheets";
import { MODEL_PANEL, modelTitle, syncModels, syncWorksheets, tabTitle, WORKSHEET_PANEL } from "./Dock";
import { changeModel, closeModel, modelOf, openModel } from "../model/models";
import { emptyModel } from "../model/model";

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

describe("the dock's worksheets and models together", () => {
  it("keep a model shown as the store changes, a worksheet shown only as it becomes the active one [DESIGN] D46", () => {
    const store = new Store();
    const { dock } = fakeDock();
    const a = openWorksheet(store, "VALUES (1)", "A");
    const stopSheets = syncWorksheets(dock as unknown as DockviewApi, store);
    const stopModels = syncModels(dock as unknown as DockviewApi, store);
    const model = openModel(store, emptyModel("Shop"));
    expect(dock.activePanel?.id).toBe(MODEL_PANEL + model);
    changeWorksheet(store, a, (w) => ({ ...w, text: "VALUES (2)" }));
    expect(dock.activePanel?.id).toBe(MODEL_PANEL + model);
    const b = openWorksheet(store, "", "B");
    expect(dock.activePanel?.id).toBe(WORKSHEET_PANEL + b);
    stopModels();
    stopSheets();
  });
});

describe("the dock's models", () => {
  it("are a panel each, titled, shown when active, and closed with the model or by its tab [DESIGN] D46", () => {
    const store = new Store();
    const { dock, closeByHand, activate } = fakeDock();
    const a = openModel(store, emptyModel("Sales"));
    const stop = syncModels(dock as unknown as DockviewApi, store);
    const b = openModel(store, emptyModel("Stock"));
    expect(dock.panels.map((p) => p.id)).toEqual(["welcome", MODEL_PANEL + a, MODEL_PANEL + b]);
    expect(dock.activePanel?.id).toBe(MODEL_PANEL + b);
    changeModel(store, a, (m) => ({ ...m, modified: true }));
    expect(dock.getPanel(MODEL_PANEL + a)?.title).toBe("Sales •");
    activate(dock.getPanel(MODEL_PANEL + a));
    expect(store.current().activeModel).toBe(a);
    activate(dock.getPanel("welcome"));
    activate(undefined);
    const panelB = dock.getPanel(MODEL_PANEL + b);
    if (panelB !== undefined) {
      closeByHand(panelB);
    }
    expect(store.current().models.map((m) => m.id)).toEqual([a]);
    closeModel(store, a);
    expect(dock.panels.map((p) => p.id)).toEqual(["welcome"]);
    const closed = {
      id: a,
      model: emptyModel("X"),
      path: null,
      modified: false,
      connection: null,
      filter: "",
      hidden: [],
      grouped: false,
      selected: null,
      told: "",
    };
    expect(modelTitle(closed)).toBe("X");
    expect(modelOf(store.current(), a)).toBeUndefined();
    stop();
  });
});
