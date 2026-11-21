import { act, fireEvent, screen } from "@testing-library/react";
import type { TableDetail } from "../ipc/catalog";
import { namer } from "../data/ddl";
import { command } from "../commands/commands";
import { catalogBackend, must, opened, refused, settle, STAFF, within } from "../test/catalog";
import { worksheetOf } from "../state/worksheets";
import { BuilderDialog } from "./BuilderDialog";
import { literalOf } from "./literal";
import { impliedJoin, nextAlias, NO_QUERY, pick, querySql, unpick } from "./query";

/** DEPTS, which STAFF's foreign key references. */
const DEPTS: TableDetail = {
  ...STAFF,
  name: "DEPTS",
  columns: [
    { ...must(STAFF.columns[0]), name: "ID" },
    { ...must(STAFF.columns[1]), name: "TITLE" },
  ],
  constraints: [
    { name: "DEPTS_PK", kind: "PRIMARY KEY", columns: ["ID"], check: null, references: null, deferrable: false },
  ],
};

const NAME = namer(["SELECT"]);

describe("a query built by its parts", () => {
  it("joins each table picked to one before it as a foreign key of either implies [DESIGN] D48", () => {
    const staffFirst = pick(pick(NO_QUERY, STAFF), DEPTS);
    expect(staffFirst.tables.map((t) => t.alias)).toEqual(["S1", "D1"]);
    expect(staffFirst.joins).toEqual([{ alias: "D1", kind: "INNER", on: [{ left: "D1.ID", right: "S1.DEPT" }] }]);
    const deptsFirst = pick(pick(NO_QUERY, DEPTS), STAFF);
    expect(deptsFirst.joins).toEqual([{ alias: "S1", kind: "INNER", on: [{ left: "S1.DEPT", right: "D1.ID" }] }]);
    expect(nextAlias(pick(NO_QUERY, STAFF), "SALES")).toBe("S2");
    expect(nextAlias(NO_QUERY, "_x")).toBe("X1");
    expect(nextAlias(NO_QUERY, "9")).toBe("T1");
    expect(impliedJoin([], { alias: "A", table: STAFF })).toBeNull();
    expect(pick(pick(NO_QUERY, DEPTS), DEPTS).joins).toEqual([]);
  });

  it("writes SELECT of its columns and aggregates, FROM its joins, WHERE, GROUP BY and ORDER BY [DOC sql/statements/select.md SYNOPSIS]", () => {
    expect(querySql(NO_QUERY, NAME)).toBe("");
    const picked = pick(pick(NO_QUERY, STAFF), DEPTS);
    expect(querySql(picked, NAME)).toBe("SELECT *\nFROM ANN.STAFF S1\nJOIN ANN.DEPTS D1 ON D1.ID = S1.DEPT");
    const built = {
      ...picked,
      joins: picked.joins.map((j) => ({ ...j, kind: "LEFT" as const })),
      columns: [
        { alias: "D1", column: "TITLE", aggregate: "" as const },
        { alias: "S1", column: "ID", aggregate: "COUNT" as const },
      ],
      conditions: [
        { alias: "S1", column: "NAME", operator: "LIKE" as const, value: "A%" },
        { alias: "S1", column: "ID", operator: ">" as const, value: "1" },
        { alias: "D1", column: "TITLE", operator: "IS NOT NULL" as const, value: "" },
        { alias: "X9", column: "Q", operator: "=" as const, value: "it's" },
      ],
      order: [{ alias: "D1", column: "TITLE", descending: true }],
    };
    expect(querySql(built, NAME)).toBe(
      "SELECT D1.TITLE, COUNT(S1.ID)\nFROM ANN.STAFF S1\nLEFT JOIN ANN.DEPTS D1 ON D1.ID = S1.DEPT\n" +
        "WHERE S1.NAME LIKE 'A%'\n    AND S1.ID > 1\n    AND D1.TITLE IS NOT NULL\n    AND X9.Q = 'it''s'\nGROUP BY D1.TITLE\nORDER BY D1.TITLE DESC",
    );
    expect(querySql({ ...built, joins: [] }, NAME)).toContain("FROM ANN.STAFF S1, ANN.DEPTS D1");
    const gone = unpick(built, "S1");
    expect(gone.tables.map((t) => t.alias)).toEqual(["D1"]);
    expect([gone.joins, gone.columns.length, gone.conditions.length, gone.order.length]).toEqual([[], 1, 2, 1]);
    expect(literalOf("2024-01-02", "DATE")).toBe("CAST('2024-01-02' AS DATE)");
    expect(literalOf("x", "BLOB(1M)")).toBe("'x'");
  });
});

