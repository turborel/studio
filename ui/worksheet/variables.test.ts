import { bound, markers, substituted, variableNames } from "./variables";
import { spans } from "./scan";

describe("a statement's markers", () => {
  it("are read in code alone, never in a string, an identifier or a comment [DESIGN] D36", () => {
    const text = "SELECT ? , :id, '${x} ?' , \"a?\", ${t} -- ? :y\n/* ? /* nested */ ? */ FROM T WHERE A::B = :name";
    const found = markers(text).map((m) => `${m.kind}:${m.name}`);
    expect(found).toEqual(["parameter:", "named:id", "variable:t", "named:name"]);
    expect(spans("'it''s'").map((s) => s.kind)).toEqual(["string"]);
    expect(spans("'open").at(-1)?.to).toBe(5);
    expect(spans("/* never closed").map((s) => s.kind)).toEqual(["comment"]);
    expect(markers(": $ ${ ${1} ${ok").length).toBe(0);
  });

  it("give script variables their values, refusing one without [DESIGN] D36", () => {
    expect(variableNames("SELECT * FROM ${s}.T, ${s}.U, ${u}")).toEqual(["s", "u"]);
    expect(substituted("SELECT * FROM ${s}.T WHERE '${s}' = A", { s: "ANN" })).toBe(
      "SELECT * FROM ANN.T WHERE '${s}' = A",
    );
    expect(() => substituted("${missing}", {})).toThrow("The script variable missing has no value.");
  });

  it("number parameters, and write a named one as a question mark [DESIGN] D36", () => {
    expect(bound("SELECT * FROM T WHERE A = :a AND B = ? AND C = :a")).toEqual({
      sql: "SELECT * FROM T WHERE A = ? AND B = ? AND C = ?",
      names: ["a", "?2", "a"],
    });
    expect(bound("VALUES (1)")).toEqual({ sql: "VALUES (1)", names: [] });
  });
});
