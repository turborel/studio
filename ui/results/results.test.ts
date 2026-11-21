import { CompactSelection } from "@glideapps/glide-data-grid";
import type { ColumnInfo } from "../ipc/connections";
import type { Timing } from "../state/worksheets";
import { decimal, decimalText, summary, summaryText } from "./aggregate";
import { insertTable } from "./actions";
import { compare } from "./compare";
import { COPY_FORMATS, copied, csvField } from "./copy";
import { delimited, literal, numeric, typeKind } from "./literals";
import { derivedNames, narrowed, nextSort, plain, sortable, valueCondition, wrapped } from "./requery";
import { changeText, comparedTimings, timeOf } from "./runTimes";
import { allOf, chosenOf } from "./selection";
import { MAX_TEXT_WIDTH, resultText } from "./text";

/** A column of `type`, named `name`. */
function col(name: string | null, type = "INTEGER"): ColumnInfo {
  return { name, typeWritten: type, typeName: null, notNull: false };
}

const COLUMNS = [col("ID"), col("NAME", "CHARACTER VARYING(20)"), col("PRICE", "DECIMAL(9,2)")];
const ROWS = [
  ["1", "Ada, Countess", "10.50"],
  ["2", 'say "hi"', null],
  ["3", "", "-0.25"],
];

describe("a result's values as SQL", () => {
  it("knows each type's kind by its first words, and writes each value as a literal of it [DESIGN] D39", () => {
    expect(
      [
        "INTEGER",
        "DECIMAL(9,2)",
        "DOUBLE PRECISION",
        "BOOLEAN",
        "CHARACTER(3)",
        "VARBINARY(4)",
        "CLOB(1M)",
        "DATE",
      ].map((t) => typeKind(col("X", t))),
    ).toEqual(["exact", "exact", "approximate", "boolean", "character", "binary", "lob", "other"]);
    expect(numeric(col("X", "REAL"))).toBe(true);
    expect(numeric(col("X", "DATE"))).toBe(false);
    expect(literal(null, col("X"))).toBe("NULL");
    expect(literal("12.5", col("X", "NUMERIC(4,1)"))).toBe("12.5");
    expect(literal("Infinity", col("X", "DECFLOAT"))).toBe("CAST('Infinity' AS DECFLOAT)");
    expect(literal("true", col("X", "BOOLEAN"))).toBe("TRUE");
    expect(literal("FALSE", col("X", "BOOLEAN"))).toBe("FALSE");
    expect(literal("it's", col("X", "VARCHAR(9)"))).toBe("'it''s'");
    expect(literal("DEADBEEF", col("X", "BINARY(4)"))).toBe("X'DEADBEEF'");
    expect(literal("<BINARY LARGE OBJECT of 9 octets>", col("X", "VARBINARY(9)"))).toBeNull();
    expect(literal("x", col("X", "BLOB(1M)"))).toBeNull();
    expect(literal("2024-01-02", col("X", "DATE"))).toBe("CAST('2024-01-02' AS DATE)");
    expect(delimited('a"b')).toBe('"a""b"');
  });
});

