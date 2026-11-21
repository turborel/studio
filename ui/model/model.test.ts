import type { TableDetail } from "../ipc/catalog";
import { must } from "../test/catalog";
import FILES_PAGE from "../../doc/appendix/d-files.md?raw";
import { namer } from "../data/ddl";
import { formOf, tableOf } from "./edit";
import { edgesOf, nodesOf, shown } from "./flowParts";
import { svgSize } from "./image";
import { boxHeight, laidOut } from "./layout";
import { merged } from "./live";
import { columnSql, createSql, migration, sameType } from "./migrate";
import {
  emptyModel,
  type Model,
  MODEL_FORMAT,
  modelTable,
  type ModelTable,
  modelText,
  parseModel,
  tableKey,
} from "./model";
import { columnMarks, modelSvg, xmlText } from "./svg";

/** A column of a live table. */
function column(
  name: string,
  typeWritten: string,
  nullable = true,
  def: string | null = null,
): TableDetail["columns"][number] {
  return { name, position: 1, typeWritten, default: def, nullable, identity: null, generated: null, domain: null };
}

/** DEPT and STAFF, as the catalog reads them. */
const DEPT: TableDetail = {
  schema: "ANN",
  name: "DEPT",
  kind: "BASE TABLE",
  columns: [column("ID", "INTEGER", false), column("NAME", "VARCHAR(20)", true, "'none'")],
  constraints: [
    { name: "DEPT_PRIMARY1", kind: "PRIMARY KEY", columns: ["ID"], check: null, references: null, deferrable: false },
    { name: "DEPT_NOTNULL1", kind: "CHECK", columns: [], check: "ID IS NOT NULL", references: null, deferrable: false },
  ],
  indexes: [{ name: "DEPT_PK_INDEX", method: "btree", unique: true, columns: ["ID"], implied: true, options: [] }],
  triggers: [],
  privileges: [],
  view: null,
  partitioning: null,
  partitionOf: null,
  storage: null,
};

const STAFF: TableDetail = {
  ...DEPT,
  name: "STAFF",
  columns: [column("ID", "INTEGER", false), column("DEPT", "INTEGER"), column("AGE", "INTEGER")],
  constraints: [
    { name: "STAFF_PRIMARY1", kind: "PRIMARY KEY", columns: ["ID"], check: null, references: null, deferrable: false },
    { name: "STAFF_AGE", kind: "CHECK", columns: [], check: "AGE > 0", references: null, deferrable: false },
    {
      name: "STAFF_UNIQUE1",
      kind: "UNIQUE",
      columns: ["DEPT", "AGE"],
      check: null,
      references: null,
      deferrable: false,
    },
    {
      name: "STAFF_DEPT",
      kind: "FOREIGN KEY",
      columns: ["DEPT"],
      check: null,
      references: {
        schema: "ANN",
        table: "DEPT",
        columns: ["ID"],
        matching: "NONE",
        onUpdate: "NO ACTION",
        onDelete: "SET NULL",
      },
      deferrable: false,
    },
  ],
  indexes: [{ name: "STAFF_BY_DEPT", method: "btree", unique: false, columns: ["DEPT"], implied: false, options: [] }],
};

/** The model of DEPT and STAFF. */
function model(): Model {
  return { name: "Sales", tables: [modelTable(DEPT), modelTable(STAFF)], graphs: [] };
}

const NAME = namer(["SELECT"]);

