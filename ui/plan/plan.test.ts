import { misestimated, operators, parsePlan } from "./plan";

/** The lines of a plan as EXPLAIN gives them, one row each, the result's left margin taken off. */
function lines(text: string): string[] {
  return text.split("\n").map((l) => l.slice(1));
}

describe("a plan", () => {
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
