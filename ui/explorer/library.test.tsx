import { fireEvent, screen, within as inside } from "@testing-library/react";
import { scriptChosen, toggleChosen, definitionOf } from "../state/catalog";
import { catalogBackend, opened, refused, settle, within } from "../test/catalog";
import { CatalogTree } from "./CatalogTree";
import { Definition } from "./Definition";
import { Library } from "./Library";

describe("the explorer's library", () => {
  it("lists the favourite queries, each opened in a worksheet or forgotten [DESIGN] D36", async () => {
    const asked = catalogBackend({ forget_query: () => [] });
    const store = await opened();
    within(store, <Library />);
    expect(screen.getByText("None yet: Worksheet > Add to Favourite Queries keeps one.")).toBeTruthy();
    store.update((now) => ({ ...now, queries: [{ id: "q1", name: "Staff", sql: "SELECT * FROM STAFF" }] }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Staff" }));
    expect(store.current().worksheets.at(-1)).toMatchObject({ title: "Staff", text: "SELECT * FROM STAFF" });
    fireEvent.click(screen.getByRole("button", { name: "Forget Staff" }));
    await settle();
    expect(asked.find((a) => a.command === "forget_query")?.args).toEqual({ id: "q1" });
    expect(store.current().queries).toEqual([]);
  });

  it("lists each project's .sql files, each opened in a worksheet, and adds and closes projects [DESIGN] D36", async () => {
    const asked = catalogBackend({
      add_project_folder: () => ["/p/reports"],
      project_files: (args) => (args["folder"] === "/p/empty" ? [] : ["daily.sql", "q/weekly.sql"]),
      remove_project_folder: () => ["/p/empty"],
      read_sql_file: (args) => ({ path: args["path"], name: "weekly.sql", text: "VALUES (7)" }),
    });
    const store = await opened();
    within(store, <Library />);
    fireEvent.click(screen.getByRole("button", { name: "Add Project Folder…" }));
    await settle();
    expect(store.current().projects).toEqual(["/p/reports"]);
    const files = screen.getByRole("list", { name: "Files of reports" });
    fireEvent.click(inside(files).getByText("q/weekly.sql"));
    await settle();
    expect(asked.find((a) => a.command === "read_sql_file")?.args).toEqual({ path: "/p/reports/q/weekly.sql" });
    expect(store.current().worksheets.at(-1)?.path).toBe("/p/reports/q/weekly.sql");
    fireEvent.click(screen.getByRole("button", { name: "Close Project" }));
    await settle();
    expect(store.current().projects).toEqual(["/p/empty"]);
    expect(screen.getByText("No .sql files.")).toBeTruthy();
    catalogBackend({
      add_project_folder: () => null,
      project_files: () => Promise.reject(new Error("gone")),
      remove_project_folder: () =>
        refused({
          sqlcode: -910,
          sqlstate: "TB910",
          message: "unwritable",
          rule: null,
          position: null,
          active: false,
          diagnostics: null,
        }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Project Folder…" }));
    await settle();
    expect(store.current().projects).toEqual(["/p/empty"]);
    fireEvent.click(screen.getByRole("button", { name: "Close Project" }));
    await settle();
    expect(store.current().error?.message).toBe("unwritable");
    store.update((now) => ({ ...now, projects: ["C:\\\\work\\\\sql"] }));
    await settle();
    expect(screen.getByText("No .sql files.")).toBeTruthy();
  });
});

describe("the objects chosen", () => {
  it("are chosen by Cmd or Ctrl and a click, and scripted in a worksheet [DESIGN] D33", async () => {
    const asked = catalogBackend();
    const store = await opened();
    within(store, <CatalogTree connection={1} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Open ANN" }));
    await settle();
    fireEvent.click(screen.getByText("ANN"), { metaKey: true });
    expect(store.current().catalogs[1]?.chosen).toEqual([{ kind: "schema", schema: "ANN" }]);
    toggleChosen(store, 1, { kind: "user", name: "ANN" });
    toggleChosen(store, 1, { kind: "role", name: "R" });
    toggleChosen(store, 1, { kind: "role", name: "R" });
    toggleChosen(store, 1, { kind: "routine", schema: "ANN", specific: "D_1", name: "D" });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Script 3 Chosen" }));
    await settle();
    expect(store.current().worksheets.at(-1)?.title).toBe("Script");
    expect(asked.filter((a) => a.command === "catalog_definition")).toHaveLength(2);
    expect(store.current().catalogs[1]?.chosen).toEqual([]);
    expect(definitionOf({ kind: "role", name: "R" })).toBeNull();
    expect(definitionOf({ kind: "type", schema: "ANN", name: "T" })).toEqual({
      kind: "type",
      schema: "ANN",
      name: "T",
    });
    catalogBackend({
      catalog_definition: () =>
        refused({
          sqlcode: -910,
          sqlstate: "TB910",
          message: "none",
          rule: null,
          position: null,
          active: false,
          diagnostics: null,
        }),
    });
    toggleChosen(store, 1, { kind: "table", schema: "ANN", name: "STAFF" });
    expect(await scriptChosen(store, 1)).toBeNull();
    expect(store.current().error?.message).toBe("none");
  });

  it("carry a table dragged from the tree, for the editor [DESIGN] D36", async () => {
    catalogBackend();
    const store = await opened();
    within(store, <CatalogTree connection={1} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Open ANN" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Open Tables" }));
    const set: Record<string, string> = {};
    const dataTransfer = { setData: (type: string, value: string) => (set[type] = value), effectAllowed: "" };
    fireEvent.dragStart(screen.getByText("STAFF"), { dataTransfer });
    expect(JSON.parse(set["application/x-turborel-table"] ?? "{}")).toEqual({ schema: "ANN", name: "STAFF" });
    fireEvent.dragStart(screen.getByText("ANN"), { dataTransfer });
  });

  it("open a definition in a worksheet of its own [DESIGN] D33", async () => {
    catalogBackend();
    const store = await opened();
    within(store, <Definition connection={1} of={{ kind: "sequence", schema: "ANN", name: "ORDER_NO" }} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Open in Worksheet" }));
    expect(store.current().worksheets.at(-1)).toMatchObject({ title: "ORDER_NO.sql" });
  });
});
