import type { Column, TableDetail } from "../../ipc/catalog";
import type { KeyWordCase } from "../../ipc/preferences";
import { must } from "../../test/catalog";
import { SNIPPETS } from "../editor/snippets";
import { contextAt, statementStart } from "./context";
import { type CompletionCatalog, complete, inCase, type ScopeSource, sourceNamed } from "./engine";
import { builtIns } from "./functions";
import { wordScope } from "./words";

/** A column of the fixed catalog. */
function col(name: string, typeWritten = "INTEGER", extra: Partial<Column> = {}): Column {
  return {
    name,
    position: 1,
    typeWritten,
    default: null,
    nullable: true,
    identity: null,
    generated: null,
    domain: null,
    ...extra,
  };
}

/** A table of the fixed catalog. */
function table(
  schema: string,
  name: string,
  columns: Column[],
  constraints: TableDetail["constraints"] = [],
): TableDetail {
  return {
    schema,
    name,
    kind: "BASE TABLE",
    columns,
    constraints,
    indexes: [],
    triggers: [],
    privileges: [],
    view: null,
    partitioning: null,
    partitionOf: null,
  };
}

const TABLES: TableDetail[] = [
  table(
    "ANN",
    "STAFF",
    [
      col("ID", "INTEGER", { identity: "ALWAYS", nullable: false }),
      col("NAME", "CHARACTER VARYING(20)"),
      col("DEPT_ID"),
      col("VALUE"),
    ],
    [
      {
        name: "STAFF_DEPT",
        kind: "FOREIGN KEY",
        columns: ["DEPT_ID"],
        check: null,
        deferrable: false,
        references: {
          schema: "ANN",
          table: "DEPT",
          columns: ["ID"],
          matching: "NONE",
          onUpdate: "NO ACTION",
          onDelete: "NO ACTION",
        },
      },
    ],
  ),
  table("ANN", "DEPT", [col("ID"), col("NAME", "CHARACTER VARYING(20)")]),
  table("ANN", "lower", [col("x", "DATE")]),
  table("BOB", "LEDGER", [col("AMOUNT", "DECIMAL(9,2)")]),
];

/** The fixed catalog: ANN's tables, a view, a sequence and a routine; BOB's ledger. */
function fixed(keyWords: KeyWordCase = "upper", recent: Record<string, number> = {}): CompletionCatalog {
  return {
    defaultSchema: "ANN",
    reserved: [
      "SELECT",
      "FROM",
      "WHERE",
      "JOIN",
      "ON",
      "AS",
      "INSERT",
      "INTO",
      "VALUES",
      "VALUE",
      "AND",
      "OR",
      "NOT",
      "NULL",
      "CASE",
      "WHEN",
      "GROUP",
      "ORDER",
      "BY",
      "UPDATE",
      "DELETE",
      "CREATE",
      "TABLE",
      "INTEGER",
      "INNER",
      "LEFT",
      "CAST",
      "COUNT",
      "SET",
      "WITH",
      "NEXT",
      "FOR",
      "COMMIT",
    ],
    keyWords,
    schemas: () => ["ANN", "BOB"],
    objects: (s) =>
      s === "ANN"
        ? [
            { name: "STAFF", kind: "table" },
            { name: "DEPT", kind: "table" },
            { name: "lower", kind: "table" },
            { name: "PAYROLL", kind: "view" },
            { name: "ORDER_NO", kind: "sequence" },
          ]
        : [{ name: "LEDGER", kind: "table" }],
    routines: (s) => (s === "ANN" ? [{ name: "DOUBLED", specific: "DOUBLED_1", kind: "FUNCTION" }] : []),
    table: (s, name) => Promise.resolve(TABLES.find((t) => t.name === name && t.schema === (s ?? "ANN")) ?? null),
    signature: () => Promise.resolve("DOUBLED(IN N INTEGER) RETURNS INTEGER"),
    builtIns: builtIns(),
    snippets: SNIPPETS,
    recent: (label) => recent[label] ?? 0,
  };
}

/** The labels offered at `|` in `text`, the statement's sources read by its words or given. */
async function offered(
  marked: string,
  catalog = fixed(),
  sources?: ScopeSource[],
): Promise<{ from: number; labels: string[] }> {
  const cursor = marked.indexOf("|");
  const text = marked.replace("|", "");
  const start = statementStart(text, cursor);
  const offer = await complete(contextAt(text, cursor), sources ?? wordScope(text.slice(start)), catalog);
  const labels = [...offer.items].sort((a, b) => b.boost - a.boost).map((i) => i.label);
  return { from: offer.from, labels };
}

