import type { ColumnInfo } from "../../ipc/connections";
import { fromBase64, fromHex, hexDump, imageType, MAX_DUMP_BYTES, toBase64 } from "./bytes";
import { firstChoice, graphOf, MAX_NODES, pathOf } from "./graph";
import { spatialType, viewKinds } from "./kinds";
import { parseJson, prettyXml } from "./structured";
import { figures, parseVector } from "./vector";
import { bounds, parseWkt } from "./wkt";

/** A column of `type`. */
function col(type: string): ColumnInfo {
  return { name: "V", typeWritten: type, typeName: null, notNull: false };
}

/** A path of accounts and transfers, as PATH_TO_JSON writes one. */
const PATH =
  '[{"table":"ACCOUNT","key":["a1"]},{"table":"TRANSFER","key":["t1"]},{"table":"ACCOUNT","key":["a2"]},{"table":"TRANSFER","key":["t2"]},{"table":"ACCOUNT","key":[3]}]';

describe("octets for the viewers", () => {
  it("reads a binary string's hexadecimal text and Base64, and dumps octets sixteen a line [DESIGN] D39", () => {
    expect(fromHex("DEADbeef")).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    expect(fromHex("ABC")).toBeNull();
    expect(fromHex("ZZ")).toBeNull();
    const bytes = new Uint8Array([0x41, 0x00, 0x7e, 0xff, 0x20]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    expect(toBase64(new TextEncoder().encode("foobar"))).toBe("Zm9vYmFy");
    expect(hexDump(new Uint8Array([...new TextEncoder().encode("Hello, world! 12"), 0x0a]))).toBe(
      "00000000  48 65 6c 6c 6f 2c 20 77 6f 72 6c 64 21 20 31 32  Hello, world! 12\n00000010  0a                                               .",
    );
    const big = hexDump(new Uint8Array(MAX_DUMP_BYTES + 3));
    expect(big.split("\n").at(-1)).toBe("… 3 more octets");
  });

  it("knows an image by its first octets, SVG never [DESIGN] D39", () => {
    expect(imageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(imageType(new TextEncoder().encode("GIF89a"))).toBe("image/gif");
    expect(imageType(new TextEncoder().encode("BM...."))).toBe("image/bmp");
    expect(imageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(imageType(new TextEncoder().encode("RIFF\0\0\0\0WAVE"))).toBeNull();
    expect(imageType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
  });
});

describe("JSON and XML for their viewers", () => {
  it("parses JSON, or says why not, and lays XML out a node a line [DESIGN] D39", () => {
    expect(parseJson('{"a":[1,2]}')).toEqual({ ok: true, value: { a: [1, 2] } });
    expect(parseJson("{").ok).toBe(false);
    expect(prettyXml('<?xml version="1.0"?><a x="1"><b>text</b><c/><!-- note --><d><e>1</e></d>tail</a>')).toBe(
      [
        '<?xml version="1.0"?>',
        '<a x="1">',
        "  <b>text</b>",
        "  <c/>",
        "  <!-- note -->",
        "  <d>",
        "    <e>1</e>",
        "  </d>",
        "  tail",
        "</a>",
      ].join("\n"),
    );
    expect(prettyXml("<a><![CDATA[x<y]]></a>", 4)).toBe("<a>\n    <![CDATA[x<y]]>\n</a>");
    expect(prettyXml("</a></b>")).toBe("</a>\n</b>");
    expect(prettyXml("")).toBe("");
  });
});

describe("spatial values on a plane", () => {
  it("reads the well-known text Turborel writes: points, lines, polygons with holes, and their collections [DOC data/02-spatial.md The deliveries]", () => {
    expect(parseWkt("POINT (1e3 100)")).toEqual([{ kind: "point", at: [1000, 100] }]);
    expect(parseWkt("LINESTRING (0 200, 1000 200)")).toEqual([
      {
        kind: "line",
        points: [
          [0, 200],
          [1000, 200],
        ],
      },
    ]);
    const zone = parseWkt(
      "POLYGON ((0 0, 1000 0, 1000 1000, 0 1000, 0 0), (400 400, 400 600, 600 600, 600 400, 400 400))",
    );
    expect(zone).toHaveLength(1);
    expect(zone?.[0]).toMatchObject({ kind: "polygon", rings: [expect.any(Array), expect.any(Array)] });
    expect(parseWkt("MULTIPOINT ((1 2), (3 4))")).toEqual([
      { kind: "point", at: [1, 2] },
      { kind: "point", at: [3, 4] },
    ]);
    expect(parseWkt("MULTIPOINT (1 2, 3 4)")).toHaveLength(2);
    expect(parseWkt("MULTILINESTRING ((0 0, 1 1), (2 2, 3 3))")).toHaveLength(2);
    expect(parseWkt("MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((5 5, 6 5, 6 6, 5 5)))")?.map((s) => s.kind)).toEqual([
      "polygon",
      "polygon",
    ]);
    expect(parseWkt("GEOMETRYCOLLECTION (POINT (1 2), LINESTRING (0 0, 1 1))")?.map((s) => s.kind)).toEqual([
      "point",
      "line",
    ]);
    expect(parseWkt("POINT Z (1 2 3)")).toEqual([{ kind: "point", at: [1, 2] }]);
    expect(parseWkt("COMPOUNDCURVE (CIRCULARSTRING (0 0, 1 1, 2 0), (2 0, 3 0))")?.map((s) => s.kind)).toEqual([
      "line",
      "line",
    ]);
    expect(parseWkt("CURVEPOLYGON (CIRCULARSTRING (0 0, 4 0, 4 4, 0 4, 0 0))")?.map((s) => s.kind)).toEqual([
      "polygon",
    ]);
    expect(parseWkt("POINT EMPTY")).toEqual([]);
    expect(parseWkt("GEOMETRYCOLLECTION EMPTY")).toEqual([]);
  });

  it("reads lists that mix coordinates with lists, and surfaces of polygons, as far as they are drawn [DESIGN] D39", () => {
    expect(parseWkt("MULTIPOINT ((1 2), 3 4)")).toEqual([
      { kind: "point", at: [1, 2] },
      { kind: "point", at: [3, 4] },
    ]);
    expect(parseWkt("MULTILINESTRING ((0 0, 1 1), 2 2)")).toEqual([
      {
        kind: "line",
        points: [
          [0, 0],
          [1, 1],
        ],
      },
      { kind: "line", points: [[2, 2]] },
    ]);
    expect(parseWkt("MULTIPOLYGON (((0 0, 1 0, 0 0)), 5 5)")?.map((s) => s.kind)).toEqual(["polygon"]);
    expect(parseWkt("MULTISURFACE (CURVEPOLYGON ((0 0, 1 0, 0 0)), ((2 2, 3 2, 2 2)))")?.map((s) => s.kind)).toEqual([
      "polygon",
      "polygon",
    ]);
    expect(parseWkt("GEOMETRYCOLLECTION (POINT (1 2), (3 4))")).toEqual([{ kind: "point", at: [1, 2] }]);
    expect(parseWkt("MULTIPOINT (POINT (1 2))")).toEqual([{ kind: "point", at: [1, 2] }]);
    expect(bounds(parseWkt("POLYGON ((0 0, 2 0, 2 3, 0 0))") ?? [])).toEqual({ minX: 0, minY: 0, maxX: 2, maxY: 3 });
  });

  it("reads nothing of text that is no well-known text, and boxes what it reads [DESIGN] D39", () => {
    for (const text of [
      "",
      "hello",
      "POINT",
      "POINT (1)",
      "POINT (1 2",
      "POINT (1 2) x",
      "POINT (a b)",
      "POINT (1 2;)",
      "LINESTRING (0 0 1 1, (",
    ]) {
      expect(parseWkt(text), text).toBeNull();
    }
    expect(bounds(parseWkt("LINESTRING (0 -300, 1400 1100)") ?? [])).toEqual({
      minX: 0,
      minY: -300,
      maxX: 1400,
      maxY: 1100,
    });
    expect(bounds([])).toBeNull();
  });
});

describe("vectors for their viewer", () => {
  it("reads dense, sparse and JSON vectors, as Turborel writes them, and their figures [DOC sql/14-vectors.md Writing vectors]", () => {
    expect(parseVector("[0.12, -0.5, 3.0E-2]")).toEqual({
      dims: 3,
      elements: [
        [0, 0.12],
        [1, -0.5],
        [2, 0.03],
      ],
      sparse: false,
    });
    expect(parseVector("[30522, [17, 2048], [0.4, 1.2]]")).toEqual({
      dims: 30522,
      elements: [
        [17, 0.4],
        [2048, 1.2],
      ],
      sparse: true,
    });
    expect(parseVector('{"dims":30522,"indices":[17,2048],"values":[0.4,1.2]}')?.elements).toHaveLength(2);
    for (const text of ["[", "[1, [2], [3, 4]]", '"x"', '[1, "a"]', '{"dims":"3"}', "null"]) {
      expect(parseVector(text), text).toBeNull();
    }
    expect(
      figures({
        dims: 2,
        elements: [
          [0, 3],
          [1, -4],
        ],
        sparse: false,
      }),
    ).toEqual({ norm: 5, min: -4, max: 3 });
    expect(figures({ dims: 9, elements: [[3, 2]], sparse: true })).toEqual({ norm: 2, min: 0, max: 2 });
  });
});

describe("a result as a graph", () => {
  it("reads a path as PATH_TO_JSON writes it, its vertices nodes and its edges between them [DOC sql/20-property-graphs.md Functions]", () => {
    expect(pathOf(PATH)).toHaveLength(5);
    for (const text of [null, "[]", "[1]", "{", '[{"table":"T"}]']) {
      expect(pathOf(text), String(text)).toBeNull();
    }
    const g = graphOf([[PATH], ['[{"table":"ACCOUNT","key":["a1"]}]'], [null]], { kind: "paths", column: 0 });
    expect(g.nodes.map((n) => n.label)).toEqual(["ACCOUNT a1", "ACCOUNT a2", "ACCOUNT 3"]);
    expect(g.edges.map((e) => e.label)).toEqual(["TRANSFER t1", "TRANSFER t2"]);
  });

  it("reads two columns as each row's edge, a third its label, at most so many nodes [DESIGN] D39", () => {
    expect(firstChoice([[null, PATH]], 2)).toEqual({ kind: "paths", column: 1 });
    expect(firstChoice([["a", "b"]], 2)).toEqual({ kind: "pairs", from: 0, to: 1, label: null });
    expect(firstChoice([["a"]], 1)).toBeNull();
    expect(firstChoice([], 1)).toBeNull();
    const g = graphOf(
      [
        ["Ann", "Bob", "5"],
        ["Bob", "Cy", null],
        ["Cy", null, "1"],
      ],
      { kind: "pairs", from: 0, to: 1, label: 2 },
    );
    expect(g.nodes.map((n) => n.id)).toEqual(["Ann", "Bob", "Cy"]);
    expect(g.edges.map((e) => [e.source, e.target, e.label])).toEqual([
      ["Ann", "Bob", "5"],
      ["Bob", "Cy", "NULL"],
    ]);
    expect(graphOf([["a", "b"]], { kind: "pairs", from: 0, to: 1, label: null }).edges[0]?.label).toBe("");
    const many = Array.from({ length: MAX_NODES + 5 }, (_, i) => [String(i), String(i + 1)]);
    expect(graphOf(many, { kind: "pairs", from: 0, to: 1, label: null }).nodes).toHaveLength(MAX_NODES);
  });
});

describe("which viewers show a value", () => {
  it("chooses by the declared type first, then by what the text is [DESIGN] D39", () => {
    expect(viewKinds(col("JSON"), '{"a":1}', null)).toEqual(["json", "text"]);
    expect(viewKinds(col("VARCHAR(9)"), "[1, 2]", null)).toEqual(["vector", "json", "text"]);
    expect(viewKinds(col("VECTOR(3)"), "[1,2,3]", null)).toEqual(["vector", "json", "text"]);
    expect(viewKinds(col("GEOMETRY(0)"), "POINT (1 2)", null)).toEqual(["plane", "text"]);
    expect(viewKinds(col("VARCHAR(99)"), "LINESTRING (0 0, 1 1)", null)).toEqual(["plane", "text"]);
    expect(viewKinds(col("XML"), "<a/>", null)).toEqual(["xml", "text"]);
    expect(viewKinds(col("JSON"), PATH, null)).toEqual(["path", "json", "text"]);
    expect(viewKinds(col("VARCHAR(9)"), "plain", null)).toEqual(["text"]);
    expect(viewKinds(col("VARCHAR(9)"), null, null)).toEqual(["text"]);
    expect(viewKinds(col("BLOB(1M)"), null, new Uint8Array([0xff, 0xd8, 0xff]))).toEqual(["image", "hex"]);
    expect(viewKinds(col("VARBINARY(4)"), null, new Uint8Array([1]))).toEqual(["hex"]);
    expect(spatialType(col("ST_POINT"))).toBe(true);
    expect(spatialType(col("INTEGER"))).toBe(false);
  });
});
