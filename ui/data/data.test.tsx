import { act, fireEvent, screen } from "@testing-library/react";
import { TableActions } from "../explorer/TableActions";
import { worksheetOf } from "../state/worksheets";
import { catalogBackend, opened, refused, settle, STAFF, within } from "../test/catalog";
import { DataDialog } from "./DataDialog";
import { exportedQuery, rowsQuery } from "./TableTasks";
import { firstFields, headingColumn, tableSql } from "./tasks";

const OF = { connection: 1, schema: "ANN", table: "STAFF" };

describe("the tasks' names and fields", () => {
  it("writes a table's name delimited, and takes each field into the column its heading names, or by its place [CLIENT Importing]", () => {
    expect(tableSql({ schema: "ANN", table: 'A"B' })).toBe('"ANN"."A""B"');
    expect(headingColumn(" name ")).toBe("NAME");
    expect(headingColumn("Full Name")).toBe("Full Name");
    expect(firstFields(["name", "Id", "extra"], 3, ["ID", "NAME"])).toEqual(["NAME", "ID", null]);
    expect(firstFields(["Full Name"], 1, ["full name"])).toEqual(["full name"]);
    expect(firstFields(null, 3, ["ID", "NAME"])).toEqual(["ID", "NAME", null]);
    expect(rowsQuery(OF, 50, " ID > 1 ")).toBe('SELECT * FROM "ANN"."STAFF" WHERE ID > 1 FETCH FIRST 50 ROWS ONLY');
    expect(rowsQuery(OF, 200, "")).toBe('SELECT * FROM "ANN"."STAFF" FETCH FIRST 200 ROWS ONLY');
    expect(exportedQuery(OF, "")).toBe('SELECT * FROM "ANN"."STAFF"');
    expect(exportedQuery(OF, "NAME LIKE 'A%'")).toBe(`SELECT * FROM "ANN"."STAFF" WHERE NAME LIKE 'A%'`);
  });
});