describe("the query builder", () => {
  it("is opened of a new worksheet, and writes its query there as it is built [DESIGN] D48", async () => {
    catalogBackend({
      catalog_objects: () => ({
        tables: [
          { name: "STAFF", kind: "BASE TABLE" },
          { name: "DEPTS", kind: "BASE TABLE" },
        ],
        routines: [],
        sequences: [],
        domains: [],
        types: [],
        truncated: false,
      }),
      catalog_table: (args) => (args["name"] === "DEPTS" ? DEPTS : STAFF),
    });
    const store = await opened();
    await must(command("worksheet.queryBuilder")).run({ store, api: null } as never);
    const dialog = store.current().dialog;
    expect(dialog).toMatchObject({ kind: "builder", connection: 1, schema: "ANN" });
    const worksheet = dialog?.kind === "builder" ? dialog.worksheet : "";
    within(store, <BuilderDialog worksheet={worksheet} connection={1} schema="ANN" />);
    await settle();
    const add = async (name: string) => {
      fireEvent.change(screen.getByRole("combobox", { name: "Table" }), { target: { value: name } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Add Table" }));
        await settle();
      });
    };
    await add("STAFF");
    await add("DEPTS");
    fireEvent.click(screen.getByRole("checkbox", { name: "TITLE" }));
    fireEvent.click(screen.getAllByRole("checkbox", { name: "ID" })[0] ?? document.body);
    fireEvent.change(screen.getByRole("combobox", { name: "Aggregate of S1.ID" }), { target: { value: "COUNT" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Join of D1" }), { target: { value: "INNER" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Join of D1" }), { target: { value: "LEFT" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Condition" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Column of condition 1" }), { target: { value: "S1.NAME" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Operator of condition 1" }), { target: { value: "LIKE" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Value of condition 1" }), { target: { value: "A%" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Condition" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Value of condition 1" }), { target: { value: "A%" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove condition 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Order" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Column of order 1" }), { target: { value: "D1.TITLE" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Descending" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Order" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Column of order 1" }), { target: { value: "D1.TITLE" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove order 2" }));
    const sql =
      "SELECT D1.TITLE, COUNT(S1.ID)\nFROM ANN.STAFF S1\nLEFT JOIN ANN.DEPTS D1 ON D1.ID = S1.DEPT\nWHERE S1.NAME LIKE 'A%'\nGROUP BY D1.TITLE\nORDER BY D1.TITLE DESC";
    expect(screen.getByLabelText("Query").textContent).toBe(sql);
    expect(worksheetOf(store.current(), worksheet)?.text).toBe(sql);
    fireEvent.click(screen.getByRole("checkbox", { name: "TITLE" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove D1" }));
    expect(worksheetOf(store.current(), worksheet)?.text).toBe(
      "SELECT COUNT(S1.ID)\nFROM ANN.STAFF S1\nWHERE S1.NAME LIKE 'A%'",
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(store.current().dialog).toBeNull();
  });

  it("says why a table could not be picked [DESIGN] D48", async () => {
    catalogBackend({
      catalog_objects: () => ({
        tables: [{ name: "STAFF", kind: "BASE TABLE" }],
        routines: [],
        sequences: [],
        domains: [],
        types: [],
        truncated: false,
      }),
      catalog_table: () => refused({ message: "not to be seen" }),
    });
    const store = await opened();
    within(store, <BuilderDialog worksheet="w" connection={1} schema="ANN" />);
    await settle();
    fireEvent.change(screen.getByRole("combobox", { name: "Table" }), { target: { value: "STAFF" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add Table" }));
      await settle();
    });
    expect(screen.getByText("not to be seen")).toBeTruthy();
  });
});
