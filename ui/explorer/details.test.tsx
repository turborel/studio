import { act, fireEvent, screen, within as inside } from "@testing-library/react";
import type { TableDetail } from "../ipc/catalog";
import type { SavedConnection } from "../ipc/saved";
import { loadSchemas, select, toggle } from "../state/catalog";
import { SAVED, STAFF, catalogBackend, opened, settle, within } from "../test/catalog";
import { EMPTY_CATALOG } from "./catalogState";
import { CatalogTree } from "./CatalogTree";
import { Details } from "./Details";
import { savedOf, toggleFavourite } from "./Favourites";
import { nodeId, treeRows } from "./tree";

describe("the details panel", () => {
  it("shows a table's columns, keys, indexes, storage, triggers, privileges and dependencies [DESIGN] D33", async () => {
    catalogBackend();
    const store = await opened();
    within(store, <Details />);
    expect(screen.getByText("Nothing is selected.")).toBeTruthy();
    await act(() => select(store, 1, { kind: "table", schema: "ANN", name: "STAFF" }));
    expect(screen.getByText("table: ANN.STAFF")).toBeTruthy();
    expect(screen.getByText("IDENTITY ALWAYS")).toBeTruthy();
    expect(screen.getByText("ID * 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Keys and checks" }));
    expect(screen.getByText("ANN.DEPTS (ID) ON DELETE CASCADE")).toBeTruthy();
    expect(screen.getByText("NAME <> ''")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Indexes" }));
    expect(screen.getByText("ANN.STAFF.UNIQUE1")).toBeTruthy();
    expect(screen.getByText("a key")).toBeTruthy();
    expect(screen.getByText("STAFF_NOTE / ANN / STAFF_OLD")).toBeTruthy();
    expect(screen.getByText("its table's index")).toBeTruthy();
    expect(screen.getByText("FILL = 50")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Partitions" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Storage" }));
    expect(screen.getByRole("table", { name: "Storage" }).textContent).toContain("rowstore");
    expect(screen.getByText("STATISTICS.SAMPLE")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Triggers" }));
    expect(screen.getByText("SET NEW.NAME = 'y'")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Privileges" }));
    expect(screen.getByText("BOB")).toBeTruthy();
    const carol = screen.getByText("CAROL").closest("tr");
    expect(carol?.textContent).toBe("CAROLUPDATENAMEANNNO");
    fireEvent.click(screen.getByRole("tab", { name: "Dependencies" }));
    expect(screen.getByText("Reading…")).toBeTruthy();
    await settle();
    expect(screen.getByText("DEPTS")).toBeTruthy();
    expect(screen.getByText("None.")).toBeTruthy();
  });

  it("scripts a table as each statement, copies it and saves it to a file [DESIGN] D33 D34", async () => {
    const asked = catalogBackend({ save_text_file: () => "/home/ann/STAFF.sql" });
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: (t: string) => Promise.resolve(void written.push(t)) },
      configurable: true,
    });
    const store = await opened();
    await select(store, 1, { kind: "table", schema: "ANN", name: "STAFF" });
    within(store, <Details />);
    fireEvent.click(screen.getByRole("tab", { name: "Definition" }));
    expect(screen.getByLabelText("Definition").textContent).toBe("Reading…");
    await settle();
    expect(screen.getByLabelText("Definition").textContent).toContain('"script":"create"');
    fireEvent.change(screen.getByLabelText("Script as"), { target: { value: "insert" } });
    await settle();
    expect(screen.getByLabelText("Definition").textContent).toContain('"script":"insert"');
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await settle();
    expect(written[0]).toContain('"script":"insert"');
    expect(screen.getByText("Copied.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save…" }));
    await settle();
    expect(asked.find((a) => a.command === "save_text_file")?.args["name"]).toBe("STAFF.sql");
    expect(screen.getByText("Saved to /home/ann/STAFF.sql.")).toBeTruthy();
  });

  it("says nothing of a save cancelled, and shows a definition's failure as a comment [DESIGN] D34", async () => {
    catalogBackend({
      save_text_file: () => null,
      catalog_definition: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the backend rejects with Studio's error, not an Error
        throw {
          sqlcode: -910,
          sqlstate: "TB910",
          message: "no object",
          rule: null,
          position: null,
          active: false,
          diagnostics: null,
        };
      },
    });
    const store = await opened();
    await select(store, 1, { kind: "sequence", schema: "ANN", name: "ORDER_NO" });
    within(store, <Details />);
    await settle();
    expect(screen.getByLabelText("Definition").textContent).toBe("-- no object");
    fireEvent.click(screen.getByRole("button", { name: "Save…" }));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("shows a routine's parameters and body, and its definition [DESIGN] D33", async () => {
    const asked = catalogBackend();
    const store = await opened();
    await select(store, 1, { kind: "routine", schema: "ANN", specific: "DOUBLED_1", name: "DOUBLED" });
    within(store, <Details />);
    expect(screen.getByText("Reading…")).toBeTruthy();
    await settle();
    expect(screen.getByText("N")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Privileges" }));
    expect(screen.getByText("DAN")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Body" }));
    expect(screen.getByText("Shown to its schema's owner alone.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Definition" }));
    await settle();
    expect(asked.find((a) => a.command === "catalog_definition")?.args["of"]).toEqual({
      kind: "routine",
      schema: "ANN",
      specific: "DOUBLED_1",
    });
  });

  it("shows a schema's, a domain's and a role's parts [DESIGN] D33", async () => {
    const asked = catalogBackend();
    const store = await opened();
    await toggle(store, 1, nodeId("security"));
    await select(store, 1, { kind: "role", name: "CLERK" });
    within(store, <Details />);
    expect(screen.getByText("role: CLERK")).toBeTruthy();
    expect(screen.getByText("BOB")).toBeTruthy();
    await act(() => select(store, 1, { kind: "user", name: "ANN" }));
    expect(screen.getByText("None.")).toBeTruthy();
    await act(() => select(store, 1, { kind: "domain", schema: "ANN", name: "MONEY" }));
    await settle();
    await act(() => select(store, 1, { kind: "schema", schema: "ANN" }));
    await settle();
    const kinds = asked
      .filter((a) => a.command === "catalog_definition")
      .map((a) => (a.args["of"] as { kind: string }).kind);
    expect(kinds).toEqual(["domain", "schema"]);
  });
});

