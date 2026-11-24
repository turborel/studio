import { misestimated, operators, parsePlan } from "./plan";
import { groupingOf, kindOf, markOf, rangeOf, semiOf, transferOf, unnestOf } from "./kinds";
import { ownTime } from "./summary";

/** The lines of a plan as EXPLAIN gives them, one row each, the result's left margin taken off. */
function lines(text: string): string[] {
  return text.split("\n").map((l) => l.slice(1));
}

describe("a plan", () => {
  it("reads a band join as a range join, of its condition and what it is sorted on [DOC sql/statements/explain.md EXAMPLES]", () => {
    const plan = parsePlan(
      lines(` -- bound:
 Project S.REGION, P.NAME
   Filter S.CUSTOMER >= (P.ID - 2) AND S.CUSTOMER <= (P.ID + 2)
     Product
       Scan ANN.PARTS
       Scan ANN.SALES
 -- rules: none
 -- optimized:
 Project S.REGION, P.NAME
   Filter S.CUSTOMER >= (P.ID - 2) AND S.CUSTOMER <= (P.ID + 2)
     Product
       Scan ANN.PARTS
       Scan ANN.SALES
 -- physical:
 Project S.REGION, P.NAME
   RangeJoin S.CUSTOMER >= (P.ID - 2) AND S.CUSTOMER <= (P.ID + 2)  (sorted on S.CUSTOMER)
     SeqScan ANN.PARTS  (rows=1000, cost=1000.0)
     SeqScan ANN.SALES  (rows=4, cost=3.7)`),
    );
    const join = plan.stages[2]?.roots[0]?.children[0];
    expect(join?.operator).toBe("RangeJoin");
    expect(join?.detail).toBe("S.CUSTOMER >= (P.ID - 2) AND S.CUSTOMER <= (P.ID + 2)");
    expect(join?.children.map((c) => c.detail)).toEqual(["ANN.PARTS", "ANN.SALES"]);
    if (join === undefined) {
      throw new Error("no join");
    }
    expect(kindOf(join)).toBe("rangeJoin");
    expect(rangeOf(join)).toEqual({ sorted: "S.CUSTOMER", within: [], pruned: null });
    expect(rangeOf(join.children[0] ?? join)).toBeNull();
  });

  it("reads a range join's groups and pruning, and a left range join [DOC sql/statements/explain.md DESCRIPTION]", () => {
    const [left] =
      parsePlan([
        "-- physical:",
        "LeftRangeJoin A.T < B.T AND A.K = B.K  (sorted on B.T within B.K within B.R, pruned by B.U)  (est. rows=10)",
      ]).stages[0]?.roots ?? [];
    if (left === undefined) {
      throw new Error("no join");
    }
    expect(kindOf(left)).toBe("rangeJoin");
    expect(left.estimated).toBe(10);
    expect(rangeOf(left)).toEqual({ sorted: "B.T", within: ["B.K", "B.R"], pruned: "B.U" });
  });

  it("is read into its stages and their trees [DOC sql/statements/explain.md EXAMPLES]", () => {
    const plan = parsePlan(
      lines(` -- bound:
 Project PARTS.ID
   Filter PARTS.NAME = 'part 7'
     Scan ANN.PARTS
 -- rules: none
 -- optimized:
 Project PARTS.ID
   Filter PARTS.NAME = 'part 7'
     Scan ANN.PARTS
 -- physical:
 Project PARTS.ID
   IndexScan ANN.PARTS using PARTS_NAME [btree]: PARTS.NAME = 'part 7'  (est. rows=1, cost=20.6)`),
    );
    expect(plan.stages.map((s) => s.name)).toEqual(["bound", "optimized", "physical"]);
    expect(plan.rules).toEqual([]);
    const physical = plan.stages[2]?.roots[0];
    expect(physical?.operator).toBe("Project");
    const scan = physical?.children[0];
    expect(scan?.operator).toBe("IndexScan");
    expect(scan?.detail).toBe("ANN.PARTS using PARTS_NAME [btree]: PARTS.NAME = 'part 7'");
    expect(scan?.estimated).toBe(1);
    expect(operators(plan.stages[0]?.roots ?? []).map((n) => n.operator)).toEqual(["Project", "Filter", "Scan"]);
  });

  it("tells its rules, the tables storage counted, and a join's notes [DOC sql/statements/explain.md EXAMPLES]", () => {
    const plan = parsePlan(
      lines(` -- rules: push_filter_into_product
 -- physical:
 Project PARTS.NAME, SUPPLIERS.CITY, OFFERS.PRICE
   IndexNestedLoop ANN.PARTS using ANN.PARTS.UNIQUE1 [btree]: OFFERS.PART = PARTS.ID  (join order by DPccp: ((OFFERS SUPPLIERS) PARTS))  (est. rows each=1, cost=20.6)
     HashJoin OFFERS.SUPPLIER = SUPPLIERS.ID
       SeqScan ANN.OFFERS  (rows=5000, cost=5000.0)
 -- counted by storage: ANN.PARTS`),
    );
    expect(plan.rules).toEqual(["push_filter_into_product"]);
    expect(plan.counted).toEqual(["ANN.PARTS"]);
    const join = plan.stages[0]?.roots[0]?.children[0];
    expect(join?.notes).toEqual(["join order by DPccp: ((OFFERS SUPPLIERS) PARTS)", "est. rows each=1, cost=20.6"]);
    expect(join?.estimated).toBe(1);
    expect(join?.children[0]?.children[0]?.estimated).toBe(5000);
  });

  it("of EXPLAIN ANALYZE, has each operator's actual rows, probes and the rows run [DOC sql/statements/explain.md EXPLAIN ANALYZE]", () => {
    const plan = parsePlan(
      lines(` -- physical:
 Project S.REGION, P.NAME  (est. rows=4)  (actual rows=4)
   IndexNestedLoop ANN.PARTS using ANN.PARTS.UNIQUE1 [btree]: S.CUSTOMER = P.ID  (est. rows each=1, cost=82.4)  (actual rows=4, probes=4)
     SeqScan ANN.SALES  (rows=4, cost=3.7)  (actual rows=4)
 -- ran: 4 rows`),
    );
    expect(plan.ran).toBe(4);
    const [project] = plan.stages[0]?.roots ?? [];
    expect([project?.estimated, project?.actual]).toEqual([4, 4]);
    expect(project?.children[0]?.probes).toBe(4);
  });

  it("marks a misestimate and an operator never run, and reads loops and time [DOC sql/statements/explain.md EXPLAIN ANALYZE]", () => {
    const limited = parsePlan(
      lines(` -- physical:
 Limit fetch 3  (est. rows=3)  (actual rows=3)
   Project PARTS.ID  (est. rows=1000)  (actual rows=3)
     SeqScan ANN.PARTS  (rows=1000, cost=900.0)  (actual rows=16)
       Filter X  (never run)`),
    );
    const nodes = operators(limited.stages[0]?.roots ?? []);
    expect(nodes.map(misestimated)).toEqual([false, true, true, false]);
    expect(nodes[3]?.neverRun).toBe(true);
    const timed = parsePlan(["-- physical:", "SeqScan T  (actual rows=2, loops=3, time=1.5 ms)", ""]);
    expect([timed.stages[0]?.roots[0]?.loops, timed.stages[0]?.roots[0]?.millis]).toEqual([3, 1.5]);
    const stray = parsePlan(["Project stray", "  Wonder (what=1)"]);
    expect(stray.stages.map((st) => st.name)).toEqual(["plan"]);
    expect(stray.stages[0]?.roots[0]?.children[0]?.operator).toBe("Wonder");
  });

  it("reads a live plan of the server, its query's time, a sort, a hash join and a filter [DESIGN] D54", () => {
    // EXPLAIN ANALYZE of a join, as turboreld gave it, the clock moving.
    const plan = parsePlan(
      lines(` -- physical:
 Limit fetch 5  (est. rows=5)  (actual rows=5, time=1.040 ms)
   Sort B.NAME  (est. rows=100)  (actual rows=5, time=1.039 ms)
     Project A.ID, B.NAME  (est. rows=100)  (actual rows=111, time=0.825 ms)
       HashJoin A.B = B.ID  (est. rows=100)  (actual rows=111, time=0.823 ms)
         SeqScan ANN.LP_A  (rows=300, cost=300.0)  (actual rows=300, time=0.013 ms)
         Filter B.NAME LIKE 'n1%'  (est. rows=100)  (actual rows=111, time=0.368 ms)
           SeqScan ANN.LP_B  (rows=300, cost=300.0)  (actual rows=300, time=0.022 ms)
 -- ran: 5 rows in 1.049 ms`),
    );
    expect([plan.ran, plan.ranMillis]).toEqual([5, 1.049]);
    const nodes = operators(plan.stages[0]?.roots ?? []);
    expect(nodes.map((n) => n.operator)).toEqual([
      "Limit",
      "Sort",
      "Project",
      "HashJoin",
      "SeqScan",
      "Filter",
      "SeqScan",
    ]);
    expect(nodes[4]?.cost).toBe(300);
    expect(nodes[6]?.millis).toBe(0.022);
    expect(parsePlan(["-- ran: 1 row"]).ranMillis).toBeNull();
    expect(parsePlan(["-- ran: something"]).ran).toBeNull();
  });
});

