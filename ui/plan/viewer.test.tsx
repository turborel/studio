import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type NodeProps, ReactFlowProvider } from "@xyflow/react";
import { changeWorksheet, openWorksheet } from "../state/worksheets";
import { catalogBackend, must, opened, settle, STAFF, within } from "../test/catalog";
import { changed, signature } from "./diff";
import { flowOf, placed, rowsOf, thickness } from "./flow";
import { indexOf, kindOf } from "./kinds";
import { operators, parsePlan } from "./plan";
import { barShare, OperatorNode, PlanGraph } from "./PlanGraph";
import { PlanTable, sortedRows, tableRows } from "./PlanTable";
import { PlanViewer } from "./PlanViewer";
import { CommandContextOf } from "../shell/ContextMenu";
import { physicalRoots, summarize, tableOf } from "./summary";

/** EXPLAIN ANALYZE's plan of a join (Turborel's `sql/statements/explain.md`), its operators timed. */
const ANALYZED = parsePlan([
  "-- physical:",
  "Project S.REGION, P.NAME  (est. rows=4)  (actual rows=4, time=9 ms)",
  "  IndexNestedLoop ANN.PARTS using ANN.PARTS.UNIQUE1 [btree]: S.CUSTOMER = P.ID  (join order by DPccp: ((S P)))  (est. rows each=1, cost=82.4)  (actual rows=4, probes=20000, time=8 ms)",
  "    SeqScan ANN.SALES  (rows=70000, cost=3.7)  (actual rows=4, time=2 ms)",
  "    Filter X  (never run)",
  "-- ran: 4 rows",
]);

/** EXPLAIN's plan of a count, its part run in parallel (Turborel's `sql/statements/explain.md`). */
const PARALLEL = parsePlan([
  "-- bound:",
  "Project SUM(PARTS.ID)",
  "  Scan ANN.PARTS",
  "-- rules: none",
  "-- physical:",
  "Project SUM(PARTS.ID)",
  "  Parallel  (degree=2)",
  "    Aggregate group by [] computing [SUM(PARTS.ID)]",
  "      SeqScan ANN.PARTS  (rows=100000, cost=1000.0)",
]);

describe("a plan's summary", () => {
  it("warns of a spill and of an index mostly judged again, and tells a data change's rows [DESIGN] D54", () => {
    const changed = parsePlan([
      "-- physical:",
      "Delete ANN.OFFERS  (actual rows changed=40)",
      "  Sort OFFERS.PRICE  (est. rows=50)  (actual rows=40, spilled=4096 bytes, partitions=2, passes=1)",
      "    IndexScan ANN.OFFERS using OFFERS_SHAPE [rtree]: OFFERS.AREA && 'x'  (est. rows=50, cost=9.0)  (actual rows=40, entries=100, fetched=100, rechecked=60)",
      "-- ran: 40 rows changed",
    ]);
    const s = summarize(changed, []);
    expect(s.warnings.map((w) => w.rule)).toEqual(["PLAN-SPILL", "PLAN-RECHECK"]);
    expect(s.warnings[0]?.says).toContain("MEMORY.WORK_BYTES");
    expect(s.warnings[1]?.says).toContain("60 of the 100 rows");
    const few = parsePlan([
      "-- physical:",
      "IndexScan ANN.T using T_K [btree]: T.K = 1  (actual rows=9, entries=10, fetched=10, rechecked=2)",
    ]);
    expect(summarize(few, []).warnings).toEqual([]);
  });

  it("tells the rows and time, the costliest operators by their own time, and the warnings of their rules [DESIGN] D54", () => {
    const s = summarize(ANALYZED, []);
    expect([s.analyzed, s.rows, s.millis]).toEqual([true, 4, 9]);
    expect(s.costliest.map((c) => [c.node.operator, c.by, c.value])).toEqual([
      ["IndexNestedLoop", "time", 6],
      ["SeqScan", "time", 2],
      ["Project", "time", 1],
    ]);
    expect(s.warnings.map((w) => w.rule)).toEqual([
      "PLAN-MANY-PROBES",
      "PLAN-FULL-SCAN",
      "PLAN-SERIAL",
      "PLAN-MISESTIMATE",
    ]);
    expect(ANALYZED.joinOrder).toEqual({ algorithm: "DPccp", order: "((S P))" });
  });

  it("ranks by cost where no time is told, warns of no serial scan of a plan run in parallel, and keeps the plan's findings [DESIGN] D54", () => {
    const finding = {
      rule: "SCAN-NO-INDEX",
      schema: "ANN",
      table: "PARTS",
      column: "ID",
      says: "no index",
      index: "I",
      create: "C",
      drop: "D",
    };
    const s = summarize(PARALLEL, [finding]);
    expect([s.analyzed, s.rows, s.millis]).toEqual([false, null, null]);
    expect(s.costliest.map((c) => [c.node.operator, c.by])).toEqual([["SeqScan", "cost"]]);
    expect(s.warnings.map((w) => w.rule)).toEqual(["PLAN-FULL-SCAN", "SCAN-NO-INDEX"]);
    expect(physicalRoots(parsePlan(["Project A"]))[0]?.operator).toBe("Project");
    expect(tableOf(must(physicalRoots(PARALLEL)[0]))).toBeNull();
  });

  it("knows each operator's kind and the index it reads [DESIGN] D54", () => {
    const kinds = operators(physicalRoots(ANALYZED)).map(kindOf);
    expect(kinds).toEqual(["project", "join", "scan", "filter"]);
    const named = (operator: string) => kindOf({ ...must(physicalRoots(ANALYZED)[0]), operator });
    expect(["IndexScan", "HashJoin", "Left", "Sort", "Aggregate", "Limit", "Parallel", "Odd"].map(named)).toEqual([
      "indexScan",
      "join",
      "join",
      "sort",
      "aggregate",
      "limit",
      "parallel",
      "other",
    ]);
    expect(indexOf(must(physicalRoots(ANALYZED)[0]?.children[0]))).toBe("ANN.PARTS.UNIQUE1");
    expect(indexOf(must(physicalRoots(ANALYZED)[0]))).toBeNull();
  });
});

