import { act, fireEvent, screen } from "@testing-library/react";
import { emit } from "@tauri-apps/api/event";
import type { Column } from "../ipc/catalog";
import type { Preview } from "../ipc/data";
import { STUDIO_EVENT } from "../ipc/events";
import { catalogBackend, opened, settle, within } from "../test/catalog";
import { DataDialog } from "./DataDialog";
import { castNote, familyOf, mappingProblems, newColumns, policySpec, tableNameOf } from "./importing";

/** A column of `type`, null or not. */
function column(name: string, typeWritten: string, nullable = true, defaulted = false): Column {
  return {
    name,
    position: 1,
    typeWritten,
    default: defaulted ? "0" : null,
    nullable,
    identity: null,
    generated: null,
    domain: null,
  };
}

/** A field inferred of `type`. */
function inferred(typeWritten: string, nulls = false) {
  return { typeWritten, nulls };
}

describe("the import wizard's reckoning", () => {
  it("shows each field's cast, and flags what will not fit or cast [DESIGN] D63", () => {
    expect(familyOf("NUMERIC(38,0)")).toBe("exact");
    expect(familyOf("TIMESTAMP WITH TIME ZONE")).toBe("timestamp");
    expect(familyOf("TIME")).toBe("time");
    expect(castNote(inferred("INTEGER"), column("ID", "INTEGER"))).toEqual({ cast: "", conflict: null });
    expect(castNote(inferred("INTEGER"), column("N", "NUMERIC(38,0)"))).toEqual({
      cast: "INTEGER cast to NUMERIC(38,0)",
      conflict: null,
    });
    expect(castNote(inferred("NUMERIC(38,0)"), column("N", "BIGINT")).conflict).toBe(
      "numbers of 38 digits before the point do not fit BIGINT",
    );
    expect(castNote(inferred("NUMERIC(5,3)"), column("N", "NUMERIC(10,2)")).conflict).toBe(
      "digits after the point past 2 are rounded",
    );
    expect(castNote(inferred("VARCHAR(20)"), column("N", "INTEGER")).conflict).toBe(
      "values of VARCHAR(20) do not cast to INTEGER",
    );
    expect(castNote(inferred("VARCHAR(100)"), column("S", "VARCHAR(10)")).conflict).toBe(
      "values up to 100 characters may not fit VARCHAR(10)",
    );
    expect(castNote(inferred("DATE"), column("T", "TIMESTAMP")).conflict).toBeNull();
    expect(castNote(inferred("INTEGER", true), column("ID", "INTEGER", false)).conflict).toBe(
      "ID takes no null, and the file has some",
    );
  });

  it("flags a column chosen twice, and one that takes no null left out [DESIGN] D63", () => {
    const columns = [
      column("ID", "INTEGER", false),
      column("NAME", "VARCHAR(20)"),
      column("N", "INTEGER", false, true),
    ];
    expect(mappingProblems(["NAME", "NAME"], columns)).toEqual([
      "NAME is chosen for more than one field.",
      "ID takes no null and has no default: choose a field for it.",
    ]);
    expect(mappingProblems(["ID", null], columns)).toEqual([]);
  });

  it("names a new table's columns by the file's headings, typed as inferred, and the table by the file [DESIGN] D63", () => {
    expect(
      newColumns(["id", "Full Name", ""], [inferred("INTEGER"), inferred("VARCHAR(20)"), inferred("DATE")]),
    ).toEqual([
      { field: 0, name: "ID", type: "INTEGER", included: true },
      { field: 1, name: "Full Name", type: "VARCHAR(20)", included: true },
      { field: 2, name: "COLUMN_3", type: "DATE", included: true },
    ]);
    expect(newColumns(null, [inferred("BOOLEAN")])[0]?.name).toBe("COLUMN_1");
    expect(tableNameOf("/data/sales 2024.xlsx")).toBe("SALES_2024");
    expect(tableNameOf("C:\\data\\2024.csv")).toBe("IMPORTED_2024");
    expect(policySpec({ kind: "stop" })).toEqual({ skip: false, limit: null });
    expect(policySpec({ kind: "skip" })).toEqual({ skip: true, limit: null });
    expect(policySpec({ kind: "limit", rows: 5 })).toEqual({ skip: true, limit: 5 });
  });
});

