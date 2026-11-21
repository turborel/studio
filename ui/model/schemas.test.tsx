import { act, fireEvent, screen } from "@testing-library/react";
import type { TableDetail } from "../ipc/catalog";
import { DataDialog } from "../data/DataDialog";
import { SchemaActions } from "../explorer/TableActions";
import { catalogBackend, opened, refused, settle, STAFF, within } from "../test/catalog";
import { modelTable } from "./model";
import { changeModel, newModel } from "./models";
import { ModelView } from "./ModelView";
import { moved } from "./SchemaCompare";
import { thrownText } from "./ModelDialogs";

/** STAFF as schema BOB holds it: a column more. */
const BOB_STAFF: TableDetail = {
  ...STAFF,
  schema: "BOB",
  columns: [...STAFF.columns, { ...STAFF.columns[0], name: "EXTRA", position: 9 } as TableDetail["columns"][number]],
  constraints: STAFF.constraints.map((c) =>
    c.references === null ? c : { ...c, references: { ...c.references, schema: "BOB" } },
  ),
};

/** A backend of two schemas, ANN and BOB, each of STAFF. */
function twoSchemas(extra: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  return catalogBackend({
    catalog_schemas: () => [
      { name: "ANN", owner: "ANN" },
      { name: "BOB", owner: "BOB" },
    ],
    catalog_objects: () => ({
      tables: [{ name: "STAFF", kind: "BASE TABLE" }],
      routines: [],
      sequences: [],
      domains: [],
      types: [],
      truncated: false,
    }),
    catalog_table: (args) => (args["schema"] === "BOB" ? BOB_STAFF : STAFF),
    catalog_graphs: () => [],
    ...extra,
  });
}

describe("two schemas compared", () => {
  it("moves a model's tables to another schema, its foreign keys within the schema with them [DESIGN] D47", () => {
    const staff = modelTable(STAFF);
    const keyed = {
      ...staff,
      foreignKeys: [
        {
          name: "F",
          columns: ["ID"],
          references: { schema: "ANN", table: "DEPT", columns: ["ID"] },
          onDelete: "NO ACTION",
          onUpdate: "NO ACTION",
        },
        {
          name: "G",
          columns: ["ID"],
          references: { schema: "OTHER", table: "T", columns: ["ID"] },
          onDelete: "NO ACTION",
          onUpdate: "NO ACTION",
        },
      ],
    };
    const m = moved({ name: "m", tables: [keyed], graphs: [] }, "ANN", "BOB");
    expect(m.tables[0]?.schema).toBe("BOB");
    expect(m.tables[0]?.foreignKeys.map((f) => f.references.schema)).toEqual(["BOB", "OTHER"]);
  });

  it("lists the differences of the target from the source, and opens the script that makes it match [DESIGN] D47", async () => {
    twoSchemas();
    const store = await opened();
    within(store, <SchemaActions connection={1} schema="ANN" />);
    fireEvent.click(screen.getByRole("button", { name: "Compare Schema…" }));
    expect(store.current().dialog).toEqual({
      kind: "data",
      task: { kind: "compareSchemas", connection: 1, schema: "ANN" },
    });
    within(store, <DataDialog task={{ kind: "compareSchemas", connection: 1, schema: "ANN" }} />);
    await settle();
    expect(screen.getByRole("button", { name: "Compare" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByRole("combobox", { name: "Schema" }), { target: { value: "BOB" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Compare" }));
      await settle();
    });
    expect(screen.getByText(/column EXTRA is dropped/u)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Script in Worksheet" }));
      await settle();
    });
    expect(store.current().worksheets.at(-1)).toMatchObject({
      title: "Match BOB",
      text: "ALTER TABLE BOB.STAFF DROP COLUMN EXTRA RESTRICT;",
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Schema" }), { target: { value: "ANN" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Compare" }));
      await settle();
    });
    expect(screen.getByText("The two are the same.")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Connection" }), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
  });

  it("says why two schemas could not be compared [DESIGN] D47", async () => {
    twoSchemas({ catalog_objects: () => refused({ message: "no such schema" }) });
    const store = await opened();
    within(store, <DataDialog task={{ kind: "compareSchemas", connection: 1, schema: "ANN" }} />);
    await settle();
    fireEvent.change(screen.getByRole("combobox", { name: "Schema" }), { target: { value: "BOB" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Compare" }));
      await settle();
    });
    expect(screen.getByText("no such schema")).toBeTruthy();
  });

  it("opens a model of a schema's tables from the explorer [DESIGN] D46", async () => {
    twoSchemas();
    const store = await opened();
    within(store, <SchemaActions connection={1} schema="ANN" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Model" }));
      await settle();
    });
    expect(store.current().models.at(-1)).toMatchObject({ connection: 1, model: { name: "ANN" } });
  });
});

describe("a diagram's clicks", () => {
  it("select a table by a click on it, none by a click on the pane [DESIGN] D46", async () => {
    twoSchemas();
    const store = await opened();
    const id = newModel(store);
    changeModel(store, id, (d) => ({
      ...d,
      model: { ...d.model, tables: [{ ...modelTable(STAFF), position: { x: 0, y: 0 } }] },
    }));
    within(store, <ModelView id={id} />);
    await settle();
    const node = document.querySelector(".react-flow__node");
    if (node !== null) {
      fireEvent.click(node);
      expect(store.current().models[0]?.selected).toBe("ANN.STAFF");
    }
    const pane = document.querySelector(".react-flow__pane");
    if (pane !== null) {
      fireEvent.click(pane);
    }
    expect(store.current().models[0]?.selected ?? null).toBeNull();
  });
});

describe("a failure's text", () => {
  it("is an error's message, a refusal's, or what was thrown [DESIGN] D46", () => {
    expect(thrownText(new Error("no"))).toBe("no");
    expect(thrownText({ message: "refused" })).toBe("refused");
    expect(thrownText("gone")).toBe("gone");
    expect(thrownText(null)).toBe("null");
  });
});