describe("a model", () => {
  it("is read of a live table: its columns, keys, checks but NOT NULL's, foreign keys, and indexes not made for keys [DESIGN] D46", () => {
    expect(modelTable(DEPT)).toEqual({
      schema: "ANN",
      name: "DEPT",
      columns: [
        { name: "ID", type: "INTEGER", notNull: true, default: null },
        { name: "NAME", type: "VARCHAR(20)", notNull: false, default: "'none'" },
      ],
      primaryKey: { name: "DEPT_PRIMARY1", columns: ["ID"] },
      uniques: [],
      checks: [],
      foreignKeys: [],
      indexes: [],
      position: null,
    });
    const staff = modelTable(STAFF);
    expect(staff.checks).toEqual([{ name: "STAFF_AGE", condition: "AGE > 0" }]);
    expect(staff.foreignKeys[0]).toEqual({
      name: "STAFF_DEPT",
      columns: ["DEPT"],
      references: { schema: "ANN", table: "DEPT", columns: ["ID"] },
      onDelete: "SET NULL",
      onUpdate: "NO ACTION",
    });
    expect(staff.indexes).toEqual([{ name: "STAFF_BY_DEPT", columns: ["DEPT"], method: "btree" }]);
    expect(
      modelTable({ ...STAFF, constraints: [{ ...must(STAFF.constraints[3]), references: null }] }).foreignKeys,
    ).toEqual([]);
  });

  it("is kept as JSON of its format and version 1, and read back only if it is one [DESIGN] D46", () => {
    const m = laidOut(model());
    const text = modelText(m);
    expect(JSON.parse(text)).toMatchObject({ format: MODEL_FORMAT, version: 1, name: "Sales" });
    expect(parseModel(text)).toEqual(m);
    expect(() => parseModel("{")).toThrow("The file is not JSON");
    expect(() => parseModel('{"format":"other"}')).toThrow("no Turborel Studio model");
    expect(() => parseModel(`{"format":"${MODEL_FORMAT}","version":2}`)).toThrow(
      "of version 2; this Studio reads version 1",
    );
    expect(() =>
      parseModel(`{"format":"${MODEL_FORMAT}","version":1,"name":"x","tables":[{"schema":"A"}],"graphs":[]}`),
    ).toThrow("not as a model writes them");
    const broken = (change: (t: Record<string, unknown>) => void) => {
      const raw = JSON.parse(text) as { tables: Record<string, unknown>[] };
      change(raw.tables[1] ?? {});
      return () => parseModel(JSON.stringify(raw));
    };
    expect(
      broken((t) => {
        t["foreignKeys"] = [{ name: null, columns: ["A"], references: { schema: "A" }, onDelete: "x", onUpdate: "x" }];
      }),
    ).toThrow();
    expect(
      broken((t) => {
        t["indexes"] = [{ name: "I", columns: ["A"], method: 1 }];
      }),
    ).toThrow();
    expect(
      broken((t) => {
        t["position"] = { x: "1" };
      }),
    ).toThrow();
    expect(
      broken((t) => {
        t["checks"] = [{ condition: 1 }];
      }),
    ).toThrow();
    expect(
      broken((t) => {
        t["primaryKey"] = null;
      }),
    ).not.toThrow();
    expect(emptyModel("M")).toEqual({ name: "M", tables: [], graphs: [] });
    expect(tableKey({ schema: "A", table: "B" })).toBe("A.B");
  });

  it("is laid out by its foreign keys, a table placed kept, all again if asked [DESIGN] D46", () => {
    const first = laidOut(model());
    expect(first.tables.every((t) => t.position !== null)).toBe(true);
    const dept = first.tables.find((t) => t.name === "DEPT");
    const staff = first.tables.find((t) => t.name === "STAFF");
    expect((staff?.position?.x ?? 0) < (dept?.position?.x ?? 0)).toBe(true);
    const moved = {
      ...first,
      tables: first.tables.map((t) => (t.name === "DEPT" ? { ...t, position: { x: 999, y: 9 } } : t)),
    };
    expect(laidOut(moved).tables.find((t) => t.name === "DEPT")?.position).toEqual({ x: 999, y: 9 });
    expect(laidOut(moved, true).tables.find((t) => t.name === "DEPT")?.position).toEqual(dept?.position);
    expect(boxHeight({ ...modelTable(DEPT), columns: [] })).toBe(58);
  });

  it("merges tables read again into a model, kept where they were drawn [DESIGN] D46", () => {
    const placed = laidOut(model());
    const again: Model = {
      name: "x",
      tables: [{ ...modelTable(DEPT), columns: [] }],
      graphs: [{ schema: "ANN", name: "G", elements: [] }],
    };
    const both = merged(placed, again);
    expect(both.tables.map((t) => t.name)).toEqual(["STAFF", "DEPT"]);
    expect(both.tables[1]?.position).toEqual(placed.tables[0]?.position);
    expect(both.tables[1]?.columns).toEqual([]);
    expect(merged(both, again).graphs).toHaveLength(1);
  });
});