describe("an operator's own time", () => {
  it("is told to the microsecond, with no error of floating point [DESIGN] D54", () => {
    const plan = parsePlan([
      "-- physical:",
      "HashJoin O.CUSTOMER_ID = C.ID  (actual rows=240, time=1.316 ms)",
      "  SeqScan DEMO.ORDERS  (actual rows=240, time=0.591 ms)",
      "",
    ]);
    const join = plan.stages[0]?.roots[0];
    expect(join === undefined ? null : ownTime(join)).toBe(0.725);
  });
});

describe("a streamed grouping", () => {
  it("is an aggregate grouped a group at a time, of the manual's example [DOC sql/statements/explain.md EXAMPLES]", () => {
    const plan = parsePlan(
      `-- bound:
Limit fetch 3
  Sort PARTS.NAME
    Project PARTS.NAME, COUNT(*)
      Aggregate group by [PARTS.NAME] computing [COUNT(*)]
        Scan ANN.PARTS
-- rules: none
-- optimized:
Limit fetch 3
  Sort PARTS.NAME
    Project PARTS.NAME, COUNT(*)
      Aggregate group by [PARTS.NAME] computing [COUNT(*)]
        Scan ANN.PARTS
-- physical:
Limit fetch 3
  Project PARTS.NAME, COUNT(*)
    Aggregate streamed group by [PARTS.NAME] computing [COUNT(*)]
      Sort PARTS.NAME
        SeqScan ANN.PARTS  (rows=1000, cost=900.0)`.split("\n"),
    );
    const physical = plan.stages.find((s) => s.name === "physical");
    const aggregate = physical?.roots[0]?.children[0]?.children[0];
    expect(aggregate?.operator).toBe("Aggregate");
    expect(aggregate === undefined ? null : kindOf(aggregate)).toBe("aggregate");
    expect(aggregate === undefined ? null : groupingOf(aggregate)).toEqual({
      streamed: true,
      keys: ["PARTS.NAME"],
      computing: ["COUNT(*)"],
    });
    const bound = plan.stages[0]?.roots[0]?.children[0]?.children[0]?.children[0];
    expect(bound === undefined ? null : groupingOf(bound)?.streamed).toBe(false);
    const sort = aggregate?.children[0];
    expect(sort === undefined ? null : groupingOf(sort)).toBeNull();
  });

  it("splits its lists at the commas between their items alone [DESIGN] D54", () => {
    const [node] =
      parsePlan(["-- physical:", "Aggregate computing [SUM(A), COALESCE(MAX(B), 0)]", ""]).stages[0]?.roots ?? [];
    expect(node === undefined ? null : groupingOf(node)).toEqual({
      streamed: false,
      keys: [],
      computing: ["SUM(A)", "COALESCE(MAX(B), 0)"],
    });
  });
});