describe("sorting and filtering a result", () => {
  it("runs a query within one that sorts and filters it, its columns named by their names or places [DESIGN] D39", () => {
    expect(
      ["SELECT 1", " -- a\n/* b */ values (1)", "(TABLE T)", "WITH W AS (VALUES 1) SELECT * FROM W", "TABLE T"].every(
        sortable,
      ),
    ).toBe(true);
    expect(["EXPLAIN SELECT 1", "INSERT INTO T VALUES (1)", "CALL P()"].some(sortable)).toBe(false);
    expect(derivedNames([col("A"), col(null), col("B"), col("B")])).toEqual(["A", "2", "3", "4"]);
    const q = { sql: "SELECT * FROM T -- the rows", sort: [], filter: "" };
    expect(plain(q)).toBe(true);
    expect(wrapped(q, COLUMNS)).toBe(q.sql);
    expect(
      wrapped(
        {
          ...q,
          sort: [
            { column: 1, descending: true },
            { column: 0, descending: false },
          ],
          filter: " ID > 1 ",
        },
        COLUMNS,
      ),
    ).toBe(
      'SELECT * FROM (\nSELECT * FROM T -- the rows\n) AS "Q" ("ID", "NAME", "PRICE")\nWHERE ID > 1\nORDER BY "NAME" DESC, "ID"',
    );
    expect(wrapped({ ...q, filter: "ID = 2" }, COLUMNS)).toBe(
      'SELECT * FROM (\nSELECT * FROM T -- the rows\n) AS "Q" ("ID", "NAME", "PRICE")\nWHERE ID = 2',
    );
    expect(wrapped({ ...q, sort: [{ column: 9, descending: false }] }, COLUMNS)).toContain('ORDER BY "10"');
  });

  it("sorts by a header ascending, then descending, then not; with Shift by several [DESIGN] D39", () => {
    expect(nextSort([], 1, false)).toEqual([{ column: 1, descending: false }]);
    expect(nextSort([{ column: 1, descending: false }], 1, false)).toEqual([{ column: 1, descending: true }]);
    expect(nextSort([{ column: 1, descending: true }], 1, false)).toEqual([]);
    expect(nextSort([{ column: 1, descending: false }], 2, false)).toEqual([{ column: 2, descending: false }]);
    const two = nextSort([{ column: 1, descending: false }], 2, true);
    expect(two).toEqual([
      { column: 1, descending: false },
      { column: 2, descending: false },
    ]);
    expect(nextSort(two, 1, true)).toEqual([
      { column: 1, descending: true },
      { column: 2, descending: false },
    ]);
    expect(
      nextSort(
        [
          { column: 1, descending: true },
          { column: 2, descending: false },
        ],
        1,
        true,
      ),
    ).toEqual([{ column: 2, descending: false }]);
  });

  it("filters to a cell's value, or out, a null by IS NULL, a large object not at all [DESIGN] D39", () => {
    expect(valueCondition(COLUMNS, 1, "Ada", false)).toBe(`"NAME" = 'Ada'`);
    expect(valueCondition(COLUMNS, 2, "10.50", true)).toBe('("PRICE" <> 10.50 OR "PRICE" IS NULL)');
    expect(valueCondition(COLUMNS, 2, null, false)).toBe('"PRICE" IS NULL');
    expect(valueCondition(COLUMNS, 2, null, true)).toBe('"PRICE" IS NOT NULL');
    expect(valueCondition([col("B", "CLOB(1M)")], 0, "x", false)).toBeNull();
    expect(valueCondition(COLUMNS, 7, "x", false)).toBeNull();
    expect(narrowed("", "A = 1")).toBe("A = 1");
    expect(narrowed("B = 2 OR C = 3", "A = 1")).toBe("(B = 2 OR C = 3) AND A = 1");
  });
});

describe("copying a result's cells", () => {
  const cells = { columns: COLUMNS, rows: ROWS };
  const options = { headers: true, table: '"ANN"."ITEMS"' };

  it("writes CSV as the export does, and tab-separated values, with headers or not [DESIGN] D39", () => {
    expect(csvField(" pad")).toBe('" pad"');
    expect(copied("csv", cells, options)).toBe(
      'ID,NAME,PRICE\r\n1,"Ada, Countess",10.50\r\n2,"say ""hi""",\r\n3,"",-0.25\r\n',
    );
    expect(copied("tsv", cells, { ...options, headers: false })).toBe(
      '1\tAda, Countess\t10.50\r\n2\t"say ""hi"""\t\r\n3\t\t-0.25\r\n',
    );
  });

  it("writes JSON with numbers and truth values as JSON's, each row an object [DESIGN] D39", () => {
    const json = copied(
      "json",
      {
        columns: [...COLUMNS, col("OK", "BOOLEAN"), col("DOC", "JSON"), col(null, "DATE")],
        rows: [[...(ROWS[0] ?? []), "TRUE", '{"a":[1]}', "2024-01-02"]],
      },
      options,
    );
    expect(json).toBe(
      '[\n  {"ID": 1, "NAME": "Ada, Countess", "PRICE": 10.50, "OK": true, "DOC": {"a":[1]}, "6": "2024-01-02"}\n]\n',
    );
    expect(JSON.parse(json)).toHaveLength(1);
    expect(copied("json", { columns: COLUMNS, rows: [] }, options)).toBe("[]\n");
    expect(copied("json", { columns: [col("D", "DECFLOAT"), col("N")], rows: [["NaN", null]] }, options)).toContain(
      '"D": "NaN", "N": null',
    );
  });

  it("copies a number of 38 digits as its text in every format, never through a float [DESIGN] D39 [DOC sql/02-data-types.md Numbers]", () => {
    const wide = "-1234567890123456789012345678.0123456789";
    const of = { columns: [col("N", "DECIMAL(38,10)")], rows: [[wide]] };
    for (const [format] of COPY_FORMATS) {
      expect(copied(format, of, options)).toContain(wide);
    }
    expect(copied("json", of, options)).toContain(`"N": ${wide}`);
  });

  it("writes a Markdown table, its bars escaped, and INSERT statements of literals [DESIGN] D39", () => {
    expect(copied("markdown", { columns: [col("A|B")], rows: [["x|y\nz"], [null]] }, options)).toBe(
      "| A\\|B |\n|---|\n| x\\|y z |\n| NULL |\n",
    );
    expect(copied("markdown", { columns: [col("A")], rows: [] }, { ...options, headers: false })).toBe(
      "| 1 |\n|---|\n",
    );
    expect(copied("insert", cells, options)).toBe(
      `INSERT INTO "ANN"."ITEMS" ("ID", "NAME", "PRICE") VALUES (1, 'Ada, Countess', 10.50);\n` +
        `INSERT INTO "ANN"."ITEMS" ("ID", "NAME", "PRICE") VALUES (2, 'say "hi"', NULL);\n` +
        `INSERT INTO "ANN"."ITEMS" ("ID", "NAME", "PRICE") VALUES (3, '', -0.25);\n`,
    );
    expect(() => copied("insert", { columns: [col("B", "BLOB(1M)")], rows: [["x"]] }, options)).toThrow(
      "A large object is not copied",
    );
    expect(() => copied("json", { columns: [], rows: [["x"]] }, options)).toThrow("more cells");
    expect(insertTable("SELECT * FROM ANN.ITEMS WHERE ID > 1")).toBe('"ANN"."ITEMS"');
    expect(insertTable("SELECT * FROM ITEMS")).toBe('"ITEMS"');
    expect(insertTable("SELECT * FROM A, B")).toBe("RESULT");
    expect(insertTable("VALUES (1)")).toBe("RESULT");
  });
});

