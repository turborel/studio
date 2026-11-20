import { fireEvent, render, screen } from "@testing-library/react";
import type { IDockviewPanelHeaderProps } from "dockview-react";
import type { CommandContext } from "../commands/commands";
import { COMMANDS } from "../commands/commands";
import { EMPTY_CATALOG } from "../explorer/catalogState";
import { iconOf, nodeId, treeRows } from "../explorer/tree";
import { Tab } from "../shell/Dock";
import { Toolbar, TOOLBAR } from "../shell/Toolbar";
import { Store, StoreContext } from "../state/store";
import { mockBackend } from "../test/backend";
import { constraintIcon, Icon, LARGE, toneOf } from "./Icon";

describe("the icons", () => {
  it("are drawn for the eye alone, in the tone of what they do, duotone for emphasis [DESIGN] D35", () => {
    const { container } = render(
      <>
        <Icon name="cancel" size={LARGE} />
        <Icon name="table" emphasis />
      </>,
    );
    const [stop, table] = [...container.querySelectorAll("svg")];
    expect(stop?.getAttribute("aria-hidden")).toBe("true");
    expect(stop?.getAttribute("class")).toBe("icon icon-stop");
    expect(stop?.getAttribute("width")).toBe(String(LARGE));
    expect(table?.getAttribute("class")).toBe("icon icon-plain");
    expect([toneOf("commit"), toneOf("rollback"), toneOf("connect"), toneOf("disconnect")]).toEqual([
      "commit",
      "rollback",
      "connect",
      "disconnect",
    ]);
  });

  it("mark each command of the toolbar, and each kind of the explorer's objects [DESIGN] D35", () => {
    for (const id of TOOLBAR.flat()) {
      expect(COMMANDS.find((c) => c.id === id)?.icon, id).toBeDefined();
    }
    expect([
      constraintIcon("PRIMARY KEY"),
      constraintIcon("UNIQUE"),
      constraintIcon("FOREIGN KEY"),
      constraintIcon("CHECK"),
      constraintIcon("OTHER"),
    ]).toEqual(["key", "key", "foreignKey", "check", "other"]);
    const state = {
      ...EMPTY_CATALOG,
      schemas: [{ name: "ANN", owner: null }],
      objects: {
        ANN: {
          tables: [
            { name: "T", kind: "BASE TABLE" },
            { name: "V", kind: "VIEW" },
          ],
          routines: [],
          sequences: [],
          domains: [],
          types: [],
          truncated: false,
        },
      },
      expanded: [
        nodeId("schema", "ANN"),
        nodeId("folder", "ANN", "Tables"),
        nodeId("folder", "ANN", "Views"),
        nodeId("security"),
      ],
    };
    expect(treeRows(state).map(iconOf)).toEqual([
      "schema",
      "folder",
      "table",
      "folder",
      "view",
      "folder",
      "folder",
      "folder",
      "folder",
      "users",
      null,
    ]);
  });
});

describe("the toolbar", () => {
  it("is of icon buttons in groups apart, each named and its tooltip its key, its labels shown as the settings say [RULE] R-UI-1", () => {
    mockBackend();
    const store = new Store();
    const context: CommandContext = { store, resetLayout: () => undefined };
    const { rerender } = render(
      <StoreContext.Provider value={store}>
        <Toolbar context={context} />
      </StoreContext.Provider>,
    );
    expect(screen.getAllByRole("group")).toHaveLength(TOOLBAR.length);
    expect(screen.getAllByRole("separator")).toHaveLength(TOOLBAR.length - 1);
    const palette = screen.getByRole("button", { name: "Command Palette" });
    expect(palette.title).toMatch(/^Command Palette… \((Cmd|Ctrl)\+Shift\+P\)$/u);
    expect(palette.textContent).toBe("");
    store.update((now) => ({ ...now, settings: { ...now.settings, toolbarLabels: true } }));
    rerender(
      <StoreContext.Provider value={store}>
        <Toolbar context={context} />
      </StoreContext.Provider>,
    );
    expect(screen.getByRole("button", { name: "Command Palette" }).textContent).toBe("Command Palette");
    fireEvent.click(screen.getByRole("button", { name: "Command Palette" }));
    expect(store.current().dialog).toEqual({ kind: "palette" });
  });
});

describe("a dock's tab", () => {
  it("shows its panel's icon before its title [DESIGN] D35", () => {
    /** A panel's API of `component`, each listener's registration a no-op, as the tab asks. */
    const api = (component: string) =>
      new Proxy(
        { component, title: "Explorer", isPinned: false, close: () => undefined },
        {
          get: (target, key: string) =>
            key in target ? target[key as keyof typeof target] : () => ({ dispose: () => undefined }),
        },
      );
    const props = { api: api("explorer"), containerApi: {}, params: {} } as unknown as IDockviewPanelHeaderProps;
    const { container } = render(<Tab {...props} />);
    expect(container.querySelector(".dock-tab svg")).not.toBeNull();
    const other = { ...props, api: api("unknown") } as unknown as IDockviewPanelHeaderProps;
    const { container: plain } = render(<Tab {...other} />);
    expect(plain.querySelector(".dock-tab > svg")).toBeNull();
  });
});