describe("USAGE and roles", () => {
  it("show who may use a sequence or domain, and that a role is the user's to grant [DESIGN] D33", async () => {
    const asked = catalogBackend();
    const store = await opened();
    await select(store, 1, { kind: "sequence", schema: "ANN", name: "ORDER_NO" });
    within(store, <Details />);
    fireEvent.click(screen.getByRole("tab", { name: "Usage" }));
    expect(screen.getByText("Reading…")).toBeTruthy();
    await settle();
    expect(screen.getByText("ERIN")).toBeTruthy();
    expect(asked.find((a) => a.command === "catalog_usage")?.args).toEqual({
      connection: 1,
      schema: "ANN",
      name: "ORDER_NO",
      of: "sequence",
    });
    await toggle(store, 1, nodeId("security"));
    await act(() => select(store, 1, { kind: "role", name: "CLERK" }));
    expect(screen.getByText("You may grant, revoke and drop this role.")).toBeTruthy();
  });

  it("say why USAGE could not be read [DESIGN] D33", async () => {
    catalogBackend({ catalog_usage: () => Promise.reject(new Error("gone")) });
    const store = await opened();
    await select(store, 1, { kind: "domain", schema: "ANN", name: "MONEY" });
    within(store, <Details />);
    fireEvent.click(screen.getByRole("tab", { name: "Usage" }));
    await settle();
    expect(screen.getByText(/^Cannot read it: /u)).toBeTruthy();
  });
});

describe("a selection not yet read", () => {
  it("shows a table reading, and a user of no roles read as having none [DESIGN] D33", async () => {
    catalogBackend({ catalog_table: () => Promise.reject(new Error("gone")) });
    const store = await opened();
    await select(store, 1, { kind: "table", schema: "ANN", name: "STAFF" });
    within(store, <Details />);
    expect(screen.getByText("Reading…")).toBeTruthy();
    await act(() => select(store, 1, { kind: "user", name: "ANN" }));
    expect(screen.getByText("None.")).toBeTruthy();
  });
});

