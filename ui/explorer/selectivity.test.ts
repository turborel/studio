import { selectivity } from "./selectivity";

describe("an index's selectivity", () => {
  it("is one key's share of its entries, and how many entries a key has; none before it has counted keys [DESIGN] D72", () => {
    const of = (distinctKeys: string | null, entries: string | null) =>
      selectivity({ name: "I", method: "btree", entries, distinctKeys });
    expect(of("240", "960")).toBe("1 in 240 (0.42%), about 4 entries a key");
    expect(of("1", "5")).toBe("1 in 1 (100%), about 5 entries a key");
    expect(of("2000000", null)).toBe("1 in 2,000,000 (0.00005%)");
    expect(of("10", "0")).toBe("1 in 10 (10%)");
    expect(of("0", "10")).toBe("");
    expect(of(null, "10")).toBe("");
    expect(of("many", "10")).toBe("");
    expect(selectivity(null)).toBe("");
    expect(selectivity(undefined)).toBe("");
  });
});