describe("a table's actions", () => {
  it("open their dialogs from the details panel, of a base table alone [DESIGN] D42", async () => {
    catalogBackend();
    const store = await opened();
    within(store, <TableActions connection={1} schema="ANN" table="STAFF" kind="BASE TABLE" />);
    fireEvent.click(screen.getByRole("button", { name: "Import…" }));
    expect(store.current().dialog).toEqual({ kind: "data", task: { kind: "import", ...OF } });
    fireEvent.click(screen.getByRole("button", { name: "Edit Rows…" }));
    fireEvent.click(screen.getByRole("button", { name: "Export…" }));
    expect(store.current().dialog).toEqual({ kind: "data", task: { kind: "export", ...OF } });
    within(store, <TableActions connection={1} schema="ANN" table="PAYROLL" kind="VIEW" />);
    expect(screen.getAllByRole("group", { name: "Table actions" })).toHaveLength(1);
  });

  it("opens a table's first rows, or those a condition keeps, in a worksheet to be edited [DESIGN] D42", async () => {
    const asked = catalogBackend({
      run_statement: () => ({
        kind: "ran",
        answer: {
          outcome: {
            kind: "rows",
            result: 1,
            columns: STAFF.columns.map((c) => ({
              name: c.name,
              typeWritten: c.typeWritten,
              typeName: null,
              notNull: false,
            })),
            page: { from: 0, rows: [], rowsRead: 0, complete: true, lobs: [] },
          },
          warnings: [],
          serverTime: null,
          session: {
            authorization: "ANN",
            schema: "ANN",
            transaction: { active: false, autocommit: false, readOnly: false },
          },
        },
      }),
    });
    const store = await opened();
    store.update((now) => ({ ...now, dialog: { kind: "data", task: { kind: "editRows", ...OF } } }));
    within(store, <DataDialog task={{ kind: "editRows", ...OF }} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: "First rows" }), { target: { value: "50" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Where" }), { target: { value: "ID > 1" } });
    expect(screen.getByText('SELECT * FROM "ANN"."STAFF" WHERE ID > 1 FETCH FIRST 50 ROWS ONLY')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await settle();
    await act(async () => {
      await settle();
    });
    expect(store.current().dialog).toBeNull();
    const sheet = store.current().worksheets.at(-1);
    expect(sheet?.title).toBe("STAFF rows");
    expect(asked.some((a) => a.command === "run_statement" && String(a.args["sql"]).includes("FETCH FIRST 50"))).toBe(
      true,
    );
    expect(worksheetOf(store.current(), sheet?.id ?? null)?.runs.at(-1)?.editing?.target.table).toBe("STAFF");
    within(store, <DataDialog task={{ kind: "editRows", ...OF }} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" }).at(-1) ?? document.body);
  });

  it("exports a table's rows, or those a condition keeps, to a file the dialog chooses [DESIGN] D43", async () => {
    let answer: unknown = { path: "/tmp/staff.rows", rows: 4 };
    const asked = catalogBackend({ export_query: () => answer });
    const store = await opened();
    within(store, <DataDialog task={{ kind: "export", ...OF }} />);
    fireEvent.change(screen.getByRole("combobox", { name: "As" }), { target: { value: "native" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Where" }), { target: { value: "ID < 9" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export…" }));
      await settle();
    });
    expect(asked.find((a) => a.command === "export_query")?.args).toEqual({
      request: { connection: 1, sql: 'SELECT * FROM "ANN"."STAFF" WHERE ID < 9', kind: "native", name: "STAFF" },
    });
    expect(screen.getByText("Exported 4 rows to /tmp/staff.rows.")).toBeTruthy();
    answer = null;
    fireEvent.change(screen.getByRole("combobox", { name: "As" }), { target: { value: "csv" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export…" }));
      await settle();
    });
    answer = refused({
      sqlcode: -910,
      sqlstate: "TB910",
      message: "the disk is full",
      rule: null,
      position: null,
      active: false,
      diagnostics: null,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export…" }));
      await settle();
    });
    expect(screen.getByText("the disk is full")).toBeTruthy();
    answer = Promise.reject(new Error("no dialog"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export…" }));
      await settle();
    });
    expect(screen.getByText("Error: no dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
  });
});

describe("importing a file", () => {
  it("previews the file chosen, takes each field into a column, and imports it through the guards [CLIENT Importing]", async () => {
    let asks = 0;
    const asked = catalogBackend({
      choose_import_file: () => "/data/staff.csv",
      preview_import: (args) =>
        (args["reading"] as { header: boolean }).header
          ? {
              headings: ["name", "ID", "extra"],
              records: [
                ["Ada", "1", "x"],
                [null, "2", "y"],
              ],
              inferred: [
                { typeWritten: "VARCHAR(10)", nulls: true },
                { typeWritten: "INTEGER", nulls: false },
                { typeWritten: "VARCHAR(10)", nulls: false },
              ],
              sheets: null,
            }
          : { headings: null, records: [["name", "ID", "extra"]], inferred: [], sheets: null },
      import_rows: (args) => {
        asks += 1;
        return args["confirmed"] === true || asks > 2
          ? {
              kind: "imported",
              answer: {
                rows: 2,
                rejected: 1,
                skipped: ["record 3, line 4: duplicate; skipped"],
                cancelled: false,
                rolledBack: 0,
              },
            }
          : { kind: "confirm", answer: { class: "writeRows", destroys: [], unclassified: [], production: true } };
      },
    });
    const store = await opened();
    within(store, <DataDialog task={{ kind: "import", ...OF }} />);
    await settle();
    expect(screen.getByText("No file chosen.")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Format" }), { target: { value: "tsv" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Format" }), { target: { value: "csv" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Choose File…" }));
      await settle();
    });
    expect(screen.getByText("/data/staff.csv")).toBeTruthy();
    const preview = screen.getByRole("table", { name: "Preview" });
    expect(preview.textContent).toContain("Ada");
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Column of field 1" }).value).toBe("NAME");
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Column of field 3" }).value).toBe("");
    fireEvent.change(screen.getByRole("textbox", { name: "Delimiter" }), { target: { value: ";" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Null is written" }), { target: { value: "N/A" } });
    await settle();
    fireEvent.click(screen.getByRole("checkbox", { name: "First record names the fields" }));
    await settle();
    fireEvent.click(screen.getByRole("checkbox", { name: "First record names the fields" }));
    await settle();
    fireEvent.change(screen.getByRole("combobox", { name: "Column of field 3" }), { target: { value: "ID" } });
    expect(screen.getByText("values of VARCHAR(10) do not cast to INTEGER")).toBeTruthy();
    expect(screen.getByText("ID is chosen for more than one field.")).toBeTruthy();
    expect(screen.getByText("VARCHAR(10) cast to VARCHAR(20)")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Column of field 3" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /Commit each/u }), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("radio", { name: "Skip a row refused, and tell it" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Import" }));
      await settle();
    });
    expect(screen.getByText("This is a production connection, and the script may write.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Don't Import" }));
    expect(screen.getByText("Not imported: the import was not confirmed.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Import" }));
      await settle();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Import" }));
      await settle();
    });
    expect(screen.getByText("Imported 2 rows; 1 skipped:")).toBeTruthy();
    expect(screen.getByText("record 3, line 4: duplicate; skipped")).toBeTruthy();
    const spec = asked.filter((a) => a.command === "import_rows").at(-1)?.args;
    expect(spec).toMatchObject({
      connection: 1,
      confirmed: true,
      spec: {
        path: "/data/staff.csv",
        reading: { format: "csv", header: true, delimiter: ";", null: "N/A", sheet: null },
        table: '"ANN"."STAFF"',
        fields: ["NAME", "ID", null],
        batch: 10,
        skip: true,
        limit: null,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
  });

  it("says why a file cannot be read or imported, and imports nothing of no file [CLIENT Importing]", async () => {
    let fail = true;
    catalogBackend({
      catalog_table: () => refused({ message: "gone" }),
      choose_import_file: () => (fail ? null : "/data/bad.csv"),
      preview_import: () =>
        fail
          ? refused(new Error("record 1: a quote not closed"))
          : { headings: null, records: [], inferred: [], sheets: null },
      import_rows: () =>
        refused({
          sqlcode: -910,
          sqlstate: "TB910",
          message: "the import stopped",
          rule: null,
          position: null,
          active: false,
          diagnostics: null,
        }),
    });
    const store = await opened();
    within(store, <DataDialog task={{ kind: "import", ...OF }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Choose File…" }));
      await settle();
    });
    expect(screen.getByText("No file chosen.")).toBeTruthy();
    fail = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Choose File…" }));
      await settle();
    });
    fail = true;
    fireEvent.change(screen.getByRole("combobox", { name: "Format" }), { target: { value: "tsv" } });
    await settle();
    expect(screen.getByText("record 1: a quote not closed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import" })).toHaveProperty("disabled", true);
  });
});