describe("semi joins and antijoins", () => {
  it("are known by each name EXPLAIN gives them, each with how it searches its right [DOC sql/06-queries.md Correlated subqueries]", () => {
    const cases: readonly (readonly [string, "semiJoin" | "antiJoin", string | null])[] = [
      [
        "HashSemiJoin S.DEPT = DEPT.DEPT  (hashed on S.DEPT = DEPT.DEPT)",
        "semiJoin",
        "its right hashed, its left read against it",
      ],
      [
        "HashAntiJoin S.DEPT = DEPT.DEPT  (hashed on S.DEPT = DEPT.DEPT)",
        "antiJoin",
        "its right hashed, its left read against it",
      ],
      ["HashRightSemiJoin S.DEPT = DEPT.DEPT", "semiJoin", "its left hashed, its right read against it"],
      ["HashRightAntiJoin S.DEPT = DEPT.DEPT", "antiJoin", "its left hashed, its right read against it"],
      ["NestedLoopSemiJoin S.N < T.N", "semiJoin", "a nested loop"],
      ["NestedLoopAntiJoin S.N < T.N", "antiJoin", "a nested loop"],
      [
        "SemiIndexNestedLoop DEMO.ORDERS using ORDERS_BY_CUSTOMER [btree]: O.CUSTOMER_ID = C.ID  (est. rows each=1, cost=2.0)",
        "semiJoin",
        "an index of its right probed, a left row at a time",
      ],
      [
        "AntiIndexNestedLoop DEMO.ORDERS using ORDERS_BY_CUSTOMER [btree]: O.CUSTOMER_ID = C.ID  (est. rows each=1, cost=2.0)",
        "antiJoin",
        "an index of its right probed, a left row at a time",
      ],
      ["Semi join on S.DEPT = DEPT.DEPT", "semiJoin", null],
      ["Anti join on S.DEPT = DEPT.DEPT", "antiJoin", null],
    ];
    for (const [line, kind, method] of cases) {
      const [node] = parsePlan(["-- physical:", line, ""]).stages[0]?.roots ?? [];
      expect(node === undefined ? null : kindOf(node)).toBe(kind);
      expect(node === undefined ? null : semiOf(node)).toEqual({ anti: kind === "antiJoin", method });
    }
    const [join] = parsePlan(["-- physical:", "HashJoin A.K = B.K", ""]).stages[0]?.roots ?? [];
    expect(join === undefined ? null : [kindOf(join), semiOf(join)]).toEqual(["join", null]);
  });

  it("a DISTINCT made in key order is a streamed grouping of no keys [DESIGN] D54", () => {
    const [node] = parsePlan(["-- physical:", "Distinct streamed", ""]).stages[0]?.roots ?? [];
    expect(node === undefined ? null : groupingOf(node)).toEqual({ streamed: true, keys: [], computing: [] });
  });
});

