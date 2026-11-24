import worksheets from "../../doc/user/05-worksheets.md?raw";
import { DEFAULT_SETTINGS } from "../ipc/preferences";
import { formatWords } from "./dialect";
import { type FormatOptions, formatSql } from "./format";

const WORDS = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "AND",
  "OR",
  "IN",
  "AS",
  "GROUP",
  "BY",
  "ORDER",
  "JOIN",
  "ON",
  "LEFT",
  "INSERT",
  "INTO",
  "VALUES",
  "COUNT",
  "NOT",
  "NULL",
  "IS",
  "UPDATE",
  "SET",
]);
const OPTIONS: FormatOptions = { keyWords: "upper", indent: 4, lineWidth: 60, words: WORDS };

describe("the formatter", () => {
  it("writes LATERAL in the key words' case, its derived table's query indented [DESIGN] D36", () => {
    const words = formatWords(["SELECT", "FROM", "WHERE", "AS", "COUNT"]);
    expect(
      formatSql(
        "select s.name, t.n from staff s, lateral (select count(*) as n from dept d where d.id = s.dept) as t",
        { ...OPTIONS, words },
      ),
    ).toBe(
      [
        "SELECT s.name, t.n",
        "FROM staff s, LATERAL (",
        "    SELECT COUNT(*) AS n",
        "    FROM dept d",
        "    WHERE d.id = s.dept",
        ") AS t",
        "",
      ].join("\n"),
    );
  });

  it("begins each clause on a line, a condition's AND and OR indented [DESIGN] D36", () => {
    expect(
      formatSql(
        "select name, count(*) as n from staff s left join dept d on s.dept = d.id where s.age > 30 and d.name is not null group by name order by n",
        OPTIONS,
      ),
    ).toBe(
      [
        "SELECT name, COUNT(*) AS n",
        "FROM staff s",
        "LEFT JOIN dept d",
        "    ON s.dept = d.id",
        "WHERE s.age > 30",
        "    AND d.name IS NOT NULL",
        "GROUP BY name",
        "ORDER BY n",
        "",
      ].join("\n"),
    );
  });

  it("indents a subquery, keeps strings, identifiers and comments, and ends each statement [DESIGN] D36", () => {
    const text =
      "SELECT \"select\", 'from where' FROM T WHERE A IN (select b from u) -- a note\n; insert into t values (1, 'x')";
    expect(formatSql(text, OPTIONS)).toBe(
      [
        "SELECT \"select\", 'from where'",
        "FROM T",
        "WHERE A IN (",
        "    SELECT b",
        "    FROM u",
        ") -- a note",
        "    ;",
        "",
        "INSERT INTO t",
        "VALUES (1, 'x')",
        "",
      ].join("\n"),
    );
  });

  it("writes key words in lower case, or as written, and wraps a long list [DESIGN] D36", () => {
    expect(formatSql("SELECT A FROM T", { ...OPTIONS, keyWords: "lower" })).toBe("select A\nfrom T\n");
    expect(formatSql("Select A From T", { ...OPTIONS, keyWords: "keep" })).toBe("Select A\nFrom T\n");
    const wide = formatSql(
      "SELECT AAAAAAAAAA, BBBBBBBBBB, CCCCCCCCCC, DDDDDDDDDD, EEEEEEEEEE, FFFFFFFFFF FROM T",
      OPTIONS,
    );
    expect(wide.split("\n").every((l) => l.length <= 60)).toBe(true);
    expect(wide.split("\n")[1]?.startsWith("    ")).toBe(true);
    expect(formatSql("UPDATE T SET A = 1.5e3, B = .5 WHERE C <> 2 /* kept */", OPTIONS)).toBe(
      "UPDATE T\nSET A = 1.5e3, B = .5\nWHERE C <> 2 /* kept */\n",
    );
    expect(formatSql("", OPTIONS)).toBe("");
  });
});

describe("the manual's example", () => {
  it("is formatted as the manual shows it, of the settings' defaults [STUDIO Formatting]", () => {
    const section = worksheets.split("\n## Formatting\n")[1]?.split("\n## ")[0] ?? "";
    const [written, formatted] = [...section.matchAll(/```sql\n([\s\S]*?)```/gu)].map(([, block]) => block ?? "");
    const reserved = [
      "SELECT",
      "AS",
      "FROM",
      "LEFT",
      "JOIN",
      "ON",
      "WHERE",
      "AND",
      "IS",
      "NOT",
      "NULL",
      "GROUP",
      "BY",
      "COUNT",
    ];
    const defaults = {
      keyWords: DEFAULT_SETTINGS.formatKeyWords,
      indent: DEFAULT_SETTINGS.formatIndent,
      lineWidth: DEFAULT_SETTINGS.formatLineWidth,
      words: formatWords(reserved),
    };
    expect(formatSql(written ?? "", defaults)).toBe(formatted);
  });
});