describe("completion's places", () => {
  it("at a statement's start offers the words that begin one, and the snippets [DESIGN] D40", async () => {
    const { labels } = await offered("|");
    expect(labels).toEqual(expect.arrayContaining(["SELECT", "INSERT", "CREATE", "COMMIT", "sel", "ins"]));
    expect(labels).not.toContain("STAFF");
    expect(labels).not.toContain("WHERE");
    expect((await offered("VALUES (1); sel|")).from).toBe(12);
  });

  it("after FROM offers the session's schema's tables and views, the schemas, and the statement's common tables [DESIGN] D40", async () => {
    const { labels } = await offered("SELECT * FROM |");
    expect(labels).toEqual(expect.arrayContaining(["STAFF", "DEPT", '"lower"', "PAYROLL", "ANN", "BOB"]));
    expect(labels).not.toContain("ORDER_NO");
    expect((await offered("WITH T AS (VALUES (1)) SELECT * FROM |")).labels).toContain("T");
    expect((await offered("SELECT * FROM STAFF, |")).labels).toContain("DEPT");
    expect((await offered("SELECT NEXT VALUE FOR |")).labels.slice(0, 1)).toEqual(["ORDER_NO"]);
    expect((await offered("CREATE TABLE |")).labels).not.toContain("STAFF");
  });

  it("after a schema and a period offers its objects and routines; after a table or alias, its columns [DESIGN] D40", async () => {
    expect((await offered("SELECT * FROM BOB.|")).labels).toEqual(["LEDGER"]);
    expect((await offered("SELECT * FROM ANN.|")).labels).toEqual(expect.arrayContaining(["STAFF", "DOUBLED"]));
    expect((await offered("SELECT s.| FROM STAFF s")).labels).toEqual(["ID", "NAME", "DEPT_ID", '"VALUE"']);
    expect((await offered("SELECT STAFF.N| FROM STAFF")).labels).toContain("NAME");
    expect((await offered("SELECT l.| FROM BOB.LEDGER l")).labels).toEqual(["AMOUNT"]);
    expect((await offered("SELECT BOB.LEDGER.| FROM BOB.LEDGER")).labels).toEqual(["AMOUNT"]);
    expect((await offered('SELECT "l".| FROM "lower" AS "l"')).labels).toEqual(['"x"']);
    expect((await offered("SELECT q.| FROM STAFF s")).labels).toEqual([]);
  });

  it("in an expression offers the scope's columns, qualified where two tables have one name, the routines and the words [DESIGN] D40", async () => {
    const { labels } = await offered("SELECT | FROM STAFF s JOIN DEPT d ON s.DEPT_ID = d.ID");
    expect(labels).toEqual(
      expect.arrayContaining([
        "S.ID",
        "D.ID",
        "S.NAME",
        "D.NAME",
        "DEPT_ID",
        '"VALUE"',
        "COUNT",
        "DOUBLED",
        "CASE",
        "FROM",
      ]),
    );
    expect(labels).not.toContain("ID");
    expect(labels.indexOf("DEPT_ID")).toBeLessThan(labels.indexOf("COUNT"));
    expect((await offered("SELECT * FROM STAFF WHERE |")).labels).toEqual(
      expect.arrayContaining(["NAME", "GROUP", "ORDER", "AND"]),
    );
  });

  it("of common table expressions and derived tables, offers the columns they name [DESIGN] D40", async () => {
    const cte = await offered("WITH T(A, B) AS (SELECT 1, 2) SELECT T.| FROM T");
    expect(cte.labels).toEqual(["A", "B"]);
    const parsed: ScopeSource[] = [
      { kind: "cte", schema: null, name: "T", alias: null, columns: ["A", "B"], outer: true },
      { kind: "cte", schema: null, name: "T", alias: null, columns: null, outer: true },
      { kind: "derived", schema: null, name: null, alias: "D", columns: ["X"], outer: true },
    ];
    const { labels } = await offered(
      "WITH T(A, B) AS (SELECT 1, 2) SELECT | FROM T, (SELECT 1 AS X) D",
      fixed(),
      parsed,
    );
    expect(labels).toEqual(expect.arrayContaining(["A", "B", "X"]));
    expect(labels.filter((l) => l === "A")).toHaveLength(1);
    expect((await offered("SELECT D.| FROM (SELECT 1 AS X) AS D", fixed(), [must(parsed[2])])).labels).toEqual(["X"]);
    expect(wordScope("SELECT * FROM (SELECT 1) AS D").at(-1)).toMatchObject({ kind: "derived", alias: "D" });
  });

  it("after JOIN … ON offers the conditions the foreign keys imply [DESIGN] D40", async () => {
    const { labels } = await offered("SELECT * FROM STAFF s JOIN DEPT d ON |");
    expect(labels[0]).toBe("S.DEPT_ID = D.ID");
    expect((await offered("SELECT * FROM DEPT d JOIN STAFF s ON |")).labels[0]).toBe("S.DEPT_ID = D.ID");
    expect((await offered("SELECT * FROM DEPT d JOIN NOPE n ON |")).labels.some((l) => l.includes("="))).toBe(false);
  });

  it("inside INSERT INTO t ( offers its columns that take a value, whole, and each [DESIGN] D40", async () => {
    const { labels } = await offered("INSERT INTO STAFF (|");
    expect(labels[0]).toBe('NAME, DEPT_ID, "VALUE"');
    expect(labels).toContain("ID");
    expect((await offered("INSERT INTO BOB.LEDGER (|")).labels[0]).toBe("AMOUNT");
    expect((await offered("INSERT INTO NOPE (|")).labels).toEqual([]);
  });

  it("after SELECT * offers the star written as its columns [DESIGN] D40", async () => {
    const offer = await offered("SELECT *| FROM STAFF");
    expect(offer).toEqual({ from: 7, labels: ['ID, NAME, DEPT_ID, "VALUE"'] });
    expect((await offered("SELECT *| FROM NOPE")).labels).toEqual([]);
  });

  it("offers nothing in a string, a delimited name being written or a comment, and types after CAST's AS [DESIGN] D40", async () => {
    for (const text of ["SELECT 'sta|", 'SELECT "sta|', "SELECT 1 -- sta|", "SELECT /* sta|"]) {
      expect((await offered(text)).labels, text).toEqual([]);
    }
    expect((await offered("SELECT 'a' |")).labels.length).toBeGreaterThan(0);
    expect((await offered("SELECT /* a */ |")).labels.length).toBeGreaterThan(0);
    expect((await offered("SELECT CAST(x AS |")).labels).toContain("INTEGER");
    expect((await offered("SELECT * FROM STAFF |")).labels).toEqual(
      expect.arrayContaining(["JOIN", "WHERE", "AS", "INNER"]),
    );
  });

  it("writes key words in the formatter's case, and ranks what was chosen before first [DESIGN] D40", async () => {
    expect((await offered("|", fixed("lower"))).labels).toContain("select");
    expect(inCase("Select", "keep")).toBe("SELECT");
    const ranked = await offered("SELECT * FROM |", fixed("upper", { DEPT: 5 }));
    expect(ranked.labels[0]).toBe("DEPT");
    expect(sourceNamed([], ["X", "Y"])).toMatchObject({ schema: "X", name: "Y" });
  });

  it("knows the manual's built-in functions, each with its signature and where the manual says so [DOC sql/04-expressions.md String expressions]", () => {
    const upper = builtIns().find((f) => f.name === "UPPER");
    expect(upper).toMatchObject({
      signature: "UPPER(s)",
      page: "sql/04-expressions.md",
      heading: "String expressions",
    });
    expect(builtIns().some((f) => f.name === "COALESCE")).toBe(true);
    expect(
      builtIns("# a header\nsql/x.md\tH\tF(a)\tv\nsql/x.md\tH\tF(a)\tv\n\tH\tnone\t\n").map((f) => f.name),
    ).toEqual(["F", "COALESCE", "NULLIF", "GREATEST", "LEAST", "UUID_V4", "UUID_V7", "CAST"]);
  });

  it("tells each column's type, nullability, default and table in its popup, and reads each place's edge [DESIGN] D40", async () => {
    const catalog = fixed();
    const offer = await complete(contextAt("SELECT s. FROM STAFF s", 9), wordScope("SELECT s. FROM STAFF s"), catalog);
    const id = offer.items.find((i) => i.label === "ID");
    expect(id).toMatchObject({ detail: "INTEGER", info: "INTEGER NOT NULL, of ANN.STAFF" });
    const withDefault: Column = col("N", "INTEGER", { default: "0" });
    const one = { ...catalog, table: () => Promise.resolve(table("ANN", "ONE", [withDefault])) };
    expect(
      (await complete(contextAt("SELECT o. FROM ONE o", 9), wordScope("SELECT o. FROM ONE o"), one)).items[0]?.info,
    ).toBe("INTEGER, DEFAULT 0, of ANN.ONE");
    expect((await offered("SELECT * FROM T WHERE A FOR |")).labels).toContain("CASE");
    expect((await offered("SELECT * FROM T WHERE A = 1 AND B ON |")).labels).toContain("CASE");
    expect((await offered("SELECT CAST(x |")).labels).toContain("CASE");
    expect((await offered("SELECT (a AS |")).labels).toContain("CASE");
    expect((await offered("UPDATE STAFF SET |")).labels).toEqual(expect.arrayContaining(["NAME", "WHERE"]));
    expect((await offered("DELETE FROM STAFF WHERE |")).labels).toContain("NAME");
  });

  it("reads a common table of no columns written by the one that names them, and a derived table of none as none [DESIGN] D40", async () => {
    const sources: ScopeSource[] = [
      { kind: "cte", schema: null, name: "T", alias: "X", columns: null, outer: true },
      { kind: "derived", schema: null, name: null, alias: "D", columns: null, outer: true },
      { kind: "table", schema: null, name: null, alias: "N", columns: null, outer: true },
    ];
    expect((await offered("SELECT X.| FROM T X", fixed(), sources)).labels).toEqual([]);
    expect((await offered("SELECT D.| FROM T X", fixed(), sources)).labels).toEqual([]);
    expect((await offered("SELECT N.| FROM T X", fixed(), sources)).labels).toEqual([]);
    expect((await offered("SELECT * FROM T X JOIN N ON |", fixed(), sources)).labels).toEqual([]);
  });
});
