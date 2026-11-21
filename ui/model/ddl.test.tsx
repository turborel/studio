import { act, fireEvent, screen } from "@testing-library/react";
import { catalogBackend, opened, settle, STAFF, within } from "../test/catalog";
import { importDdl } from "./ddl";
import { ModelView } from "./ModelView";
import { modelOf } from "./models";

/** What the backend makes of the script: one schema, and two statements left out. */
const MADE = {
  connection: 42,
  schemas: ["ANN"],
  statements: 5,
  leftOut: [
    { line: 3, statement: "CREATE VIEW V AS SELECT 1", why: "a definition of a view, which a model does not hold" },
    { line: 4, statement: "INSERT INTO STAFF VALUES (1)", why: "a statement of data, not a definition: not run" },
  ],
  leftOutCount: 2,
};

/** Answers the prompt the store shows with `value`. */
function answer(store: Awaited<ReturnType<typeof opened>>, value: string | null) {
  const dialog = store.current().dialog;
  if (dialog?.kind !== "prompt") {
    throw new Error("no prompt");
  }
  dialog.answer(value);
}

describe("a DDL script imported into a model", () => {
  it("reads each schema the script made, closes its database, and lists what was left out [DESIGN] D64", async () => {
    const asked = catalogBackend({
      choose_sql_file: () => "/data/shop.sql",
      ddl_model: () => MADE,
      catalog_objects: () => ({
        tables: [
          { name: "STAFF", kind: "BASE TABLE" },
          { name: "V", kind: "VIEW" },
        ],
        routines: [],
        sequences: [],
        domains: [],
        types: [],
        truncated: false,
      }),
      catalog_table: () => STAFF,
      catalog_graphs: () => [],
      close_connection: () => null,
    });
    const store = await opened();
    const importing = importDdl(store);
    await settle();
    expect(store.current().dialog).toMatchObject({
      kind: "prompt",
      label: "Schema of the names not qualified",
      initial: "ANN",
    });
    answer(store, " SHOP ");
    const id = await importing;
    expect(asked.find((a) => a.command === "ddl_model")?.args).toEqual({ path: "/data/shop.sql", schema: "SHOP" });
    expect(asked.filter((a) => a.command === "catalog_table").map((a) => a.args["connection"])).toEqual([42]);
    expect(asked.some((a) => a.command === "close_connection" && a.args["connection"] === 42)).toBe(true);
    const doc = modelOf(store.current(), id);
    expect(doc?.model.name).toBe("shop");
    expect(doc?.model.tables.map((t) => t.name)).toEqual(["STAFF"]);
    expect(doc?.told).toBe("Imported 5 statements; 2 left out.");
    within(store, <ModelView id={id ?? ""} />);
    const left = screen.getByRole("region", { name: "Left out of the model" }).textContent;
    expect(left).toContain("Line 3: a definition of a view, which a model does not hold");
    expect(left).toContain("INSERT INTO STAFF VALUES (1)");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      await settle();
    });
    expect(modelOf(store.current(), id)?.leftOut).toEqual([]);
  });

  it("does nothing of no file or no schema, and closes the database whatever is read [DESIGN] D64", async () => {
    let file: string | null = null;
    const asked = catalogBackend({
      choose_sql_file: () => file,
      ddl_model: () => MADE,
      catalog_objects: () => Promise.reject(new Error("gone")),
      close_connection: () => null,
    });
    const store = await opened();
    expect(await importDdl(store)).toBeNull();
    file = "/data/shop.sql";
    const none = importDdl(store);
    await settle();
    answer(store, null);
    expect(await none).toBeNull();
    const failing = importDdl(store);
    await settle();
    answer(store, "SHOP");
    await expect(failing).rejects.toThrow("gone");
    expect(asked.some((a) => a.command === "close_connection")).toBe(true);
  });

  it("names the schema PUBLIC with no connection active, the model by the file, and tells none left out [DESIGN] D64", async () => {
    catalogBackend({
      choose_sql_file: () => "/data/plain",
      ddl_model: () => ({ ...MADE, schemas: [], leftOut: [], leftOutCount: 0 }),
      close_connection: () => null,
    });
    const store = await opened();
    store.update((now) => ({ ...now, active: null }));
    const importing = importDdl(store);
    await settle();
    expect(store.current().dialog).toMatchObject({ kind: "prompt", initial: "PUBLIC" });
    answer(store, "S");
    const id = await importing;
    expect(modelOf(store.current(), id)).toMatchObject({
      told: "Imported 5 statements; none left out.",
      model: { name: "plain" },
    });
  });
});
