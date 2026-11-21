import { act, fireEvent, screen } from "@testing-library/react";
import { SchemaActions, TableActions } from "../explorer/TableActions";
import { catalogBackend, opened, settle, STAFF, within } from "../test/catalog";
import { DataDialog } from "./DataDialog";

/** The pieces of a script of `;`-ended statements, as the backend splits them. */
function split(text: string) {
  let at = 0;
  return text
    .split(";")
    .map((part) => {
      const lead = part.length - part.trimStart().length;
      const piece = {
        from: at + lead,
        to: at + part.trimEnd().length,
        statement: {
          text: part.trim(),
          class: "changeSchema",
          destroys: null,
          floor: null,
          readWrite: true,
          connects: false,
        },
      };
      at += part.length + 1;
      return piece;
    })
    .filter((p) => p.statement.text !== "");
}

/** Types `value` into the field named `name`. */
function type(name: string, value: string): void {
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
}

/** Chooses `value` of the choice named `name`. */
function choose(name: string, value: string): void {
  fireEvent.change(screen.getByRole("combobox", { name }), { target: { value } });
}

describe("making a table", () => {
  it("writes CREATE TABLE as its columns and constraints are filled in, and opens it in a worksheet or runs it [DESIGN] D44", async () => {
    const asked = catalogBackend({
      split_script: (args) => split(String(args["text"])),
      run_statement: () => ({
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
      }),
    });
    const store = await opened();
    within(store, <SchemaActions connection={1} schema="ANN" />);
    fireEvent.click(screen.getByRole("button", { name: "Create Table…" }));
    expect(store.current().dialog).toEqual({
      kind: "data",
      task: { kind: "createTable", connection: 1, schema: "ANN" },
    });
    within(store, <DataDialog task={{ kind: "createTable", connection: 1, schema: "ANN" }} />);
    expect(screen.getByText("The table needs a name.")).toBeTruthy();
    type("Name", "DEPT");
    expect(screen.getByText("Column 1 needs a name and a type.")).toBeTruthy();
    type("Name of column 1", "ID");
    type("Type of column 1", "NUMERIC(38,0)");
    fireEvent.click(screen.getByRole("checkbox", { name: "Column 1 is NOT NULL" }));
    choose("Key of column 1", "primary");
    fireEvent.click(screen.getByRole("button", { name: "Add Column" }));
    type("Name of column 2", "NAME");
    type("Type of column 2", "VARCHAR(20)");
    type("Default of column 2", "'none'");
    choose("Key of column 2", "unique");
    fireEvent.click(screen.getByRole("button", { name: "Add Column" }));
    type("Name of column 3", "GONE");
    fireEvent.click(screen.getByRole("button", { name: "Move column 3 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove column 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Constraint" }));
    type("Condition of constraint 1", "ID > 0");
    fireEvent.click(screen.getByRole("button", { name: "Add Constraint" }));
    choose("Kind of constraint 2", "foreignKey");
    type("Name of constraint 2", "DEPT_SELF");
    type("Columns of constraint 2", "ID");
    type("Table referenced by constraint 2", "ANN.DEPT");
    type("Columns referenced by constraint 2", "ID");
    choose("On delete of constraint 2", "CASCADE");
    fireEvent.click(screen.getByRole("button", { name: "Add Constraint" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove constraint 3" }));
    expect(screen.getByLabelText("DDL").textContent).toBe(
      "CREATE TABLE ANN.DEPT (\n    ID NUMERIC(38,0) NOT NULL PRIMARY KEY,\n    NAME VARCHAR(20) DEFAULT 'none' UNIQUE,\n" +
        "    CHECK (ID > 0),\n    CONSTRAINT DEPT_SELF FOREIGN KEY (ID) REFERENCES ANN.DEPT (ID) ON DELETE CASCADE\n);",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run" }));
      await settle();
    });
    expect(store.current().dialog).toBeNull();
    expect(store.current().worksheets.at(-1)).toMatchObject({ title: "Create DEPT", connection: 1 });
    expect(asked.filter((a) => a.command === "run_statement").map((a) => String(a.args["sql"]).split("\n")[0])).toEqual(
      ["CREATE TABLE ANN.DEPT ("],
    );
  });
});

describe("altering a table", () => {
  it("stages each action as its ALTER TABLE, and opens the script in a worksheet [DESIGN] D44", async () => {
    catalogBackend();
    const store = await opened();
    within(store, <TableActions connection={1} schema="ANN" table="STAFF" kind="BASE TABLE" />);
    fireEvent.click(screen.getByRole("button", { name: "Alter Table…" }));
    within(store, <DataDialog task={{ kind: "alterTable", connection: 1, schema: "ANN", table: "STAFF" }} />);
    expect(screen.getByText("Reading the table…")).toBeTruthy();
    await settle();
    expect(screen.getByText("Add an action to alter the table.")).toBeTruthy();
    type("Name of column 1", "NOTE");
    type("Type of column 1", "VARCHAR(10)");
    fireEvent.click(screen.getByRole("button", { name: "Add to Script" }));
    const steps: (readonly [string, () => void])[] = [
      [
        "dropColumn",
        () => {
          choose("Behaviour", "CASCADE");
        },
      ],
      [
        "renameColumn",
        () => {
          type("New name", "FULL_NAME");
        },
      ],
      [
        "setDefault",
        () => {
          type("Default", "0");
        },
      ],
      ["dropDefault", () => undefined],
      ["setNotNull", () => undefined],
      ["dropNotNull", () => undefined],
      [
        "setDataType",
        () => {
          type("Type", "DECIMAL(38,10)");
        },
      ],
      [
        "addConstraint",
        () => {
          type("Columns of constraint 1", "ID");
        },
      ],
      [
        "dropConstraint",
        () => {
          choose("Behaviour", "RESTRICT");
        },
      ],
      [
        "renameTable",
        () => {
          type("New name", "PEOPLE");
        },
      ],
    ];
    for (const [kind, fill] of steps) {
      choose("Action", kind);
      if (kind === "renameColumn") {
        choose("Column", STAFF.columns[1]?.name ?? "");
      }
      fill();
      fireEvent.click(screen.getByRole("button", { name: "Add to Script" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Remove action 6" }));
    const script = screen.getByLabelText("DDL").textContent.split("\n");
    expect(script).toHaveLength(10);
    expect(script[0]).toBe("ALTER TABLE ANN.STAFF ADD COLUMN NOTE VARCHAR(10);");
    expect(script[1]).toMatch(/^ALTER TABLE ANN\.STAFF DROP COLUMN \S+ CASCADE;$/u);
    expect(script.find((s) => s.includes("SET DATA TYPE"))).toMatch(/SET DATA TYPE DECIMAL\(38,10\);$/u);
    expect(script.at(-1)).toBe("ALTER TABLE ANN.STAFF RENAME TO PEOPLE;");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open in Worksheet" }));
      await settle();
    });
    expect(store.current().worksheets.at(-1)).toMatchObject({ title: "Alter STAFF", connection: 1 });
    expect(store.current().worksheets.at(-1)?.text.split("\n")).toEqual(script);
    within(store, <DataDialog task={{ kind: "alterTable", connection: 1, schema: "ANN", table: "STAFF" }} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" }).at(-1) ?? document.body);
  });
});