describe("partitions and types", () => {
  it("show a partitioned table's strategy and partitions, and a partition's table [DESIGN] D33", async () => {
    const sales: TableDetail = {
      ...STAFF,
      name: "SALES",
      partitioning: {
        strategy: "RANGE",
        key: "SOLD",
        partitions: [{ schema: "ANN", name: "SOTHER", bound: "DEFAULT", partitioned: false }],
      },
    };
    const other: TableDetail = {
      ...STAFF,
      name: "SOTHER",
      partitionOf: { schema: "ANN", name: "SALES", bound: "DEFAULT" },
    };
    catalogBackend({ catalog_table: (args) => (args["name"] === "SALES" ? sales : other) });
    const store = await opened();
    await select(store, 1, { kind: "table", schema: "ANN", name: "SALES" });
    within(store, <Details />);
    fireEvent.click(screen.getByRole("tab", { name: "Partitions" }));
    expect(screen.getByText("PARTITION BY RANGE (SOLD)")).toBeTruthy();
    expect(screen.getByText("SOTHER")).toBeTruthy();
    await act(() => select(store, 1, { kind: "table", schema: "ANN", name: "SOTHER" }));
    fireEvent.click(screen.getByRole("tab", { name: "Partitions" }));
    expect(screen.getByText("A partition of ANN.SALES: DEFAULT")).toBeTruthy();
  });

  it("show a type's attributes, supertype, references and methods, or its source, and its definition [DESIGN] D33", async () => {
    const address = {
      schema: "ANN",
      name: "ADDRESS",
      category: "STRUCTURED",
      instantiable: false,
      isFinal: false,
      source: null,
      attributes: [{ name: "CITY", typeWritten: "CHARACTER VARYING(20)", default: "'Rome'" }],
      supertype: "ANN.PLACE",
      inherited: 0,
      reference: "USER GENERATED",
      referenceUsing: "INTEGER",
      methods: ["METHOD DISTANCE() RETURNS INTEGER SPECIFIC ADDRESS_DISTANCE_1"],
    };
    const money = {
      ...address,
      name: "MONEY",
      category: "DISTINCT",
      instantiable: true,
      isFinal: true,
      source: "NUMERIC(10,2)",
      attributes: [],
      supertype: null,
      reference: null,
      referenceUsing: null,
      methods: [],
    };
    const asked = catalogBackend({ catalog_type: (args) => (args["name"] === "MONEY" ? money : address) });
    const store = await opened();
    await loadSchemas(store, 1);
    await toggle(store, 1, nodeId("schema", "ANN"));
    await toggle(store, 1, nodeId("folder", "ANN", "Types"));
    expect(treeRows(store.current().catalogs[1] ?? EMPTY_CATALOG).map((r) => r.label)).toContain("ADDRESS");
    await select(store, 1, { kind: "type", schema: "ANN", name: "ADDRESS" });
    within(store, <Details />);
    await settle();
    expect(
      screen.getByText(
        "STRUCTURED type, not final, not instantiable, under ANN.PLACE, its references user generated of INTEGER",
      ),
    ).toBeTruthy();
    expect(screen.getByText("METHOD DISTANCE() RETURNS INTEGER SPECIFIC ADDRESS_DISTANCE_1")).toBeTruthy();
    expect(screen.getByText("'Rome'")).toBeTruthy();
    await act(() => select(store, 1, { kind: "type", schema: "ANN", name: "MONEY" }));
    await settle();
    expect(screen.getByText("DISTINCT type, of NUMERIC(10,2)")).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Attributes" })).toBeNull();
    const kinds = asked.filter((a) => a.command === "catalog_definition").map((a) => a.args["of"]);
    expect(kinds).toContainEqual({ kind: "type", schema: "ANN", name: "MONEY" });
  });

  it("say why a type could not be read [DESIGN] D33", async () => {
    catalogBackend({ catalog_type: () => Promise.reject(new Error("gone")) });
    const store = await opened();
    await select(store, 1, { kind: "type", schema: "ANN", name: "ADDRESS" });
    within(store, <Details />);
    await settle();
    expect(screen.getByText(/^Cannot read it: /u)).toBeTruthy();
  });
});

