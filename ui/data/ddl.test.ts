import {
  type AlterAction,
  alterScript,
  columnDefinition,
  constraintDefinition,
  createTableSql,
  namer,
  qualified,
  type TableSpec,
  tableProblem,
} from "./ddl";

const NAME = namer(["SELECT", "VALUE"]);

/** The key column of the tests' tables. */
const ID_COLUMN = { name: "ID", type: "INTEGER", notNull: true, default: "", primaryKey: true, unique: false };

/** The table the tests make. */
const DEPT: TableSpec = {
  schema: "ANN",
  name: "DEPT",
  columns: [
    { name: "ID", type: "INTEGER", notNull: true, default: "", primaryKey: true, unique: false },
    { name: "NAME", type: "VARCHAR(20)", notNull: false, default: "'none'", primaryKey: false, unique: true },
  ],
  constraints: [],
};

/** The table the tests make second, of a foreign key and a check. */
const STAFF2: TableSpec = {
  schema: "ANN",
  name: "STAFF2",
  columns: [
    { name: "ID", type: "INTEGER", notNull: true, default: "", primaryKey: true, unique: false },
    { name: "DEPT", type: "INTEGER", notNull: false, default: "", primaryKey: false, unique: false },
  ],
  constraints: [
    {
      kind: "foreignKey",
      name: "STAFF2_DEPT",
      columns: ["DEPT"],
      table: "ANN.DEPT",
      references: ["ID"],
      onDelete: "SET NULL",
    },
    { kind: "check", name: "", condition: "ID > 0" },
  ],
};

describe("the table dialogs' DDL", () => {
  it("writes CREATE TABLE of the columns and constraints, each name as Turborel reads it back [DOC sql/statements/create-table.md SYNOPSIS]", () => {
    expect(createTableSql(DEPT, NAME)).toBe(
      "CREATE TABLE ANN.DEPT (\n    ID INTEGER NOT NULL PRIMARY KEY,\n    NAME VARCHAR(20) DEFAULT 'none' UNIQUE\n)",
    );
    expect(createTableSql(STAFF2, NAME)).toBe(
      "CREATE TABLE ANN.STAFF2 (\n    ID INTEGER NOT NULL PRIMARY KEY,\n    DEPT INTEGER,\n" +
        "    CONSTRAINT STAFF2_DEPT FOREIGN KEY (DEPT) REFERENCES ANN.DEPT (ID) ON DELETE SET NULL,\n    CHECK (ID > 0)\n)",
    );
    expect(
      columnDefinition(
        { name: "value", type: "INTEGER", notNull: false, default: "", primaryKey: false, unique: false },
        NAME,
      ),
    ).toBe('"value" INTEGER');
    expect(qualified("ANN", "SELECT", NAME)).toBe('ANN."SELECT"');
    expect(constraintDefinition({ kind: "primaryKey", name: "PK", columns: ["A", "B"] }, NAME)).toBe(
      "CONSTRAINT PK PRIMARY KEY (A, B)",
    );
    expect(constraintDefinition({ kind: "unique", name: " ", columns: ["A"] }, NAME)).toBe("UNIQUE (A)");
    expect(
      constraintDefinition(
        { kind: "foreignKey", name: "", columns: ["A"], table: "T", references: [], onDelete: "NO ACTION" },
        NAME,
      ),
    ).toBe("FOREIGN KEY (A) REFERENCES T");
  });

  it("finds what a table lacks before it is written [DESIGN] D44", () => {
    expect(tableProblem(DEPT)).toBeNull();
    expect(tableProblem({ ...DEPT, name: " " })).toBe("The table needs a name.");
    expect(tableProblem({ ...DEPT, columns: [] })).toBe("The table needs a column.");
    expect(tableProblem({ ...DEPT, columns: [{ ...ID_COLUMN, type: "" }] })).toBe("Column 1 needs a name and a type.");
    expect(tableProblem({ ...DEPT, columns: [ID_COLUMN, ID_COLUMN] })).toBe("Two columns are named ID.");
  });

  it("writes an ALTER TABLE of each action, one a statement [DOC sql/statements/alter-table.md SYNOPSIS]", () => {
    const note = { name: "NOTE", type: "VARCHAR(10)", notNull: true, default: "'x'", primaryKey: false, unique: false };
    const actions: AlterAction[] = [
      { kind: "addColumn", column: note },
      { kind: "setDataType", column: "NOTE", type: "VARCHAR(40)" },
      { kind: "dropNotNull", column: "NOTE" },
      { kind: "setNotNull", column: "NOTE" },
      { kind: "setDefault", column: "NOTE", default: "'y'" },
      { kind: "dropDefault", column: "NOTE" },
      { kind: "renameColumn", column: "NOTE", to: "REMARK" },
      { kind: "addConstraint", constraint: { kind: "unique", name: "STAFF2_U", columns: ["REMARK"] } },
      { kind: "dropConstraint", constraint: "STAFF2_U", behavior: "RESTRICT" },
      { kind: "dropColumn", column: "REMARK", behavior: "RESTRICT" },
      { kind: "renameTable", to: "STAFF3" },
    ];
    expect(alterScript("ANN.STAFF2", actions, NAME).split("\n")).toEqual([
      "ALTER TABLE ANN.STAFF2 ADD COLUMN NOTE VARCHAR(10) DEFAULT 'x' NOT NULL;",
      "ALTER TABLE ANN.STAFF2 ALTER COLUMN NOTE SET DATA TYPE VARCHAR(40);",
      "ALTER TABLE ANN.STAFF2 ALTER COLUMN NOTE DROP NOT NULL;",
      "ALTER TABLE ANN.STAFF2 ALTER COLUMN NOTE SET NOT NULL;",
      "ALTER TABLE ANN.STAFF2 ALTER COLUMN NOTE SET DEFAULT 'y';",
      "ALTER TABLE ANN.STAFF2 ALTER COLUMN NOTE DROP DEFAULT;",
      "ALTER TABLE ANN.STAFF2 RENAME COLUMN NOTE TO REMARK;",
      "ALTER TABLE ANN.STAFF2 ADD CONSTRAINT STAFF2_U UNIQUE (REMARK);",
      "ALTER TABLE ANN.STAFF2 DROP CONSTRAINT STAFF2_U RESTRICT;",
      "ALTER TABLE ANN.STAFF2 DROP COLUMN REMARK RESTRICT;",
      "ALTER TABLE ANN.STAFF2 RENAME TO STAFF3;",
    ]);
  });
});