/** EXPLAIN ANALYZE's examples of the manual, at the commit Studio is pinned to: each as it prints it. */
const MANUAL: Readonly<Record<string, readonly string[]>> = {
  join: [
    "-- physical:",
    "Project S.REGION, P.NAME  (est. rows=4)  (actual rows=4)",
    "  IndexNestedLoop ANN.PARTS using ANN.PARTS.UNIQUE1 [btree]: S.CUSTOMER = P.ID  (est. rows each=1, cost=82.4)  (actual rows=4, probes=4, entries=4, leaf pages=4, fetched=4)",
    "    SeqScan ANN.SALES  (rows=4, cost=3.7)  (actual rows=4, leaf pages=1)",
    "-- ran: 4 rows",
  ],
  fetched: [
    "-- physical:",
    "Limit fetch 3  (est. rows=3)  (actual rows=3)",
    "  Project PARTS.ID  (est. rows=1000)  (actual rows=3)",
    "    SeqScan ANN.PARTS  (rows=1000, cost=900.0)  (actual rows=16, batches=1, mean rows=16)",
    "-- ran: 3 rows",
  ],
  sorted: [
    "-- physical:",
    "Sort OFFERS.PRICE DESC  (est. rows=5000)  (actual rows=5000, spilled=250783 bytes, partitions=5, passes=3)",
    "  Project OFFERS.PART, OFFERS.PRICE  (est. rows=5000)  (actual rows=5000, batches=9, mean rows=556)",
    "    SeqScan ANN.OFFERS  (rows=5000, cost=4666.7)  (actual rows=5000, batches=9, mean rows=556)",
    "-- ran: 5000 rows",
  ],
  updated: [
    "-- physical:",
    "Update ANN.OFFERS  (actual rows changed=50)",
    "  Filter OFFERS.PRICE <= 50  (est. rows=51)  (actual rows=50)",
    "    SeqScan ANN.OFFERS  (rows=5000, cost=1024.0)  (actual rows=1024, leaf pages=8)",
    "-- ran: 50 rows changed",
  ],
};

