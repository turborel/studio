import type { TableDetail } from "../ipc/catalog";
import type { ColumnInfo } from "../ipc/connections";
import { addRow, editCell, editStatements, editTarget, keyOf, NO_EDITS, removeRows, staged, writable } from "./edits";
import { readTable } from "./editing";

/** A column of a result. */
function col(name: string | null): ColumnInfo {
  return { name, typeWritten: "INTEGER", typeName: null, notNull: false };
}

/** A column of a table. */
function column(name: string, extra: Partial<TableDetail["columns"][number]> = {}): TableDetail["columns"][number] {
  return {
    name,
    position: 1,
    typeWritten: "INTEGER",
    default: null,
    nullable: true,
    identity: null,
    generated: null,
    domain: null,
    ...extra,
  };
}

/** A table of `columns` and `constraints`. */
function table(
  columns: TableDetail["columns"],
  constraints: TableDetail["constraints"],
  kind = "BASE TABLE",
): TableDetail {
  return {
    schema: "ANN",
    name: "ITEMS",
    kind,
    columns,
    constraints,
    indexes: [],
    triggers: [],
    privileges: [],
    view: null,
    partitioning: null,
    partitionOf: null,
    storage: null,
  };
}

/** A constraint of `kind` over `columns`. */
function constraint(kind: string, columns: string[]): TableDetail["constraints"][number] {
  return { name: `C_${kind}`, kind, columns, check: null, references: null, deferrable: false };
}

const ITEMS = table(
  [
    column("ID", { nullable: false, identity: "ALWAYS" }),
    column("NAME"),
    column("TOTAL", { generated: "PRICE * 2" }),
    column("PRICE"),
  ],
  [constraint("PRIMARY KEY", ["ID"])],
);
const COLUMNS = [col("ID"), col("NAME"), col("TOTAL"), col("PRICE"), col(null)];

describe("a result's rows edited", () => {
  it("finds a row by its primary key, else by a unique key of columns that take no null [DESIGN] D42", () => {
    expect(keyOf(ITEMS)).toEqual(["ID"]);
    const unique = table(
      [column("A", { nullable: false }), column("B")],
      [constraint("UNIQUE", ["B"]), constraint("UNIQUE", ["A"])],
    );
    expect(keyOf(unique)).toEqual(["A"]);
    expect(keyOf(table([column("A")], [constraint("UNIQUE", ["A"])]))).toBeNull();
    const target = editTarget(ITEMS, COLUMNS);
    expect(target).toEqual({
      schema: "ANN",
      table: "ITEMS",
      columns: ["ID", "NAME", "TOTAL", "PRICE", null],
      key: [0],
      fixed: [0, 2],
    });
    expect([0, 1, 2, 3, 4].map((c) => writable(must(target), c))).toEqual([false, true, false, true, false]);
    expect(editTarget(ITEMS, [col("NAME")])).toBeNull();
    expect(editTarget(table(ITEMS.columns, ITEMS.constraints, "VIEW"), COLUMNS)).toBeNull();
    expect(editTarget(table([column("A")], []), [col("A")])).toBeNull();
    expect(editTarget(ITEMS, [col("ID"), col("ID")])).toBeNull();
  });

  it("stages cells, rows added and rows removed, and counts them [DESIGN] D42", () => {
    let edits = editCell(NO_EDITS, [1, 0], "Ada", 2);
    edits = editCell(edits, [3, 0], null, 2);
    edits = addRow(addRow(edits));
    edits = editCell(edits, [1, 3], "new", 2);
    expect(edits.added).toEqual([{}, { 1: "new" }]);
    edits = removeRows(edits, [1, 2], 2);
    expect(edits.removed).toEqual([1]);
    expect(edits.added).toEqual([{ 1: "new" }]);
    expect(staged(edits)).toBe(4);
    expect(removeRows(edits, [1], 2).removed).toEqual([]);
  });

  it("writes each change as its statement, each value a parameter, a row removed deleted alone [DESIGN] D42", () => {
    const target = must(editTarget(ITEMS, COLUMNS));
    const rows = [
      ["1", "Pen", "4", "2", "x"],
      ["2", "Ink", "6", "3", "y"],
      ["3", "Nib", "2", "1", "z"],
    ];
    let edits = editCell(NO_EDITS, [1, 0], "Quill", 3);
    edits = editCell(edits, [3, 0], null, 3);
    edits = editCell(edits, [2, 0], "99", 3);
    edits = editCell(edits, [1, 1], "gone", 3);
    edits = editCell(edits, [2, 2], "fixed alone", 3);
    edits = removeRows(edits, [1], 3);
    edits = editCell(addRow(addRow(edits)), [1, 3], "Pad", 3);
    expect(editStatements(target, rows, edits)).toEqual([
      { sql: 'DELETE FROM "ANN"."ITEMS" WHERE "ID" = ?', values: ["2"], one: true },
      {
        sql: 'UPDATE "ANN"."ITEMS" SET "NAME" = ?, "PRICE" = ? WHERE "ID" = ?',
        values: ["Quill", null, "1"],
        one: true,
      },
      { sql: 'INSERT INTO "ANN"."ITEMS" ("NAME") VALUES (?)', values: ["Pad"], one: false },
      { sql: 'INSERT INTO "ANN"."ITEMS" DEFAULT VALUES', values: [], one: false },
    ]);
    expect(editStatements(target, [], removeRows(NO_EDITS, [0], 1))[0]?.values).toEqual([null]);
  });

  it("reads the one table a query reads, of the session's schema where it names none [DESIGN] D42", () => {
    expect(readTable("SELECT * FROM ITEMS", "ANN")).toEqual({ schema: "ANN", name: "ITEMS" });
    expect(readTable("SELECT * FROM BOB.LEDGER WHERE 1 = 1", null)).toEqual({ schema: "BOB", name: "LEDGER" });
    expect(readTable("SELECT * FROM ITEMS", null)).toBeNull();
    expect(readTable("SELECT * FROM A, B", "ANN")).toBeNull();
    expect(readTable("VALUES (1)", "ANN")).toBeNull();
  });
});

/** `value`, which is there. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("expected a value");
  }
  return value;
}