describe("a model's diagram", () => {
  it("draws the tables shown, a box of each schema when grouped, and an edge of each foreign key and graph end [DESIGN] D46", () => {
    const m: Model = {
      ...laidOut(model()),
      graphs: [
        {
          schema: "ANN",
          name: "BANK",
          elements: [
            { alias: "DEPT", kind: "VERTEX", schema: "ANN", table: "DEPT", undirected: false, labels: [], ends: [] },
            {
              alias: "STAFF",
              kind: "EDGE",
              schema: "ANN",
              table: "STAFF",
              undirected: false,
              labels: [],
              ends: [{ end: "SOURCE", vertex: "DEPT", columns: [["DEPT", "ID"]] }],
            },
            {
              alias: "Q",
              kind: "EDGE",
              schema: null,
              table: null,
              undirected: false,
              labels: [],
              ends: [{ end: "SOURCE", vertex: "NONE", columns: [] }],
            },
          ],
        },
      ],
    };
    expect(shown(modelTable(DEPT), "dep")).toBe(true);
    expect(
      nodesOf(m, { filter: "", grouped: false, selected: "ANN.DEPT" }).map((n) => [
        n.id,
        (n.data as { selected?: boolean }).selected,
      ]),
    ).toEqual([
      ["ANN.DEPT", true],
      ["ANN.STAFF", false],
    ]);
    expect(nodesOf(m, { filter: "staff", grouped: true, selected: null }).map((n) => n.id)).toEqual([
      "schema:ANN",
      "ANN.STAFF",
    ]);
    expect(edgesOf(m, "").map((e) => [e.id, e.label])).toEqual([
      ["fk:ANN.STAFF:0", "DEPT → ID, ON DELETE SET NULL"],
      ["graph:BANK:STAFF:SOURCE", "BANK SOURCE"],
    ]);
    expect(edgesOf(m, "dept")).toEqual([]);
    const plain = {
      ...m,
      tables: m.tables.map((t) => ({
        ...t,
        position: null,
        foreignKeys: t.foreignKeys.map((f) => ({ ...f, onDelete: "NO ACTION" })),
      })),
    };
    expect(edgesOf(plain, "")[0]?.label).toBe("DEPT → ID");
    expect(nodesOf(plain, { filter: "", grouped: true, selected: null })[0]?.position).toEqual({ x: -24, y: -48 });
  });

  it("is written as SVG: each table's box of its columns and marks, each foreign key a line [DESIGN] D46", () => {
    const svg = modelSvg(laidOut(model()));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(">ANN.STAFF</text>");
    expect(svg).toContain(">INTEGER PK NN</text>");
    expect(svg).toContain(">INTEGER FK</text>");
    expect(svg).toContain("<title>STAFF_DEPT (DEPT)</title>");
    expect(svgSize(svg).width).toBeGreaterThan(0);
    expect(svgSize("<svg/>")).toEqual({ width: 0, height: 0 });
    expect(xmlText(`<a & "b">`)).toBe("&lt;a &amp; &quot;b&quot;&gt;");
    expect(columnMarks(modelTable(DEPT), "NAME")).toBe("");
    expect(modelSvg(emptyModel("E"))).toContain('width="40"');
    const unplaced = modelSvg({
      ...model(),
      tables: [
        { ...modelTable(STAFF), foreignKeys: [{ ...must(modelTable(STAFF).foreignKeys[0]), name: null }] },
        modelTable(DEPT),
      ],
    });
    expect(unplaced).toContain("<title> (DEPT)</title>");
    expect(modelSvg({ ...model(), tables: [modelTable(STAFF)] })).not.toContain("<line");
  });
});