/** The physical operators of the manual's example `name`, depth first. */
function physical(name: string) {
  const plan = parsePlan(MANUAL[name] ?? []);
  return { plan, nodes: operators(plan.stages[0]?.roots ?? []) };
}

describe("what EXPLAIN ANALYZE tells an operator did", () => {
  it("reads an index's entries, leaves and rows fetched, and a scan's leaves [DOC sql/statements/explain.md EXPLAIN ANALYZE]", () => {
    const [, join, scan] = physical("join").nodes;
    expect([join?.probes, join?.reads]).toEqual([4, { entries: 4, fetched: 4, rechecked: null, leafPages: 4 }]);
    expect(scan?.reads).toEqual({ entries: null, fetched: null, rechecked: null, leafPages: 1 });
    expect(join?.estimated).toBe(1);
  });

  it("reads batches and their mean rows, never as the estimate [DOC sql/statements/explain.md EXPLAIN ANALYZE]", () => {
    const scan = physical("fetched").nodes.at(-1);
    expect([scan?.batches, scan?.estimated, scan?.actual]).toEqual([{ count: 1, meanRows: 16 }, 1000, 16]);
    const [limit] = physical("fetched").nodes;
    expect([limit?.batches, limit?.spilled, limit?.reads, limit?.changed]).toEqual([null, null, null, null]);
  });

  it("reads a spill's bytes, partitions and passes [DOC sql/statements/explain.md EXPLAIN ANALYZE]", () => {
    const [sort] = physical("sorted").nodes;
    expect(sort?.spilled).toEqual({ bytes: 250783, partitions: 5, passes: 3 });
    expect(sort?.actual).toBe(5000);
  });

  it("reads a data change's rows changed, its top node a change [DOC sql/statements/explain.md EXPLAIN ANALYZE of a data change]", () => {
    const { plan, nodes } = physical("updated");
    const [update] = nodes;
    expect([update?.operator, update?.changed, update?.actual]).toEqual(["Update", 50, null]);
    expect(update === undefined ? null : kindOf(update)).toBe("change");
    expect([plan.ran, plan.ranChanged]).toEqual([50, true]);
    expect(nodes.at(-1)?.reads?.leafPages).toBe(8);
    expect(physical("join").plan.ranChanged).toBe(false);
  });
});

