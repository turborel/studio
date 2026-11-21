import { act, fireEvent, render, screen } from "@testing-library/react";
import type { NodeProps } from "@xyflow/react";
import type { TableDetail } from "../ipc/catalog";
import { catalogBackend, opened, refused, settle, STAFF, within } from "../test/catalog";
import type { Store } from "../state/store";
import { SchemaNode, TableNode } from "./Diagram";
import { modelTable, modelText } from "./model";
import { changeModel, closeModel, editModel, modelOf, newModel, openModel, openModelFrom, saveModel } from "./models";
import { ModelView } from "./ModelView";
import { pngOf } from "./image";

/** A department table, of the key STAFF's foreign key would reference. */
const DEPT: TableDetail = { ...STAFF, name: "DEPT", columns: STAFF.columns.slice(0, 1), constraints: [], indexes: [] };

/** Images that load, or fail, at once, drawn on a canvas of `context`: what undoes it. */
function drawable(
  loads: boolean,
  context: unknown = { scale: () => undefined, drawImage: () => undefined },
): () => void {
  /** An image that loads, or fails, as soon as it is given its source. */
  class AtOnce {
    onload: ((e: Event) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    set src(_: string) {
      queueMicrotask(() => {
        (loads ? this.onload : this.onerror)?.(new Event(loads ? "load" : "error"));
      });
    }
  }
  vi.stubGlobal("Image", AtOnce);
  const drawn = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => context) as never);
  const read = vi
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockImplementation(() => "data:image/png;base64,AAAA");
  return () => {
    vi.unstubAllGlobals();
    drawn.mockRestore();
    read.mockRestore();
  };
}

/** A store with model `id` shown. */
async function shown(
  extra: Record<string, (args: Record<string, unknown>) => unknown> = {},
): Promise<{ store: Store; id: string; asked: ReturnType<typeof catalogBackend> }> {
  const asked = catalogBackend({
    catalog_table: (args) => (args["name"] === "DEPT" ? DEPT : STAFF),
    catalog_objects: () => ({
      tables: [
        { name: "STAFF", kind: "BASE TABLE" },
        { name: "DEPT", kind: "BASE TABLE" },
        { name: "PAYROLL", kind: "VIEW" },
      ],
      routines: [],
      sequences: [],
      domains: [],
      types: [],
      truncated: false,
    }),
    catalog_graphs: () => [
      {
        name: "BANK",
        mode: "ENFORCED",
        elements: [
          {
            alias: "STAFF",
            kind: "VERTEX",
            schema: "ANN",
            table: "STAFF",
            undirected: false,
            labels: ["PERSON"],
            ends: [],
          },
        ],
      },
    ],
    ...extra,
  });
  const store = await opened();
  const id = newModel(store);
  within(store, <ModelView id={id} />);
  await settle();
  return { store, id, asked };
}

/** Clicks the button named `name`. */
async function click(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    await settle();
  });
}

