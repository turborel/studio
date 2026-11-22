import { fireEvent, screen, within as inside } from "@testing-library/react";
import type { Found } from "../ipc/catalog";
import { disconnect } from "../state/actions";
import { filterTree, loadSchemas, loadTable, searchCatalog, select } from "../state/catalog";
import { OBJECTS, SECURITY, STAFF, catalogBackend, must, opened, settle, within } from "../test/catalog";
import { EMPTY_CATALOG, tableKey } from "./catalogState";
import { CatalogTree, selectable } from "./CatalogTree";
import { ConnectionsPanel } from "../shell/ConnectionsPanel";
import { ExplorerToolbar } from "./ExplorerToolbar";
import { nodeId, TRUNCATED, treeRows } from "./tree";

describe("the catalog's tree", () => {
  it("shows the schemas, and a schema's folders as it opens [DESIGN] D33", async () => {
    const asked = catalogBackend();
    const store = await opened();
    within(store, <CatalogTree connection={1} />);
    await settle();
    const tree = screen.getByRole("tree", { name: "Catalog" });
    expect(inside(tree).getByText("ANN")).toBeTruthy();
    expect(inside(tree).getByText("Users and Roles")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open ANN" }));
    await settle();
    for (const folder of ["Tables", "Views", "Routines", "Sequences", "Domains"]) {
      expect(inside(tree).getByText(folder)).toBeTruthy();
    }
    expect(asked.filter((a) => a.command === "catalog_objects")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Open Tables" }));
    fireEvent.click(screen.getByRole("button", { name: "Open STAFF" }));
    await settle();
    expect(inside(tree).getByText("ID")).toBeTruthy();
    expect(inside(tree).getByText("INTEGER NOT NULL")).toBeTruthy();
    expect(inside(tree).getByText("STAFF_NAME")).toBeTruthy();
    expect(inside(tree).queryByText("ANN.STAFF.UNIQUE1")).toBeNull();
    expect(inside(tree).getByText("STAMPED")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close ANN" }));
    expect(inside(tree).queryByText("Tables")).toBeNull();
  });

  it("reads the catalog again, and closes its tree, by the explorer's toolbar [DESIGN] D33", async () => {
    const asked = catalogBackend();
    const store = await opened();
    within(
      store,
      <>
        <ExplorerToolbar />
        <CatalogTree connection={1} />
      </>,
    );
    await settle();
    const toolbar = screen.getByRole("toolbar", { name: "Explorer" });
    for (const name of ["New Connection", "Open Database", "New Database", "New In-Memory Database"]) {
      expect(inside(toolbar).getByRole("button", { name }).getAttribute("title")).toContain(name);
    }
    fireEvent.click(screen.getByRole("button", { name: "Open ANN" }));
    await settle();
    fireEvent.click(inside(toolbar).getByRole("button", { name: "Collapse All" }));
    expect(screen.queryByText("Tables")).toBeNull();
    fireEvent.click(inside(toolbar).getByRole("button", { name: "Refresh" }));
    await settle();
    expect(asked.filter((a) => a.command === "catalog_schemas")).toHaveLength(2);
    fireEvent.click(inside(toolbar).getByRole("button", { name: "New Connection" }));
    expect(store.current().dialog).toEqual({ kind: "connection", editing: null });
  });

  it("opens a row's menu by the secondary button or Shift+F10, and the connections' too [DESIGN] D53", async () => {
    catalogBackend();
    const store = await opened();
    within(
      store,
      <>
        <ConnectionsPanel />
        <CatalogTree connection={1} />
      </>,
    );
    await settle();
    const tree = screen.getByRole("tree", { name: "Catalog" });
    const schema = must(inside(tree).getByText("ANN").closest<HTMLElement>("[role='treeitem']"));
    fireEvent.keyDown(schema, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menuitem", { name: "Analyze Schema…" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.contextMenu(schema);
    expect(screen.getByRole("menuitem", { name: "Generate Script…" })).toBeTruthy();
    fireEvent.click(must(document.querySelector(".menu-backdrop")));
    const open = must(
      screen.getByRole("tree", { name: "Open connections" }).querySelector<HTMLElement>("[role='treeitem']"),
    );
    fireEvent.contextMenu(open);
    expect(screen.getByRole("menuitem", { name: "Copy URI" })).toBeTruthy();
    fireEvent.click(must(document.querySelector(".menu-backdrop")));
    const saved = must(
      screen.getByRole("tree", { name: "Saved connections" }).querySelector<HTMLElement>("[role='treeitem']"),
    );
    fireEvent.contextMenu(saved);
    expect(screen.getByRole("menuitem", { name: "Delete…" })).toBeTruthy();
  });

  it("moves by the arrow keys, opens by Right, closes by Left and selects by Enter [RULE] R-UI-1", async () => {
    catalogBackend();
    const store = await opened();
    within(store, <CatalogTree connection={1} />);
    await settle();
    const ann = screen.getByText("ANN").closest<HTMLElement>("[role='treeitem']");
    if (ann === null) {
      throw new Error("no row of ANN");
    }
    ann.focus();
    fireEvent.keyDown(ann, { key: "ArrowRight" });
    await settle();
    expect(ann.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(ann, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("Tables");
    fireEvent.keyDown(document.activeElement ?? ann, { key: "ArrowUp" });
    expect(document.activeElement).toBe(ann);
    fireEvent.keyDown(ann, { key: "Enter" });
    expect(store.current().selected).toEqual({ connection: 1, object: { kind: "schema", schema: "ANN" } });
    fireEvent.keyDown(ann, { key: "ArrowLeft" });
    expect(ann.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(ann, { key: "ArrowLeft" });
    fireEvent.keyDown(ann, { key: "x" });
    expect(ann.getAttribute("aria-expanded")).toBe("false");
  });

  it("filters by name and searches definitions on the server [DESIGN] D33", async () => {
    const found: Found[] = [
      { object: { kind: "TABLE", schema: "ANN", name: "STAFF" }, inDefinition: false },
      { object: { kind: "VIEW", schema: "ANN", name: "PAYROLL" }, inDefinition: true },
      { object: { kind: "TRIGGER", schema: "ANN", name: "STAMPED" }, inDefinition: true },
    ];
    const asked = catalogBackend({ catalog_search: () => found });
    const store = await opened();
    within(
      store,
      <>
        <ExplorerToolbar />
        <CatalogTree connection={1} />
      </>,
    );
    await settle();
    expect(screen.queryByLabelText("Search the catalog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(screen.getByRole("button", { name: "Filter" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(screen.getByLabelText("Search the catalog"), { target: { value: "pay" } });
    await settle();
    const tree = screen.getByRole("tree", { name: "Catalog" });
    expect(inside(tree).getByText("PAYROLL")).toBeTruthy();
    expect(inside(tree).queryByText("STAFF")).toBeNull();
    expect(inside(tree).queryByText("Tables")).toBeNull();
    expect(inside(tree).queryByText("Users and Roles")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search definitions too" }));
    await settle();
    expect(inside(tree).getByText("Users and Roles")).toBeTruthy();
    expect(asked.find((a) => a.command === "catalog_search")?.args).toEqual({ connection: 1, text: "pay" });
    const list = screen.getByRole("list", { name: "Found" });
    expect(inside(list).getByText("VIEW ANN.PAYROLL (in its definition)")).toBeTruthy();
    expect(inside(list).getByText("TRIGGER ANN.STAMPED (in its definition)").tagName).toBe("LI");
    fireEvent.click(inside(list).getByText("TABLE ANN.STAFF"));
    await settle();
    expect(store.current().selected?.object).toEqual({ kind: "table", schema: "ANN", name: "STAFF" });
    fireEvent.keyDown(screen.getByLabelText("Search the catalog"), { key: "Enter" });
    await settle();
    expect(asked.filter((a) => a.command === "catalog_search")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Search definitions too" }));
    fireEvent.keyDown(screen.getByLabelText("Search the catalog"), { key: "Escape" });
    expect(store.current().explorerSearch).toBe(false);
    expect(screen.queryByLabelText("Search the catalog")).toBeNull();
  });

  it("says when a search finds nothing, and clears an empty one [DESIGN] D33", async () => {
    catalogBackend({ catalog_search: () => [] });
    const store = await opened();
    await loadSchemas(store, 1);
    await searchCatalog(store, 1, "nothing");
    store.update((now) => ({ ...now, explorerSearch: true }));
    within(store, <CatalogTree connection={1} />);
    expect(screen.getByText("Nothing found.")).toBeTruthy();
    await searchCatalog(store, 1, "  ");
    expect(store.current().catalogs[1]?.found).toBeNull();
  });

  it("keeps a failure to read as the error shown [RULE] R-ERR-1", async () => {
    const failure = {
      sqlcode: -919,
      sqlstate: "08006",
      message: "lost",
      rule: null,
      position: null,
      active: false,
      diagnostics: null,
    };
    catalogBackend({
      catalog_schemas: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the backend rejects with Studio's error, not an Error
        throw failure;
      },
    });
    const store = await opened();
    await loadSchemas(store, 1);
    expect(store.current().error).toEqual(failure);
  });
});

describe("the tree's rows", () => {
  it("are read from what is loaded, each folder with its objects [DESIGN] D33", () => {
    const state = {
      ...EMPTY_CATALOG,
      schemas: [{ name: "ANN", owner: null }],
      objects: { ANN: OBJECTS },
      expanded: [
        nodeId("schema", "ANN"),
        nodeId("folder", "ANN", "Tables"),
        nodeId("table", "ANN", "STAFF"),
        nodeId("folder", "ANN", "Routines"),
        nodeId("security"),
      ],
    };
    const labels = treeRows(state).map((r) => r.label);
    expect(labels).toEqual([
      "ANN",
      "Tables",
      "STAFF",
      "Loading…",
      "Views",
      "Routines",
      "DOUBLED",
      "Sequences",
      "Domains",
      "Types",
      "Users and Roles",
      "Loading…",
    ]);
    const loaded = treeRows({ ...state, tables: { [tableKey("ANN", "STAFF")]: STAFF }, security: SECURITY }).map(
      (r) => r.label,
    );
    expect(labels.length).toBeLessThan(loaded.length);
    expect(loaded).toContain("CLERK");
    expect(treeRows({ ...state, objects: { ANN: { ...OBJECTS, truncated: true } } })[1]?.label).toBe(TRUNCATED);
    expect(treeRows({ ...state, objects: {} }).map((r) => r.label)).toEqual([
      "ANN",
      "Loading…",
      "Users and Roles",
      "Loading…",
    ]);
  });

  it("filtered, keep only the matches and their folders [DESIGN] D33", () => {
    const state = {
      ...EMPTY_CATALOG,
      schemas: [
        { name: "ANN", owner: null },
        { name: "BOB", owner: null },
      ],
      objects: { ANN: OBJECTS },
      filter: "money",
    };
    expect(treeRows(state).map((r) => r.label)).toEqual(["ANN", "Domains", "MONEY"]);
    expect(treeRows({ ...state, filter: "nothing" })).toEqual([]);
  });

  it("select what a search finds, a table, view, column or routine [DESIGN] D33", () => {
    expect(selectable({ kind: "COLUMN", schema: "ANN", name: "STAFF" })).toEqual({
      kind: "table",
      schema: "ANN",
      name: "STAFF",
    });
    expect(selectable({ kind: "ROUTINE", schema: "ANN", name: "DOUBLED_1" })).toEqual({
      kind: "routine",
      schema: "ANN",
      specific: "DOUBLED_1",
      name: "DOUBLED_1",
    });
    expect(selectable({ kind: "TRIGGER", schema: "ANN", name: "STAMPED" })).toBeNull();
    for (const kind of ["sequence", "domain", "type"] as const) {
      expect(selectable({ kind: kind.toUpperCase(), schema: "ANN", name: "N" })).toEqual({
        kind,
        schema: "ANN",
        name: "N",
      });
    }
  });
});

describe("a connection's catalog", () => {
  it("is read once a table at a time, filtered, and forgotten as it ends [DESIGN] D33", async () => {
    const asked = catalogBackend();
    const store = await opened();
    await loadTable(store, 1, "ANN", "STAFF");
    await loadTable(store, 1, "ANN", "STAFF");
    expect(asked.filter((a) => a.command === "catalog_table")).toHaveLength(1);
    await loadSchemas(store, 1);
    await filterTree(store, 1, "x");
    expect(store.current().catalogs[1]?.filter).toBe("x");
    expect(asked.filter((a) => a.command === "catalog_objects")).toHaveLength(1);
    await filterTree(store, 1, "y");
    await filterTree(store, 1, "");
    expect(asked.filter((a) => a.command === "catalog_objects")).toHaveLength(1);
    await select(store, 1, { kind: "schema", schema: "ANN" });
    await disconnect(store, 1);
    expect(store.current().catalogs[1]).toBeUndefined();
    expect(store.current().selected).toBeNull();
  });

  it("keeps no error of a failure not Studio's, and filters a catalog of no schemas read [RULE] R-ERR-1", async () => {
    catalogBackend({ catalog_schemas: () => Promise.reject(new Error("gone")) });
    const store = await opened();
    await loadSchemas(store, 1);
    expect(store.current().error).toBeNull();
    await filterTree(store, 2, "x");
    expect(store.current().catalogs[2]?.filter).toBe("x");
  });
});