describe("mark joins", () => {
  it("are known by each name EXPLAIN gives them, with what they mark and how [DOC sql/06-queries.md Correlated subqueries]", () => {
    const hashed = "HashMarkJoin S.DEPT = D.DEPT  (marking S.PAY > D.FLOOR)  (hashed on S.DEPT = D.DEPT)";
    const [hash] = parsePlan(["-- physical:", hashed, ""]).stages[0]?.roots ?? [];
    expect(hash === undefined ? null : [kindOf(hash), markOf(hash)]).toEqual([
      "markJoin",
      { marking: "S.PAY > D.FLOOR", method: "its right hashed by the values its rows are matched on" },
    ]);
    const [nested] = parsePlan(["-- physical:", "NestedLoopMarkJoin S.N < T.N", ""]).stages[0]?.roots ?? [];
    expect(nested === undefined ? null : markOf(nested)).toEqual({ marking: null, method: "a nested loop" });
    const [logical] =
      parsePlan(["-- bound:", "Mark join on S.DEPT = D.DEPT marking S.PAY > D.FLOOR", ""]).stages[0]?.roots ?? [];
    expect(logical === undefined ? null : [kindOf(logical), markOf(logical)]).toEqual([
      "markJoin",
      { marking: "S.PAY > D.FLOOR", method: null },
    ]);
    const [semi] = parsePlan(["-- physical:", "HashSemiJoin A.K = B.K", ""]).stages[0]?.roots ?? [];
    expect(semi === undefined ? null : markOf(semi)).toBeNull();
  });

  it("reads a phase of predicate transfer as EXPLAIN ANALYZE writes it, its figures its own [DESIGN] D54", () => {
    const plan = parsePlan([
      "-- physical:",
      "PredicateTransfer of 3 leaves, 2 steps  (est. rows=500)  (actual rows=5000, time=1.322 ms)",
      "  Project PARTS.NAME, SUPPLIERS.CITY, OFFERS.PRICE  (est. rows=500)  (actual rows=5000, time=0.537 ms, batches=3, mean rows=1667)",
      "    HashJoin PARTS.ID = OFFERS.PART  (join order by DPccp: (PARTS (OFFERS SUPPLIERS)))  (est. rows=500)  (actual rows=5000, time=0.533 ms, batches=3, mean rows=1667)",
      "      SeqScan DEMO.PARTS  (rows=1000, cost=1000.0)  (actual rows=1, time=0.043 ms, batches=6, mean rows=0)",
      "      HashJoin OFFERS.SUPPLIER = SUPPLIERS.ID  (est. rows=500)  (actual rows=5000, time=0.164 ms, batches=9, mean rows=556)",
      "        SeqScan DEMO.OFFERS  (rows=5000, cost=5000.0)  (actual rows=5000, time=0.205 ms, batches=9, mean rows=556)",
      "        Filter SUPPLIERS.CITY = 'Oslo'  (est. rows=0)  (actual rows=2, time=0.118 ms, batches=1, mean rows=2)",
      "          SeqScan DEMO.SUPPLIERS  (rows=10, cost=10.0)  (actual rows=10, time=0.057 ms, batches=1, mean rows=10)",
      "-- ran: 5000 rows in 1.496 ms",
    ]);
    const root = plan.stages[0]?.roots[0];
    expect([root?.operator, root?.detail, root?.estimated, root?.actual, root?.millis]).toEqual([
      "PredicateTransfer",
      "of 3 leaves, 2 steps",
      500,
      5000,
      1.322,
    ]);
    expect(root === undefined ? null : kindOf(root)).toBe("transfer");
    expect(root === undefined ? null : transferOf(root)).toEqual({ leaves: 3, steps: 2 });
    expect(root?.children[0]?.operator).toBe("Project");
    expect(operators(plan.stages[0]?.roots ?? [])).toHaveLength(8);
    expect(plan.ran).toBe(5000);
  });

  it("reads an unnesting as a LATERAL derived table's EXPLAIN writes it, and an outer one numbered [DESIGN] D54", () => {
    const plan = parsePlan([
      "-- physical:",
      "Project PA.ID, PA.N, T.C  (actual rows=5, time=0.770 ms)",
      "  Unnest of 1 collections  (actual rows=5, time=0.768 ms, leaf pages=2)",
      "    SeqScan ANN.PA  (rows=5, cost=5.0)  (actual rows=5, time=0.197 ms, leaf pages=1)",
      "-- ran: 5 rows in 0.770 ms",
    ]);
    const unnest = plan.stages[0]?.roots[0]?.children[0];
    expect([unnest?.operator, unnest?.detail, unnest?.actual]).toEqual(["Unnest", "of 1 collections", 5]);
    expect(unnest === undefined ? null : kindOf(unnest)).toBe("unnest");
    expect(unnest === undefined ? null : unnestOf(unnest)).toEqual({ collections: 1, outer: false, ordinality: false });
    const [outer] =
      parsePlan(["-- physical:", "LeftOuterUnnest of 2 collections with ordinality", ""]).stages[0]?.roots ?? [];
    expect(outer === undefined ? null : unnestOf(outer)).toEqual({ collections: 2, outer: true, ordinality: true });
    const [scan] = parsePlan(["-- physical:", "SeqScan ANN.PA  (rows=5, cost=5.0)", ""]).stages[0]?.roots ?? [];
    expect(scan === undefined ? null : unnestOf(scan)).toBeNull();
  });

  it("reads what plain EXPLAIN of a data change says it would do, its plan's operators apart [DESIGN] D70", () => {
    const plan = parsePlan([
      "-- physical:",
      "Delete from ANN.PARTS",
      "  IndexScan ANN.PARTS using ANN.PARTS.UNIQUE1 [btree]: PARTS.ID = 7  (est. rows=1, cost=20.6)",
      "-- maintains: ANN.PARTS.UNIQUE1 [btree], PARTS_NAME [btree]",
      "-- cascades: ON DELETE CASCADE to ANN.ORDERS by ANN.ORDERS_FOREIGN1",
      "-- cascades: ON DELETE SET NULL to ANN.NOTES by ANN.NOTES_FOREIGN1",
      "-- trigger: ANN.ORDER_GONE, AFTER DELETE FOR EACH ROW on ANN.ORDERS",
      "-- point path: one read of ANN.PARTS.UNIQUE1 when prepared or in a procedure",
    ]);
    expect(plan.stages.map((s) => s.name)).toEqual(["physical"]);
    const root = plan.stages[0]?.roots[0];
    expect([root?.operator, root?.detail, root === undefined ? null : kindOf(root)]).toEqual([
      "Delete",
      "from ANN.PARTS",
      "change",
    ]);
    expect(root?.children[0]?.operator).toBe("IndexScan");
    expect(plan.effects).toEqual({
      maintains: ["ANN.PARTS.UNIQUE1 [btree]", "PARTS_NAME [btree]"],
      cascades: [
        "ON DELETE CASCADE to ANN.ORDERS by ANN.ORDERS_FOREIGN1",
        "ON DELETE SET NULL to ANN.NOTES by ANN.NOTES_FOREIGN1",
      ],
      triggers: ["ANN.ORDER_GONE, AFTER DELETE FOR EACH ROW on ANN.ORDERS"],
      pointPath: "one read of ANN.PARTS.UNIQUE1 when prepared or in a procedure",
    });
    const values = parsePlan(["-- physical:", "Insert into ANN.SALES", "-- maintains: none", "-- point path: none"]);
    expect(values.effects).toEqual({ maintains: [], cascades: [], triggers: [], pointPath: null });
    expect(values.stages[0]?.roots.map((r) => r.operator)).toEqual(["Insert"]);
    expect(parsePlan(["-- physical:", "SeqScan ANN.T  (rows=4, cost=3.7)"]).effects).toBeNull();
  });
});