describe("a model's table edited by the forms", () => {
  it("is the forms' columns and constraints, and back, kept where it was drawn [DESIGN] D46", () => {
    const staff: ModelTable = {
      ...modelTable(STAFF),
      position: { x: 1, y: 2 },
      uniques: [...modelTable(STAFF).uniques, { name: null, columns: ["AGE"] }],
    };
    const form = formOf(staff);
    expect(form.columns.map((c) => [c.name, c.primaryKey, c.unique])).toEqual([
      ["ID", true, false],
      ["DEPT", false, false],
      ["AGE", false, true],
    ]);
    expect(form.constraints.map((c) => c.kind)).toEqual(["unique", "check", "foreignKey"]);
    expect(form.indexes).toEqual([{ name: "STAFF_BY_DEPT", columns: "DEPT", method: "btree" }]);
    const back = tableOf({ ...form, indexes: [...form.indexes, { name: " ", columns: "", method: "hash" }] }, staff);
    expect(back.position).toEqual({ x: 1, y: 2 });
    expect(back.primaryKey).toEqual({ name: null, columns: ["ID"] });
    expect(back.uniques).toEqual([
      { name: null, columns: ["AGE"] },
      { name: "STAFF_UNIQUE1", columns: ["DEPT", "AGE"] },
    ]);
    expect(back.foreignKeys).toEqual(staff.foreignKeys);
    expect(back.indexes).toEqual(staff.indexes);
    const composite = formOf({ ...staff, primaryKey: { name: "PK", columns: ["ID", "DEPT"] } });
    expect(tableOf(composite, null).primaryKey).toEqual({ name: "PK", columns: ["ID", "DEPT"] });
    const local = tableOf(
      {
        ...composite,
        constraints: [
          { kind: "foreignKey", name: "", columns: ["DEPT"], table: "DEPT", references: ["ID"], onDelete: "CASCADE" },
        ],
      },
      null,
    );
    expect(local.foreignKeys[0]?.references).toEqual({ schema: "ANN", table: "DEPT", columns: ["ID"] });
    expect(local.position).toBeNull();
    expect(
      tableOf(
        { ...composite, columns: composite.columns.map((c) => ({ ...c, primaryKey: false })), constraints: [] },
        null,
      ).primaryKey,
    ).toBeNull();
    expect(formOf({ ...staff, primaryKey: null }).constraints[0]?.kind).toBe("unique");
  });
});