/** A workbook's preview: two sheets, a header, a 38-digit number and a date. */
const BOOK: Preview = {
  headings: ["id", "Amount", "Born"],
  records: [["1", "12345678901234567890123456789012345678", "2024-01-02"]],
  inferred: [inferred("INTEGER"), inferred("NUMERIC(38,0)"), inferred("DATE", true)],
  sheets: ["People", "Other"],
};

describe("importing into a new table", () => {
  it("infers its columns, shows its CREATE TABLE, makes it through the guards, then imports with progress and cancel [DESIGN] D63", async () => {
    let finish: (report: unknown) => void = () => undefined;
    const asked = catalogBackend({
      choose_import_file: () => "/data/people.xlsx",
      preview_import: () => BOOK,
      run_statement: (args) =>
        args["confirmed"] === true
          ? {
              kind: "ran",
              answer: {
                outcome: { kind: "done", sqlcode: 0, sqlstate: "00000", rowsAffected: null, generated: [] },
                warnings: [],
                serverTime: null,
                session: {
                  authorization: "ANN",
                  schema: "ANN",
                  transaction: { active: false, autocommit: true, readOnly: false },
                },
              },
            }
          : { kind: "confirm", answer: { class: "changeSchema", destroys: [], unclassified: [], production: true } },
      import_rows: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const store = await opened();
    within(store, <DataDialog task={{ kind: "importNew", connection: 1, schema: "ANN" }} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Format" }), { target: { value: "xlsx" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Choose File…" }));
      await settle();
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Sheet" }), { target: { value: "Other" } });
    await settle();
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Name of the new table" }).value).toBe("PEOPLE");
    fireEvent.change(screen.getByRole("combobox", { name: "Type of field 3's column" }), {
      target: { value: "TIMESTAMP" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Make a column of field 1" }));
    expect(screen.getByLabelText("DDL").textContent).toBe(
      "CREATE TABLE ANN.PEOPLE (\n    AMOUNT NUMERIC(38,0),\n    BORN TIMESTAMP\n)",
    );
    fireEvent.click(screen.getByRole("radio", { name: /Skip at most/u }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Rows that may be skipped" }), { target: { value: "5" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create Table and Import" }));
      await settle();
    });
    expect(screen.getByText("This is a production connection, and the script may write.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create Table" }));
      await settle();
    });
    const imports = asked.filter((a) => a.command === "import_rows");
    expect(imports.at(-1)?.args).toMatchObject({
      connection: 1,
      confirmed: false,
      spec: {
        path: "/data/people.xlsx",
        reading: { format: "xlsx", header: true, sheet: "Other" },
        table: "ANN.PEOPLE",
        fields: [null, "AMOUNT", "BORN"],
        skip: true,
        limit: 5,
      },
    });
    await act(async () => {
      await emit(STUDIO_EVENT, {
        kind: "import",
        connection: 1,
        progress: { records: 7, rejected: 1, read: 7, total: 10 },
      });
    });
    expect(screen.getByRole("status", { name: "Progress" }).textContent).toContain("7 records read, 1 skipped.");
    fireEvent.click(screen.getByRole("button", { name: "Cancel Import" }));
    expect(asked.some((a) => a.command === "cancel_import")).toBe(true);
    await act(async () => {
      finish({ kind: "imported", answer: { rows: 5, rejected: 1, skipped: [], cancelled: true, rolledBack: 2 } });
      await settle();
    });
    expect(screen.getByRole("status", { name: "What the import did" }).textContent).toBe(
      "Cancelled: 5 rows imported; the 2 of the batch under way were rolled back.",
    );
  });

  it("says what a new table needs before it is made [DESIGN] D63", async () => {
    catalogBackend({ choose_import_file: () => "/data/x.csv", preview_import: () => ({ ...BOOK, sheets: null }) });
    const store = await opened();
    within(store, <DataDialog task={{ kind: "importNew", connection: 1, schema: "ANN" }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Choose File…" }));
      await settle();
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Name of the new table" }), { target: { value: " " } });
    fireEvent.change(screen.getByRole("textbox", { name: "Name of field 2's column" }), { target: { value: "id" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Type of field 3's column" }), { target: { value: "" } });
    const problems = screen.getByRole("list", { name: "Problems" }).textContent;
    expect(problems).toContain("The table needs a name.");
    expect(problems).toContain("Field 3's column needs a name and a type.");
    expect(problems).toContain("Two columns have the same name.");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Create Table and Import" }).disabled).toBe(true);
  });
});
