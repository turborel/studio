import { formatWords, sqlName, turborelDialect } from "./dialect";

describe("Turborel's dialect", () => {
  it("writes a name bare only where the lexer reads it back so [DOC sql/01-lexical.md Key words]", () => {
    const reserved = new Set(["VALUE", "SELECT"]);
    expect(sqlName("STAFF", reserved)).toBe("STAFF");
    expect(sqlName("VALUE", reserved)).toBe('"VALUE"');
    expect(sqlName("lower", reserved)).toBe('"lower"');
    expect(sqlName('a"b', reserved)).toBe('"a""b"');
  });

  it("knows the reserved words, the statements' words and the types [DOC sql/02-data-types.md Data Types]", () => {
    const dialect = turborelDialect(["SELECT", "INTEGER"]);
    expect(dialect.spec.keywords?.split(" ")).toContain("select");
    expect(dialect.spec.keywords?.split(" ")).toContain("explain");
    expect(dialect.spec.keywords?.split(" ")).not.toContain("integer");
    expect(dialect.spec.types?.split(" ")).toContain("integer");
    expect(formatWords(["SELECT"]).has("VARCHAR")).toBe(true);
  });
});