describe("a schema taken to a model", () => {
  it("makes each table the schema lacks, its foreign keys and indexes after every table [DOC sql/statements/create-table.md SYNOPSIS]", () => {
    expect(createSql(modelTable(STAFF), NAME)).toBe(
      "CREATE TABLE ANN.STAFF (\n    ID INTEGER NOT NULL,\n    DEPT INTEGER,\n    AGE INTEGER,\n    CONSTRAINT STAFF_PRIMARY1 PRIMARY KEY (ID),\n" +
        "    CONSTRAINT STAFF_UNIQUE1 UNIQUE (DEPT, AGE),\n    CONSTRAINT STAFF_AGE CHECK (AGE > 0)\n);",
    );
    expect(columnSql({ name: "SELECT", type: "INTEGER", notNull: false, default: "0" }, NAME)).toBe(
      '"SELECT" INTEGER DEFAULT 0',
    );
    const found = migration(model(), emptyModel("live"), NAME);
    expect(found.statements).toEqual([
      "CREATE TABLE ANN.DEPT (\n    ID INTEGER NOT NULL,\n    NAME VARCHAR(20) DEFAULT 'none',\n    CONSTRAINT DEPT_PRIMARY1 PRIMARY KEY (ID)\n);",
      createSql(modelTable(STAFF), NAME),
      "ALTER TABLE ANN.STAFF ADD CONSTRAINT STAFF_DEPT FOREIGN KEY (DEPT) REFERENCES ANN.DEPT (ID) ON DELETE SET NULL;",
      "CREATE INDEX STAFF_BY_DEPT ON ANN.STAFF (DEPT);",
    ]);
    expect(found.differences).toEqual([
      { table: "ANN.DEPT", what: "the table is made" },
      { table: "ANN.STAFF", what: "the table is made" },
    ]);
  });

  it("alters each table of both, its columns and constraints and indexes, matched by what they are, and drops a table the model lacks [DOC sql/statements/alter-table.md SYNOPSIS]", () => {
    const live = model();
    const staff = modelTable(STAFF);
    const desired: Model = {
      ...live,
      tables: [
        {
          ...staff,
          columns: [
            { name: "ID", type: "BIGINT", notNull: true, default: null },
            { name: "DEPT", type: "INTEGER", notNull: true, default: "1" },
            { name: "NOTE", type: "VARCHAR(40)", notNull: false, default: null },
          ],
          uniques: [],
          checks: [{ name: "STAFF_NOTE", condition: "NOTE <> ''" }],
          foreignKeys: [{ ...must(staff.foreignKeys[0]), name: "OTHER_NAME", onUpdate: "CASCADE" }],
          indexes: [{ name: "STAFF_BY_NOTE", columns: ["NOTE"], method: "hash" }],
        },
      ],
    };
    const found = migration(desired, live, NAME);
    expect(found.statements).toEqual([
      "ALTER TABLE ANN.STAFF DROP CONSTRAINT STAFF_DEPT RESTRICT;",
      "DROP INDEX STAFF_BY_DEPT;",
      "ALTER TABLE ANN.STAFF DROP CONSTRAINT STAFF_UNIQUE1 RESTRICT;",
      "ALTER TABLE ANN.STAFF DROP CONSTRAINT STAFF_AGE RESTRICT;",
      "DROP TABLE ANN.DEPT RESTRICT;",
      "ALTER TABLE ANN.STAFF ALTER COLUMN ID SET DATA TYPE BIGINT;",
      "ALTER TABLE ANN.STAFF ALTER COLUMN DEPT SET DEFAULT 1;",
      "ALTER TABLE ANN.STAFF ALTER COLUMN DEPT SET NOT NULL;",
      "ALTER TABLE ANN.STAFF ADD COLUMN NOTE VARCHAR(40);",
      "ALTER TABLE ANN.STAFF DROP COLUMN AGE RESTRICT;",
      "ALTER TABLE ANN.STAFF ADD CONSTRAINT STAFF_NOTE CHECK (NOTE <> '');",
      "ALTER TABLE ANN.STAFF ADD CONSTRAINT OTHER_NAME FOREIGN KEY (DEPT) REFERENCES ANN.DEPT (ID) ON UPDATE CASCADE ON DELETE SET NULL;",
      "CREATE INDEX STAFF_BY_NOTE ON ANN.STAFF (NOTE) USING hash;",
    ]);
    expect(found.differences.map((d) => d.what)).toContain("column DEPT's default is 1");
    const back = migration(
      live,
      {
        ...live,
        tables: [
          {
            ...modelTable(DEPT),
            columns: [
              { name: "ID", type: "INTEGER", notNull: false, default: "0" },
              ...modelTable(DEPT).columns.slice(1),
            ],
          },
          staff,
        ],
      },
      NAME,
    );
    expect(back.statements).toEqual([
      "ALTER TABLE ANN.DEPT ALTER COLUMN ID DROP DEFAULT;",
      "ALTER TABLE ANN.DEPT ALTER COLUMN ID SET NOT NULL;",
    ]);
    expect(back.differences.map((d) => d.what)).toEqual(["column ID's default is none", "column ID is NOT NULL"]);
    expect(migration(live, live, NAME).statements).toEqual([]);
    expect(
      migration(
        live,
        { ...live, tables: [modelTable(DEPT), { ...staff, checks: [{ name: "X", condition: "AGE  >  0" }] }] },
        NAME,
      ).statements,
    ).toEqual([]);
    const unnamed = migration(
      { ...live, tables: [modelTable(DEPT), { ...staff, uniques: [] }] },
      {
        ...live,
        tables: [modelTable(DEPT), { ...staff, uniques: [{ name: null, columns: ["AGE"] }, ...staff.uniques] }],
      },
      NAME,
    );
    expect(unnamed.statements[0]).toBe('ALTER TABLE ANN.STAFF DROP CONSTRAINT "" RESTRICT;');
  });

  it("writes the script the live tests run, of a model that keeps every table it references [DESIGN] D47", () => {
    const live = model();
    const staff = modelTable(STAFF);
    const desired: Model = {
      ...live,
      tables: [
        modelTable(DEPT),
        {
          ...staff,
          columns: [
            { name: "ID", type: "BIGINT", notNull: true, default: null },
            { name: "DEPT", type: "INTEGER", notNull: true, default: "1" },
            { name: "NOTE", type: "VARCHAR(40)", notNull: false, default: null },
          ],
          uniques: [],
          checks: [{ name: "STAFF_NOTE", condition: "NOTE <> ''" }],
          indexes: [{ name: "STAFF_BY_NOTE", columns: ["NOTE"], method: "hash" }],
        },
      ],
    };
    expect(migration(desired, live, NAME).statements).toEqual([
      "DROP INDEX STAFF_BY_DEPT;",
      "ALTER TABLE ANN.STAFF DROP CONSTRAINT STAFF_UNIQUE1 RESTRICT;",
      "ALTER TABLE ANN.STAFF DROP CONSTRAINT STAFF_AGE RESTRICT;",
      "ALTER TABLE ANN.STAFF ALTER COLUMN ID SET DATA TYPE BIGINT;",
      "ALTER TABLE ANN.STAFF ALTER COLUMN DEPT SET DEFAULT 1;",
      "ALTER TABLE ANN.STAFF ALTER COLUMN DEPT SET NOT NULL;",
      "ALTER TABLE ANN.STAFF ADD COLUMN NOTE VARCHAR(40);",
      "ALTER TABLE ANN.STAFF DROP COLUMN AGE RESTRICT;",
      "ALTER TABLE ANN.STAFF ADD CONSTRAINT STAFF_NOTE CHECK (NOTE <> '');",
      "CREATE INDEX STAFF_BY_NOTE ON ANN.STAFF (NOTE) USING hash;",
    ]);
  });

  it("makes a table of no primary key, lets NOT NULL go, and writes no rule of NO ACTION [DOC sql/statements/alter-table.md SYNOPSIS]", () => {
    const staff = modelTable(STAFF);
    const keyless = { ...staff, primaryKey: null, uniques: [], checks: [], foreignKeys: [], indexes: [] };
    expect(createSql(keyless, NAME)).toBe(
      "CREATE TABLE ANN.STAFF (\n    ID INTEGER NOT NULL,\n    DEPT INTEGER,\n    AGE INTEGER\n);",
    );
    const loose = { ...keyless, columns: keyless.columns.map((c) => ({ ...c, notNull: false })) };
    const plain = { ...must(staff.foreignKeys[0]), onDelete: "NO ACTION" };
    const found = migration(
      { name: "m", tables: [modelTable(DEPT), { ...loose, foreignKeys: [plain] }], graphs: [] },
      { name: "m", tables: [modelTable(DEPT), keyless], graphs: [] },
      NAME,
    );
    expect(found.statements).toEqual([
      "ALTER TABLE ANN.STAFF ALTER COLUMN ID DROP NOT NULL;",
      "ALTER TABLE ANN.STAFF ADD CONSTRAINT STAFF_DEPT FOREIGN KEY (DEPT) REFERENCES ANN.DEPT (ID);",
    ]);
    expect(found.differences.map((d) => d.what)).toContain("column ID is not NOT NULL");
  });

  it("takes a type the same as its standard name, and one of no length the same as one of a length [DESIGN] D47", () => {
    expect(sameType("varchar (40)", "CHARACTER VARYING(40)")).toBe(true);
    expect(sameType("CLOB(1M)", "CHARACTER LARGE OBJECT")).toBe(true);
    expect(sameType("INT", "INTEGER")).toBe(true);
    expect(sameType("DOUBLE", "DOUBLE PRECISION")).toBe(true);
    expect(sameType("VARCHAR(40)", "VARCHAR(20)")).toBe(false);
    expect(sameType("INTEGER", "BIGINT")).toBe(false);
  });
});

describe("a model's file in the manual", () => {
  it("is a model Studio reads [DESIGN] D46", () => {
    const page = FILES_PAGE;
    const block = page.split("## A model's file\n")[1]?.split("```json\n")[1]?.split("\n```")[0] ?? "";
    const read = parseModel(block);
    expect(read.tables.map((t) => t.name)).toEqual(["DEPT", "STAFF"]);
    expect(modelText(read)).toBe(`${block}\n`);
  });
});