describe("what the status bar tells of the cells selected", () => {
  it("sums exact numbers exactly, as decimals, and averages them [RULE] R-NUM-1 [DESIGN] D39", () => {
    expect(decimal("-12.340")).toEqual({ units: -12340n, scale: 3 });
    expect(decimal(".5")).toEqual({ units: 5n, scale: 1 });
    expect(decimal("x")).toBeNull();
    expect(decimal("-")).toBeNull();
    expect(decimalText({ units: -5n, scale: 3 })).toBe("-0.005");
    const exact = col("P", "DECIMAL(38,2)");
    const s = summary([
      ["12345678901234567890.10", exact],
      ["0.20", exact],
      [null, exact],
      ["-1", exact],
    ]);
    expect(s).toEqual({
      cells: 4,
      count: 3,
      sum: "12345678901234567889.30",
      average: "4115226300411522629.76666667",
      minimum: "-1",
      maximum: "12345678901234567890.10",
      approximate: false,
    });
    expect(
      summary([
        ["1", col("N")],
        ["2", col("N")],
      ]).average,
    ).toBe("1.5");
    expect(
      summary([
        ["-1", col("N")],
        ["-2", col("N")],
      ]).average,
    ).toBe("-1.5");
    expect(
      summary([
        ["4", col("N")],
        ["2", col("N")],
      ]).average,
    ).toBe("3");
  });

  it("sums numbers of 38 digits exactly, never through a float [DESIGN] D39 [DOC sql/02-data-types.md Numbers]", () => {
    const wide = col("N", "NUMERIC(38,0)");
    const largest = "99999999999999999999999999999999999999";
    const s = summary([
      [largest, wide],
      ["1", wide],
      [`-${largest}`, wide],
    ]);
    expect([s.sum, s.minimum, s.maximum]).toEqual(["1", `-${largest}`, largest]);
    expect(
      summary([
        [largest, wide],
        [largest, wide],
      ]).sum,
    ).toBe("199999999999999999999999999999999999998");
    expect(
      summary([
        [`0.${"1".repeat(37)}`, col("D", "DECIMAL(38,37)")],
        ["0.0000000000000000000000000000000000001", col("D", "DECIMAL(38,37)")],
      ]).sum,
    ).toBe(`0.${"1".repeat(36)}2`);
  });

  it("sums approximate numbers as floats, and of other values counts alone [DESIGN] D39", () => {
    expect(
      summary([
        ["1.5E0", col("F", "DOUBLE PRECISION")],
        ["2", col("N")],
      ]),
    ).toMatchObject({ sum: "3.5", average: "1.75", minimum: "1.5", maximum: "2", approximate: true });
    expect(
      summaryText(
        summary([
          ["1.5E0", col("F", "DOUBLE PRECISION")],
          ["2", col("N")],
        ]),
      ),
    ).toBe("Count 2 of 2 · Sum ≈3.5 · Average ≈1.75 · Min ≈1.5 · Max ≈2");
    expect(
      summary([
        ["NaN", col("F", "REAL")],
        ["x", col("F", "REAL")],
      ]).sum,
    ).toBeNull();
    expect(
      summary([
        ["a", col("S", "VARCHAR(4)")],
        [null, col("S", "VARCHAR(4)")],
      ]),
    ).toMatchObject({ cells: 2, count: 1, sum: null, approximate: false });
    expect(summary([[null, col("N")]]).sum).toBeNull();
    expect(summary([["x", col("N")]]).sum).toBeNull();
    expect(
      summaryText(
        summary([
          ["1", col("N")],
          ["2", col("N")],
        ]),
      ),
    ).toBe("Count 2 of 2 · Sum 3 · Average 1.5 · Min 1 · Max 2");
    expect(summaryText(summary([["a", col("S", "CHAR(1)")]]))).toBe("Count 1 of 1");
  });
});