describe("a detail not read", () => {
  it("says why, and names each file after its object [DESIGN] D33 D34", async () => {
    const asked = catalogBackend({
      catalog_routine: () => Promise.reject(new Error("gone")),
      catalog_dependencies: () => Promise.reject(new Error("gone")),
      catalog_definition: () => Promise.reject(new Error("gone")),
      save_text_file: () => null,
    });
    const store = await opened();
    await select(store, 1, { kind: "routine", schema: "ANN", specific: "DOUBLED_1", name: "DOUBLED" });
    within(store, <Details />);
    await settle();
    expect(screen.getByText(/^Cannot read it: /u)).toBeTruthy();
    await act(() => select(store, 1, { kind: "table", schema: "ANN", name: "STAFF" }));
    fireEvent.click(screen.getByRole("tab", { name: "Dependencies" }));
    await settle();
    expect(screen.getByText(/^Cannot read it: /u)).toBeTruthy();
    await act(() => select(store, 1, { kind: "schema", schema: "ANN" }));
    await settle();
    expect(screen.getByLabelText("Definition").textContent).toMatch(/^-- .*gone/u);
    fireEvent.click(screen.getByRole("button", { name: "Save…" }));
    await settle();
    const names = asked.filter((a) => a.command === "save_text_file").map((a) => a.args["name"]);
    expect(names).toEqual(["ANN.sql"]);
  });

  it("names a routine's file by its specific name [DESIGN] D34", async () => {
    const asked = catalogBackend({ save_text_file: () => null });
    const store = await opened();
    await select(store, 1, { kind: "routine", schema: "ANN", specific: "DOUBLED_1", name: "DOUBLED" });
    within(store, <Details />);
    await settle();
    fireEvent.click(screen.getByRole("tab", { name: "Definition" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Save…" }));
    await settle();
    expect(asked.find((a) => a.command === "save_text_file")?.args["name"]).toBe("DOUBLED_1.sql");
  });
});

describe("favourites", () => {
  it("are added and taken off by the star, kept with the saved connection [DESIGN] D33", async () => {
    const asked = catalogBackend();
    const store = await opened();
    await select(store, 1, { kind: "table", schema: "ANN", name: "STAFF" });
    within(store, <Details />);
    fireEvent.click(screen.getByRole("button", { name: "Add to favourites" }));
    await settle();
    const saved = asked.find((a) => a.command === "save_connection")?.args["connection"] as SavedConnection;
    expect(saved.favourites).toEqual([{ kind: "TABLE", schema: "ANN", name: "STAFF" }]);
    expect(screen.getByRole("button", { name: "Favourite" }).getAttribute("aria-pressed")).toBe("true");
    await toggleFavourite(store, 1, { kind: "TABLE", schema: "ANN", name: "STAFF" });
    const again = asked.filter((a) => a.command === "save_connection").at(-1)?.args["connection"] as SavedConnection;
    expect(again.favourites).toEqual([]);
  });

  it("are listed above the tree, each selecting its object [DESIGN] D33", async () => {
    const saved = {
      ...SAVED,
      favourites: [
        { kind: "TABLE", schema: "ANN", name: "STAFF" },
        { kind: "TRIGGER", schema: "ANN", name: "STAMPED" },
      ],
    };
    catalogBackend({}, saved);
    const store = await opened(saved);
    within(store, <CatalogTree connection={1} />);
    await settle();
    const list = screen.getByRole("list", { name: "Favourites" });
    expect(inside(list).getByText<HTMLButtonElement>("ANN.STAMPED").disabled).toBe(true);
    fireEvent.click(inside(list).getByText("ANN.STAFF"));
    await settle();
    expect(store.current().selected?.object).toEqual({ kind: "table", schema: "ANN", name: "STAFF" });
  });

  it("are none of a connection not saved, which shows no star [DESIGN] D33", async () => {
    catalogBackend();
    const store = await opened();
    store.update((now) => ({ ...now, open: now.open.map((c) => ({ ...c, savedId: null })) }));
    expect(savedOf(store, 1)).toBeUndefined();
    await toggleFavourite(store, 1, { kind: "TABLE", schema: "ANN", name: "STAFF" });
    await select(store, 1, { kind: "table", schema: "ANN", name: "STAFF" });
    within(store, <Details />);
    expect(screen.queryByRole("button", { name: "Add to favourites" })).toBeNull();
  });
});