describe("a plan's flow and tree-table", () => {
  it("places each operator but those below a collapsed one, its lines as thick as its rows [DESIGN] D54", () => {
    const roots = physicalRoots(ANALYZED);
    expect(placed(roots, new Set()).map((p) => p.id)).toEqual(["0", "0.0", "0.0.0", "0.0.1"]);
    expect(placed(roots, new Set(["0.0"])).map((p) => p.id)).toEqual(["0", "0.0"]);
    expect(rowsOf(must(roots[0]))).toBe(4);
    expect(thickness(0, 0)).toBe(1);
    expect(thickness(100, 100)).toBe(9);
    const flow = flowOf(roots, { collapsed: new Set(["0.0"]), chosen: "0", search: "nested" });
    expect(flow.edges.map((e) => [e.source, e.target])).toEqual([["0.0", "0"]]);
    expect(flow.nodes.map((n) => [n.data.chosen, n.data.matched, n.data.collapsed])).toEqual([
      [true, false, false],
      [false, true, true],
    ]);
    expect(flow.nodes[1]?.data.share).toBeCloseTo(6 / 9);
    expect(barShare(null, 4)).toBe(0);
    expect(barShare(4, 4)).toBe(1);
    expect(barShare(0, 0)).toBe(0);
  });

  it("sorts its rows by a column, descending then ascending, a row of none last, and marks what the other plan lacks [DESIGN] D54", () => {
    const rows = tableRows(physicalRoots(ANALYZED));
    expect(sortedRows(rows, { by: "time", descending: true }).map((r) => r.node.operator)).toEqual([
      "IndexNestedLoop",
      "SeqScan",
      "Project",
      "Filter",
    ]);
    expect(sortedRows(rows, { by: "probes", descending: false })[0]?.node.operator).toBe("IndexNestedLoop");
    expect(sortedRows(rows, null)).toEqual(rows);
    const before = physicalRoots(PARALLEL);
    const marked = changed(physicalRoots(ANALYZED), before);
    expect([...marked].map(signature)).toHaveLength(4);
    expect(changed(before, before).size).toBe(0);
    render(
      <PlanTable
        roots={physicalRoots(ANALYZED)}
        label="Plan"
        chosen="0.0"
        changed={marked}
        onChoose={() => undefined}
      />,
    );
    const time = screen.getByRole("button", { name: "Time (ms)" });
    fireEvent.click(time);
    expect(screen.getAllByRole("row")[1]?.textContent).toContain("IndexNestedLoop");
    fireEvent.click(time);
    fireEvent.click(time);
    expect(screen.getAllByRole("row")[1]?.textContent).toContain("Project");
    expect(document.querySelector(".plan-chosen")?.textContent).toContain("IndexNestedLoop");
    expect(screen.getByText("67%")).toBeTruthy();
  });

  it("draws an operator's node of its kind, reads, figures, bars and heat [DESIGN] D54", () => {
    const node = must(physicalRoots(ANALYZED)[0]?.children[0]);
    const props = {
      id: "0.0",
      type: "operator",
      selected: false,
      dragging: false,
      zIndex: 0,
      isConnectable: false,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
      deletable: false,
      selectable: true,
      draggable: false,
    };
    render(
      <ReactFlowProvider>
        <OperatorNode
          {...(props as unknown as NodeProps)}
          data={{ node, id: "0.0", share: 0.5, chosen: true, matched: true, collapsed: true }}
        />
        <OperatorNode
          {...(props as unknown as NodeProps)}
          data={{ node: must(node.children[1]), id: "x", share: null, chosen: false, matched: false, collapsed: false }}
        />
      </ReactFlowProvider>,
    );
    expect(screen.getByText("ANN.PARTS by ANN.PARTS.UNIQUE1")).toBeTruthy();
    expect(screen.getByText("est. 1 · actual 4 · probes 20000 · 8 ms")).toBeTruthy();
    expect(screen.getByLabelText("Estimated 1, actual 4")).toBeTruthy();
    expect(document.querySelector(".flow-never")?.textContent).toContain("never run");
    cleanup();
    render(
      <PlanGraph
        roots={physicalRoots(ANALYZED)}
        collapsed={new Set()}
        chosen={null}
        search=""
        onChoose={() => undefined}
        onCollapse={() => undefined}
      />,
    );
    expect(screen.getByRole("figure", { name: "The plan's flow: 4 operators" })).toBeTruthy();
  });
});