describe("a result's other forms", () => {
  it("writes the rows as text, numbers to the right, a long value cut [DESIGN] D39", () => {
    const text = resultText(COLUMNS, [...ROWS, ["10", "x".repeat(MAX_TEXT_WIDTH + 5), "1.00"]]);
    const lines = text.split("\n");
    expect(lines[0]).toBe(` ID | NAME${" ".repeat(MAX_TEXT_WIDTH - 4)} | PRICE`);
    expect(lines[1]).toBe(`----+${"-".repeat(MAX_TEXT_WIDTH + 2)}+-------`);
    expect(lines[3]).toBe(`  2 | say "hi"${" ".repeat(MAX_TEXT_WIDTH - 8)} |  NULL`);
    expect(lines[5]).toContain(`${"x".repeat(MAX_TEXT_WIDTH - 1)}…`);
    expect(lines.at(-1)).toBe("(4 rows)");
    expect(resultText([col(null)], [["1"]]).split("\n")).toEqual([" 1", "---", " 1", "(1 row)"]);
  });

  it("compares two results row by row, each row matched as often as it is in both [DESIGN] D39", () => {
    const left = { columns: COLUMNS, rows: [["1"], ["1"], ["2"], [null]] };
    const right = { columns: COLUMNS, rows: [["1"], ["3"], ["NULL"]] };
    const found = compare(left, right);
    expect(found).toMatchObject({ sameColumns: true, both: 1, left: 3, right: 2 });
    expect(found.rows.map((r) => [r.side, r.cells[0]])).toEqual([
      ["both", "1"],
      ["left", "1"],
      ["left", "2"],
      ["left", null],
      ["right", "3"],
      ["right", "NULL"],
    ]);
    expect(compare(left, { columns: [col("ID", "BIGINT")], rows: [] }).sameColumns).toBe(false);
    expect(compare(left, { columns: [col("X")], rows: [] }).sameColumns).toBe(false);
  });

  it("chooses the cells of rows, of columns, or of a range [DESIGN] D39", () => {
    const none = { columns: CompactSelection.empty(), rows: CompactSelection.empty() };
    expect(chosenOf(none, 3, 2)).toBeNull();
    expect(chosenOf({ ...none, rows: CompactSelection.fromSingleSelection([1, 5]) }, 3, 2)).toEqual({
      rows: [1, 2],
      columns: [0, 1],
    });
    expect(chosenOf({ ...none, columns: CompactSelection.fromSingleSelection(1) }, 3, 2)).toEqual({
      rows: [0, 1, 2],
      columns: [1],
    });
    const range = { cell: [0, 1] as const, range: { x: 0, y: 1, width: 4, height: 9 }, rangeStack: [] };
    expect(chosenOf({ ...none, current: { ...range, cell: [0, 1] } }, 3, 2)).toEqual({ rows: [1, 2], columns: [0, 1] });
    expect(allOf(2, 1)).toEqual({ rows: [0, 1], columns: [0] });
  });

  it("compares each run's time with the run before of the same statement and connection [DESIGN] D39", () => {
    const t = (sql: string, millis: number, extra: Partial<Timing> = {}): Timing => ({
      sql,
      connection: 1,
      at: millis,
      millis,
      serverMicros: null,
      rows: 1,
      failed: false,
      ...extra,
    });
    const found = comparedTimings([
      t("A", 100),
      t("B", 50),
      t("A", 150),
      t("A", 75, { serverMicros: 50_000 }),
      t("A", 10, { failed: true }),
      t("A", 10, { connection: 2 }),
      t("Z", 0),
      t("Z", 5),
    ]);
    expect(found.map((f) => [f.timing.sql, f.change])).toEqual([
      ["Z", null],
      ["Z", null],
      ["A", null],
      ["A", null],
      ["A", -0.6666666666666667],
      ["A", 0.5],
      ["B", null],
      ["A", null],
    ]);
    expect(timeOf(t("A", 9, { serverMicros: 2000 }))).toBe(2);
    expect([0.5, -0.25, 0.001, null].map(changeText)).toEqual(["50% slower", "25% faster", "the same", ""]);
  });
});
