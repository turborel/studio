import type { SavedView } from "../ipc/saved";
import { tree } from "./connectionsTree";

/** A saved connection of `name`, in `folder`. */
function view(id: string, name: string, folder: string[], pinned = false): SavedView {
  return {
    connection: { id, name, folder, spec: {}, environment: "development", colour: null, readOnly: false, pinned },
    passwordSaved: false,
  };
}

describe("the connections' tree", () => {
  it("puts each connection in its folder, folders and names in order [DESIGN] D28", () => {
    const list = {
      connections: [
        view("1", "b", []),
        view("2", "a", ["Team", "EU"]),
        view("3", "A10", []),
        view("4", "A9", []),
        view("5", "x", ["Team"]),
      ],
      recent: [],
    };
    const { root } = tree(list);
    expect(root.connections.map((v) => v.connection.name)).toEqual(["A9", "A10", "b"]);
    expect(root.folders.map((f) => f.name)).toEqual(["Team"]);
    expect(root.folders[0]?.connections.map((v) => v.connection.name)).toEqual(["x"]);
    expect(root.folders[0]?.folders[0]?.connections.map((v) => v.connection.name)).toEqual(["a"]);
  });

  it("lists the pinned first and the recent by when they were used [DESIGN] D28", () => {
    const list = {
      connections: [view("1", "b", [], true), view("2", "a", [], true), view("3", "c", [])],
      recent: ["3", "1", "9"],
    };
    const { pinned, recent } = tree(list);
    expect(pinned.map((v) => v.connection.name)).toEqual(["a", "b"]);
    expect(recent.map((v) => v.connection.name)).toEqual(["c", "b"]);
  });
});