describe("a model's tab", () => {
  it("opens the diagram's menu by Shift+F10, and a table's when one is selected [DESIGN] D53", async () => {
    const { store, id } = await shown();
    const figure = screen.getByRole("figure");
    fireEvent.keyDown(figure, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menuitem", { name: "Lay Out Again" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Add Table…" }));
    await settle();
    expect(screen.getByRole("dialog")).toBeTruthy();
    editModel(store, id, (m) => ({ ...m, tables: [modelTable(STAFF)] }));
    changeModel(store, id, (d) => ({ ...d, selected: "ANN.STAFF" }));
    await settle();
    fireEvent.keyDown(screen.getByRole("figure"), { key: "F10", shiftKey: true });
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit Table…" }));
    await settle();
    expect(screen.getAllByRole("dialog").length).toBeGreaterThan(0);
  });

  it("reads tables of a live schema into the model, and its property graphs [DESIGN] D46", async () => {
    const { store, id } = await shown();
    expect(screen.getByText(/^0 tables\./u)).toBeTruthy();
    await click("Read Tables of a Schema…");
    fireEvent.change(screen.getByRole("combobox", { name: "Schema" }), { target: { value: "ANN" } });
    await settle();
    fireEvent.click(screen.getByRole("checkbox", { name: "DEPT" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "DEPT" }));
    await click("Read");
    const doc = modelOf(store.current(), id);
    expect(doc?.model.tables.map((t) => t.name)).toEqual(["STAFF", "DEPT"]);
    expect(doc?.connection).toBe(1);
    expect(screen.getByText(/^2 tables, changed since saved\./u)).toBeTruthy();
    expect(screen.getByText("ANN.BANK: STAFF (vertex)")).toBeTruthy();
    expect(screen.getByRole("figure", { name: "Diagram of Model: 2 tables" })).toBeTruthy();
  });

  it("adds, edits and removes a table, lays the diagram out, filters, searches and groups it [DESIGN] D46", async () => {
    const { store, id } = await shown();
    await click("Add Table…");
    expect(screen.getByText("The table needs a name.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Schema"), { target: { value: "ANN" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "ITEMS" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Index" }));
    fireEvent.change(screen.getByLabelText("Name of index 1"), { target: { value: "ITEMS_BY_ID" } });
    fireEvent.change(screen.getByLabelText("Columns of index 1"), { target: { value: "ID" } });
    fireEvent.change(screen.getByLabelText("Method of index 1"), { target: { value: "hash" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Index" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove index 2" }));
    await click("Save Table");
    expect(modelOf(store.current(), id)?.model.tables[0]).toMatchObject({
      name: "ITEMS",
      indexes: [{ name: "ITEMS_BY_ID", columns: ["ID"], method: "hash" }],
    });
    expect(modelOf(store.current(), id)?.selected).toBe("ANN.ITEMS");
    await click("Edit Table…");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "GOODS" } });
    await click("Save Table");
    expect(modelOf(store.current(), id)?.model.tables.map((t) => t.name)).toEqual(["GOODS"]);
    await click("Add Table…");
    fireEvent.change(screen.getByLabelText("Schema"), { target: { value: "" } });
    expect(screen.getByText("The table needs a name.")).toBeTruthy();
    await click("Cancel");
    await click("Lay Out Again");
    fireEvent.change(screen.getByLabelText("Filter tables"), { target: { value: "goo" } });
    fireEvent.change(screen.getByLabelText("Search tables"), { target: { value: "goods" } });
    await click("Group by Schema");
    expect(modelOf(store.current(), id)).toMatchObject({ filter: "goo", grouped: true });
    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "Shop" } });
    expect(modelOf(store.current(), id)?.model.name).toBe("Shop");
    await click("Remove Table");
    expect(modelOf(store.current(), id)?.model.tables).toEqual([]);
  });

  it("saves the model to a file, again to it, and opens it back; a file that is no model refused [DESIGN] D46", async () => {
    let text = "";
    const { store, id, asked } = await shown({
      save_text_file: (args) => {
        text = String(args["text"]);
        return "/models/Model.json";
      },
      open_model_file: () => ({ path: "/models/Model.json", name: "Model.json", text }),
    });
    await click("Save Model");
    expect(modelOf(store.current(), id)).toMatchObject({
      path: "/models/Model.json",
      modified: false,
      told: "Saved to /models/Model.json.",
    });
    await click("Save Model");
    expect(asked.find((a) => a.command === "write_sql_file")?.args["path"]).toBe("/models/Model.json");
    await click("Save Model As…");
    expect(asked.filter((a) => a.command === "save_text_file")).toHaveLength(2);
    const back = await openModelFrom(store);
    expect(modelOf(store.current(), back)?.model.name).toBe("Model");
    text = "{";
    await expect(openModelFrom(store)).rejects.toThrow("not JSON");
    catalogBackend({ open_model_file: () => null });
    expect(await openModelFrom(store)).toBeNull();
    await saveModel(store, "nope");
    closeModel(store, back ?? "");
    closeModel(store, id);
    expect(store.current().models).toEqual([]);
  });

  it("exports the diagram as SVG and as PNG, and says why one could not be made [DESIGN] D46", async () => {
    let saved = "";
    const { store, id, asked } = await shown({
      save_text_file: (args) => {
        saved = String(args["text"]);
        return "/models/Model.svg";
      },
      save_binary_file: () => "/models/Model.png",
    });
    act(() => {
      store.update((now) => ({
        ...now,
        models: now.models.map((m) => (m.id === id ? { ...m, model: { ...m.model, tables: [modelTable(STAFF)] } } : m)),
      }));
    });
    await click("Export as SVG…");
    expect(saved).toContain(">ANN.STAFF</text>");
    expect(modelOf(store.current(), id)?.told).toBe("Exported to /models/Model.svg.");
    const restore = drawable(true);
    await click("Export as PNG…");
    expect(asked.find((a) => a.command === "save_binary_file")?.args).toEqual({ name: "Model.png", octets: "AAAA" });
    expect(modelOf(store.current(), id)?.told).toBe("Exported to /models/Model.png.");
    restore();
    const failing = drawable(false);
    await click("Export as PNG…");
    expect(modelOf(store.current(), id)?.told).toBe("The diagram could not be drawn as an image: save it as SVG.");
    failing();
  });

  it("compares the model with a live schema, and opens the script that takes the schema to it [DESIGN] D47", async () => {
    const { store, id } = await shown();
    act(() => {
      store.update((now) => ({
        ...now,
        models: now.models.map((m) =>
          m.id === id
            ? {
                ...m,
                connection: 1,
                model: {
                  ...m.model,
                  tables: [
                    {
                      ...modelTable(STAFF),
                      columns: [
                        ...modelTable(STAFF).columns,
                        { name: "NOTE", type: "VARCHAR(9)", notNull: false, default: null },
                      ],
                    },
                  ],
                },
              }
            : m,
        ),
      }));
    });
    await click("Compare with a Schema…");
    fireEvent.change(screen.getByRole("combobox", { name: "Schema" }), { target: { value: "ANN" } });
    await click("Compare");
    expect(screen.getByText(/column NOTE is added/u)).toBeTruthy();
    await click("Open Script in Worksheet");
    expect(store.current().worksheets.at(-1)?.text).toContain("ADD COLUMN NOTE VARCHAR(9);");
    expect(store.current().worksheets.at(-1)?.text).toContain("DROP TABLE ANN.DEPT RESTRICT;");
  });

  it("says why a schema could not be read or compared [DESIGN] D47", async () => {
    await shown({ catalog_table: () => refused({ message: "not readable" }) });
    await click("Read Tables of a Schema…");
    fireEvent.change(screen.getByRole("combobox", { name: "Schema" }), { target: { value: "ANN" } });
    await settle();
    await click("Read");
    expect(screen.getByText("not readable")).toBeTruthy();
    await click("Cancel");
    await click("Compare with a Schema…");
    fireEvent.change(screen.getByRole("combobox", { name: "Schema" }), { target: { value: "ANN" } });
    await click("Compare");
    expect(screen.getByText("not readable")).toBeTruthy();
    await click("Close");
  });
});

