import { act, fireEvent, screen } from "@testing-library/react";
import { SchemaActions } from "../explorer/TableActions";
import { catalogBackend, OBJECTS, opened, refused, settle, within } from "../test/catalog";
import { DataDialog } from "./DataDialog";
import { scriptedObjects } from "./GenerateDialog";

describe("a schema's script generated", () => {
  it("writes the definitions of the objects chosen, types first and routines last [DESIGN] D44", async () => {
    expect(scriptedObjects("ANN", OBJECTS).map((o) => o.label)).toEqual([
      "Type ADDRESS",
      "Domain MONEY",
      "Sequence ORDER_NO",
      "Table STAFF",
      "View PAYROLL",
      "Function DOUBLED",
    ]);
    expect(
      scriptedObjects("ANN", { ...OBJECTS, routines: [{ specific: "P_1", name: "P", kind: "PROCEDURE" }] }).at(-1)
        ?.label,
    ).toBe("Procedure P");
    const asked = catalogBackend({
      catalog_definition: (args) => `-- ${(args["of"] as { kind: string }).kind}\n`,
    });
    const store = await opened();
    within(store, <SchemaActions connection={1} schema="ANN" />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Script…" }));
    within(store, <DataDialog task={{ kind: "generate", connection: 1, schema: "ANN" }} />);
    expect(screen.getByText("Reading the schema…")).toBeTruthy();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Choose None" }));
    expect(screen.getByRole("button", { name: "Open in Worksheet" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Choose All" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "View PAYROLL" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Domain MONEY" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Domain MONEY" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open in Worksheet" }));
      await settle();
    });
    expect(store.current().worksheets.at(-1)).toMatchObject({
      title: "ANN script",
      text: "-- type\n\n-- domain\n\n-- sequence\n\n-- table\n\n-- routine\n",
    });
    expect(asked.filter((a) => a.command === "catalog_definition")).toHaveLength(5);
  });

  it("says why a definition could not be read [DESIGN] D44", async () => {
    catalogBackend({ catalog_definition: () => refused({ message: "not the owner" }) });
    const store = await opened();
    within(store, <DataDialog task={{ kind: "generate", connection: 1, schema: "ANN" }} />);
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open in Worksheet" }));
      await settle();
    });
    expect(screen.getByText("not the owner")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });
});