describe("the plan viewer", () => {
  it("shows the summary, the stages as tabs, the tree-table, a node's details, the rewrites and the raw text to copy [DESIGN] D54", async () => {
    catalogBackend({ catalog_table: () => refused() });
    const store = await opened();
    const id = openWorksheet(store, "SELECT 1");
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: (t: string) => Promise.resolve(copied.push(t)) },
      configurable: true,
    });
    within(store, <PlanViewer id={id} plans={[PARALLEL]} />);
    await settle();
    expect(screen.getByRole("region", { name: "Summary of the plan" }).textContent).toContain(
      "Not run: estimates alone",
    );
    expect(screen.getByRole("figure")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Tree-Table" }));
    fireEvent.click(screen.getAllByRole("row")[1] ?? document.body);
    expect(screen.getByRole("complementary", { name: "Operator" }).textContent).toContain("Project SUM(PARTS.ID)");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("radio", { name: "Flow" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search the plan" }), { target: { value: "scan" } });
    fireEvent.click(screen.getByRole("tab", { name: "bound" }));
    fireEvent.click(screen.getByRole("tab", { name: "rewrites" }));
    expect(screen.getByText("No rewrite rule changed the plan.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show raw" }));
    expect(screen.getByLabelText("Raw plan").textContent).toContain("Parallel  (degree=2)");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await settle();
    expect(copied[0]).toContain("-- physical:");
    fireEvent.click(screen.getByRole("checkbox", { name: "Show raw" }));
    expect(screen.getByRole("tab", { name: "physical", selected: true })).toBeTruthy();
  });

  it("compares the plan before with the latest, opens raw first if the settings say, and says there is none yet [DESIGN] D54", async () => {
    catalogBackend({ catalog_table: () => refused() });
    const store = await opened();
    const id = openWorksheet(store, "SELECT 1");
    changeWorksheet(store, id, (w) => ({ ...w, whatIf: "I" }));
    within(store, <PlanViewer id={id} plans={[PARALLEL, ANALYZED]} />);
    await settle();
    expect(screen.getByRole("table", { name: "The plan with the index I, dropped after" })).toBeTruthy();
    expect(document.querySelectorAll(".plan-changed").length).toBeGreaterThan(0);
    expect(screen.getByRole("list", { name: "Warnings" }).textContent).toContain("PLAN-MANY-PROBES");
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare with the plan before" }));
    fireEvent.click(screen.getByRole("tab", { name: "rewrites" }));
    cleanup();
    act(() => {
      store.update((now) => ({ ...now, settings: { ...now.settings, planView: "raw" } }));
    });
    within(store, <PlanViewer id={id} plans={[ANALYZED]} />);
    expect(screen.getByRole("tab", { name: "raw", selected: true })).toBeTruthy();
    cleanup();
    within(store, <PlanViewer id={id} plans={[]} />);
    expect(screen.getByText(/^No plan yet/u)).toBeTruthy();
    cleanup();
    act(() => {
      store.update((now) => ({ ...now, settings: { ...now.settings, planView: "visual" } }));
    });
    within(store, <PlanViewer id={id} plans={[parsePlan(["Odd line"])]} />);
    expect(screen.getByRole("tab", { name: "plan", selected: true })).toBeTruthy();
  });

  it("tells an analyzed plan's rows, time, join order and costliest, a degree and cost in the details, and a finding's fix and what-if [DESIGN] D54", async () => {
    catalogBackend({
      catalog_table: () => ({
        ...STAFF,
        name: "SALES",
        columns: [{ ...must(STAFF.columns[0]), name: "REGION" }],
        indexes: [],
      }),
    });
    const store = await opened();
    const id = openWorksheet(store, "SELECT 1");
    changeWorksheet(store, id, (w) => ({ ...w, explained: { sql: "SELECT 1", from: 0, to: 8 } }));
    const scanned = parsePlan([
      "-- physical:",
      "Project S.REGION  (est. rows=4)  (actual rows=4, time=9 ms)",
      "  Parallel  (degree=2)",
      "    Filter S.REGION = 'north'",
      "      SeqScan ANN.SALES  (rows=4, cost=3.7)  (actual rows=4, time=2 ms)",
      "-- ran: 4 rows",
    ]);
    within(store, <PlanViewer id={id} plans={[scanned]} />);
    await settle();
    const summary = screen.getByRole("region", { name: "Summary of the plan" }).textContent;
    expect(summary).toContain("Ran: 4 rows in 9 ms");
    expect(screen.getByRole("list", { name: "Costliest operators" }).textContent).toContain("ms");
    expect(screen.getByRole("list", { name: "Warnings" }).textContent).toContain("SCAN-NO-INDEX");
    fireEvent.click(screen.getByRole("button", { name: "What If…" }));
    expect(store.current().dialog?.kind).toBe("whatIf");
    fireEvent.click(screen.getByRole("button", { name: "Open Fix in Worksheet" }));
    await settle();
    expect(store.current().worksheets.at(-1)?.text).toContain("CREATE INDEX");
    fireEvent.click(screen.getByRole("radio", { name: "Tree-Table" }));
    fireEvent.click(screen.getAllByRole("row")[2] ?? document.body);
    expect(screen.getByRole("complementary", { name: "Operator" }).textContent).toContain("Degree2");
    fireEvent.click(screen.getAllByRole("row")[4] ?? document.body);
    expect(screen.getByRole("complementary", { name: "Operator" }).textContent).toContain("Cost3.7");
  });

  it("tells a data change's rows, an operator's batches, spill and index reads in its details [DOC sql/statements/explain.md EXPLAIN ANALYZE]", async () => {
    catalogBackend({ catalog_table: () => refused() });
    const store = await opened();
    const id = openWorksheet(store, "SELECT 1");
    const plan = parsePlan([
      "-- physical:",
      "Update ANN.OFFERS  (actual rows changed=50)",
      "  Sort OFFERS.PRICE  (est. rows=50)  (actual rows=50, batches=2, mean rows=25, spilled=4096 bytes, partitions=2, passes=1)",
      "    IndexScan ANN.OFFERS using OFFERS_PRICE [btree]: OFFERS.PRICE <= 50  (est. rows=51, cost=9.0)  (actual rows=50, entries=50, leaf pages=1, fetched=50)",
      "-- ran: 50 rows changed",
    ]);
    within(store, <PlanViewer id={id} plans={[plan]} />);
    await settle();
    expect(screen.getByRole("region", { name: "Summary of the plan" }).textContent).toContain("Ran: 50 rows changed");
    fireEvent.click(screen.getByRole("radio", { name: "Tree-Table" }));
    fireEvent.click(screen.getAllByRole("row")[1] ?? document.body);
    expect(screen.getByRole("complementary", { name: "Operator" }).textContent).toContain("Rows changed50");
    fireEvent.click(screen.getAllByRole("row")[2] ?? document.body);
    const sort = screen.getByRole("complementary", { name: "Operator" }).textContent;
    expect(sort).toContain("Batches2, of 25 rows on average");
    expect(sort).toContain("Spilled4096 bytes, to 2 partitions, read back in 1 passes");
    fireEvent.click(screen.getAllByRole("row")[3] ?? document.body);
    expect(screen.getByRole("complementary", { name: "Operator" }).textContent).toContain(
      "Readentries 50, fetched 50, leaf pages 1",
    );
  });

  it("tells a semi join and an antijoin, their notes, and how each searches its right [DOC sql/06-queries.md Correlated subqueries]", async () => {
    catalogBackend({ catalog_table: () => refused() });
    const store = await opened();
    const id = openWorksheet(store, "SELECT 1");
    const plan = parsePlan([
      "-- physical:",
      "HashAntiJoin S.DEPT = D.DEPT  (hashed on S.DEPT = D.DEPT)",
      "  HashSemiJoin S.ID = T.ID  (hashed on S.ID = T.ID)",
      "    SeqScan ANN.STAFF  (rows=10)",
      "    SeqScan ANN.TEAMS  (rows=5)",
      "  SeqScan ANN.DEPT  (rows=3)",
    ]);
    within(store, <PlanViewer id={id} plans={[plan]} />);
    await settle();
    const notes = screen.getByRole("list", { name: "Notes" }).textContent;
    expect(notes).toContain("PLAN-SEMI-JOIN");
    expect(notes).toContain("NOT IN keeps its meaning with nulls");
    fireEvent.click(screen.getByRole("radio", { name: "Tree-Table" }));
    fireEvent.click(screen.getAllByRole("row")[1] ?? document.body);
    const anti = screen.getByRole("complementary", { name: "Operator" }).textContent;
    expect(anti).toContain("JoinAntijoin: each row of its left that no row of its right matches");
    expect(anti).toContain("Byits right hashed, its left read against it");
    fireEvent.click(screen.getAllByRole("row")[2] ?? document.body);
    expect(screen.getByRole("complementary", { name: "Operator" }).textContent).toContain("JoinSemi join");
  });

  it("draws a phase of predicate transfer as the plan's root, says what it does, and tells a plan of none from one of it [DESIGN] D54", async () => {
    catalogBackend({ catalog_table: () => refused() });
    const store = await opened();
    const id = openWorksheet(store, "SELECT 1");
    const text = [
      "-- physical:",
      "PredicateTransfer of 3 leaves, 2 steps",
      "  Project PARTS.NAME, SUPPLIERS.CITY, OFFERS.PRICE",
      "    HashJoin PARTS.ID = OFFERS.PART  (join order by DPccp: (PARTS (OFFERS SUPPLIERS)))",
      "      SeqScan ANN.PARTS  (rows=1000, cost=1000.0)",
      "      HashJoin OFFERS.SUPPLIER = SUPPLIERS.ID",
      "        SeqScan ANN.OFFERS  (rows=5000, cost=5000.0)",
      "        Filter SUPPLIERS.CITY = 'Oslo'  (est. rows=0)",
      "          SeqScan ANN.SUPPLIERS  (rows=10, cost=10.0)",
    ];
    const plan = parsePlan(text);
    const root = must(physicalRoots(plan)[0]);
    expect([root.operator, root.detail, kindOf(root)]).toEqual([
      "PredicateTransfer",
      "of 3 leaves, 2 steps",
      "transfer",
    ]);
    expect(root.children[0]?.operator).toBe("Project");
    expect(operators(physicalRoots(plan))).toHaveLength(8);
    const without = parsePlan(
      text.filter((l) => !l.startsWith("PredicateTransfer")).map((l) => l.replace(/^ {2}/u, "")),
    );
    expect([...changed(physicalRoots(plan), physicalRoots(without))].map(signature)).toEqual([
      "PredicateTransfer of 3 leaves, 2 steps",
    ]);
    expect(changed(physicalRoots(without), physicalRoots(plan)).size).toBe(0);
    within(store, <PlanViewer id={id} plans={[plan]} />);
    await settle();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show raw" }));
    expect(document.body.textContent).toContain(text.join("\n"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show raw" }));
    fireEvent.click(screen.getByRole("radio", { name: "Tree-Table" }));
    fireEvent.click(screen.getAllByRole("row")[1] ?? document.body);
    const details = screen.getByRole("complementary", { name: "Operator" }).textContent;
    expect(details).toContain("Predicate transferReads the 3 tables of the chain of joins below it first, in 2 steps");
    expect(details).toContain("Bloom filters of the join keys");
  });

  it("tells an unnesting, a LATERAL derived table's, what it joins each row to [DESIGN] D54", async () => {
    catalogBackend({ catalog_table: () => refused() });
    const store = await opened();
    const id = openWorksheet(store, "SELECT 1");
    const plan = parsePlan([
      "-- physical:",
      "Project PA.ID, T.C",
      "  LeftOuterUnnest of 2 collections with ordinality",
      "    Unnest of 1 collections",
      "      SeqScan ANN.PA  (rows=5, cost=5.0)",
    ]);
    within(store, <PlanViewer id={id} plans={[plan]} />);
    await settle();
    fireEvent.click(screen.getByRole("radio", { name: "Tree-Table" }));
    const details = (row: number) => {
      fireEvent.click(screen.getAllByRole("row")[row] ?? document.body);
      return screen.getByRole("complementary", { name: "Operator" }).textContent;
    };
    expect(details(2)).toContain(
      "UnnestingJoins each row of its input to the rows its 2 collections give of that row, as a LATERAL derived table, UNNEST or XMLTABLE is read, each numbered; a row they give none is kept, its new columns null",
    );
    expect(details(3)).toContain(
      "the rows its collection gives of that row, as a LATERAL derived table, UNNEST or XMLTABLE is read",
    );
    expect(details(3)).not.toContain("each numbered");
  });

  it("shows what plain EXPLAIN of a data change would do as a section of its own, and none of a query [DESIGN] D70", async () => {
    catalogBackend({ catalog_table: () => refused() });
    const store = await opened();
    const id = openWorksheet(store, "SELECT 1");
    const change = parsePlan([
      "-- physical:",
      "Update ANN.PARTS",
      "  IndexScan ANN.PARTS using ANN.PARTS.UNIQUE1 [btree]: PARTS.ID = 7  (est. rows=1, cost=20.6)",
      "-- maintains: PARTS_NAME [btree]",
      "-- trigger: ANN.PART_NAMED, AFTER UPDATE OF NAME FOR EACH ROW on ANN.PARTS",
      "-- point path: one read of ANN.PARTS.UNIQUE1 when prepared or in a procedure",
    ]);
    const { unmount } = within(store, <PlanViewer id={id} plans={[change]} />);
    await settle();
    const section = screen.getByRole("region", { name: "What the change would do" }).textContent;
    expect(section).toContain("Not run: what the change would do beside the rows its plan reads.");
    expect(section).toContain("Indexes maintainedPARTS_NAME [btree]");
    expect(section).toContain("Cascadesnone");
    expect(section).toContain("TriggersANN.PART_NAMED, AFTER UPDATE OF NAME FOR EACH ROW on ANN.PARTS");
    expect(section).toContain("Point pathone read of ANN.PARTS.UNIQUE1 when prepared or in a procedure");
    unmount();
    const none = parsePlan(["-- physical:", "Insert into ANN.SALES", "-- maintains: none", "-- point path: none"]);
    const second = within(store, <PlanViewer id={id} plans={[none]} />);
    await settle();
    expect(screen.getByRole("region", { name: "What the change would do" }).textContent).toContain(
      "Indexes maintainednoneCascadesnoneTriggersnonePoint pathnone",
    );
    second.unmount();
    within(store, <PlanViewer id={id} plans={[parsePlan(["-- physical:", "SeqScan ANN.T  (rows=4, cost=3.7)"])]} />);
    await settle();
    expect(screen.queryByRole("region", { name: "What the change would do" })).toBeNull();
  });

  it("tells a mark join, what it marks and how [DOC sql/06-queries.md Correlated subqueries]", async () => {
    catalogBackend({ catalog_table: () => refused() });
    const store = await opened();
    const id = openWorksheet(store, "SELECT 1");
    const plan = parsePlan([
      "-- physical:",
      "HashMarkJoin S.DEPT = D.DEPT  (marking S.PAY > D.FLOOR)  (hashed on S.DEPT = D.DEPT)",
      "  SeqScan ANN.STAFF  (rows=10)",
      "  SeqScan ANN.DEPT  (rows=3)",
    ]);
    within(store, <PlanViewer id={id} plans={[plan]} />);
    await settle();
    fireEvent.click(screen.getByRole("radio", { name: "Tree-Table" }));
    fireEvent.click(screen.getAllByRole("row")[1] ?? document.body);
    const mark = screen.getByRole("complementary", { name: "Operator" }).textContent;
    expect(mark).toContain("JoinMark join: each row of its left once, marked true, false or unknown");
    expect(mark).toContain("MarkingS.PAY > D.FLOOR");
    expect(mark).toContain("Byits right hashed by the values its rows are matched on");
  });

  it("tells a streamed grouping, its keys and what it computes, in an aggregate's details [DOC sql/statements/explain.md EXAMPLES]", async () => {
    catalogBackend({ catalog_table: () => refused() });
    const store = await opened();
    const id = openWorksheet(store, "SELECT 1");
    const grouped = parsePlan([
      "-- physical:",
      "Aggregate streamed group by [PARTS.NAME] computing [COUNT(*)]",
      "  Aggregate group by [PARTS.ID] computing [MAX(PARTS.NAME)]",
      "    SeqScan ANN.PARTS  (rows=1000, cost=900.0)",
    ]);
    within(store, <PlanViewer id={id} plans={[grouped]} />);
    await settle();
    fireEvent.click(screen.getByRole("radio", { name: "Tree-Table" }));
    fireEvent.click(screen.getAllByRole("row")[1] ?? document.body);
    const streamed = screen.getByRole("complementary", { name: "Operator" }).textContent;
    expect(streamed).toContain("GroupingStreamed: a group made at a time");
    expect(streamed).toContain("Grouped byPARTS.NAME");
    expect(streamed).toContain("ComputingCOUNT(*)");
    fireEvent.click(screen.getAllByRole("row")[2] ?? document.body);
    expect(screen.getByRole("complementary", { name: "Operator" }).textContent).toContain(
      "GroupingOf its input in any order",
    );
  });

  it("shows a range join's icon, and what it is sorted on, grouped and pruned by in its details [DOC sql/statements/explain.md DESCRIPTION]", async () => {
    catalogBackend({ catalog_table: () => refused() });
    const store = await opened();
    const id = openWorksheet(store, "SELECT 1");
    const ranged = parsePlan([
      "-- physical:",
      "LeftRangeJoin A.T < B.T AND A.K = B.K  (sorted on B.T within B.K, pruned by B.U)  (est. rows=10)",
      "  SeqScan ANN.A  (rows=5)",
      "  SeqScan ANN.B  (rows=9)",
    ]);
    within(store, <PlanViewer id={id} plans={[ranged]} />);
    await settle();
    fireEvent.click(screen.getByRole("radio", { name: "Tree-Table" }));
    fireEvent.click(screen.getAllByRole("row")[1] ?? document.body);
    const details = screen.getByRole("complementary", { name: "Operator" }).textContent;
    expect(details).toContain("Sorted onB.T");
    expect(details).toContain("Grouped byB.K");
    expect(details).toContain("Pruned byB.U");
    fireEvent.click(screen.getAllByRole("row")[2] ?? document.body);
    expect(screen.getByRole("complementary", { name: "Operator" }).textContent).not.toContain("Sorted on");
  });

  it("has Explain and Explain Analyze of the registry, and compares only when asked where no what-if ran [DESIGN] D54", async () => {
    catalogBackend({ catalog_table: () => refused() });
    const store = await opened();
    const id = openWorksheet(store, "SELECT 1");
    within(
      store,
      <CommandContextOf.Provider value={{ store, resetLayout: () => undefined }}>
        <PlanViewer id={id} plans={[PARALLEL, PARALLEL]} />
      </CommandContextOf.Provider>,
    );
    await settle();
    expect(screen.getByRole("button", { name: "Explain Analyze" })).toBeTruthy();
    expect(screen.getByText("Explain Analyze runs the statement.")).toBeTruthy();
    expect(screen.getByRole("figure")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare with the plan before" }));
    expect(screen.getByRole("table", { name: "The plan before" })).toBeTruthy();
    expect(document.querySelectorAll(".plan-changed")).toHaveLength(0);
  });
});

/** A refusal of the backend. */
function refused(): Promise<never> {
  return Promise.reject(new Error("no"));
}