describe("a diagram's parts", () => {
  it("draws a table's node of its columns and marks, and a schema's box [DESIGN] D46", () => {
    const props = {
      id: "x",
      type: "table",
      selected: false,
      dragging: false,
      zIndex: 0,
      isConnectable: false,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
      deletable: false,
      selectable: true,
      draggable: true,
    };
    const node = props as unknown as NodeProps;
    render(<TableNode {...node} data={{ table: modelTable(STAFF), selected: true }} />);
    expect(screen.getByText("ANN.STAFF").parentElement?.className).toBe("model-table model-selected");
    render(<SchemaNode {...node} data={{ schema: "ANN" }} />);
    expect(screen.getByText("ANN").className).toBe("model-schema");
  });

  it("makes a PNG of the SVG on a canvas, or says why the webview draws none [DESIGN] D46", async () => {
    const restore = drawable(true, null);
    await expect(pngOf("<svg/>", { width: 10, height: 10 })).rejects.toThrow("The webview draws no canvas.");
    restore();
  });

  it("opens a model of a file's text as it was saved, its tables placed [DESIGN] D46", async () => {
    catalogBackend();
    const store = await opened();
    const id = openModel(
      store,
      JSON.parse(modelText({ name: "M", tables: [modelTable(STAFF)], graphs: [] })) as never,
      { path: "/m.json" },
    );
    expect(modelOf(store.current(), id)).toMatchObject({ path: "/m.json", modified: false });
    expect(modelOf(store.current(), id)?.model.tables[0]?.position).not.toBeNull();
  });
});
