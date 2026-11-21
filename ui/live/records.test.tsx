import { act, fireEvent, screen } from "@testing-library/react";
import type { RecordRead, SharedTab } from "../ipc/live";
import { catalogBackend, opened, refused, settle, within } from "../test/catalog";
import { RecordsDialog } from "./RecordsDialog";
import { comparedPlans, firstPicked, found, summary } from "./summary";

/** A worksheet tab shared, of `environment`, its SQL `text` and plan `plan`, a column masked. */
function tab(environment: "development" | "production", text: string, plan: string[]): SharedTab {
  return {
    id: environment === "production" ? "p1" : "w1",
    kind: "worksheet",
    title: environment === "production" ? "Live" : "Dev",
    environment,
    values: true,
    text,
    selection: null,
    results: {
      columns: [
        { name: "NAME", typeName: "VARCHAR(9)", masked: false },
        { name: "SALARY", typeName: "INTEGER", masked: true },
      ],
      rows: [["Ada | A", null]],
      cut: true,
    },
    messages: ["1 row"],
    plan,
    document: null,
  };
}

/** A record of two moments shared, a suggestion and a viewer's coming. */
const RECORD: RecordRead = {
  head: {
    format: "turborel-studio-live-record",
    version: 1,
    session: "0f".repeat(16),
    presenter: "Ann",
    started: Date.UTC(2026, 10, 21, 9, 0),
    sealed: false,
  },
  entries: [
    { kind: "joined", at: Date.UTC(2026, 10, 21, 9, 1), by: "Bo" },
    {
      kind: "shared",
      at: Date.UTC(2026, 10, 21, 9, 2),
      by: null,
      state: {
        tabs: [
          tab("development", "SELECT NAME, SALARY FROM STAFF", ["Scan STAFF", "rows 10"]),
          tab("production", "SELECT 1", []),
        ],
        active: "w1",
        pointer: null,
        copy: false,
      },
    },
    {
      kind: "shared",
      at: Date.UTC(2026, 10, 21, 9, 3),
      by: "Bo",
      state: {
        tabs: [tab("development", "SELECT NAME FROM STAFF WHERE ID = 1", ["Index STAFF_PK", "rows 10"])],
        active: "w1",
        pointer: null,
        copy: false,
      },
    },
    { kind: "suggested", at: Date.UTC(2026, 10, 21, 9, 4), by: "Bo", tab: "w1", sql: "SELECT <script>" },
    { kind: "ended", at: Date.UTC(2026, 10, 21, 9, 5) },
  ],
};

describe("a session's record read back", () => {
  it("finds its moments, compares a tab's plans, and writes a summary of what was picked, masks kept, production's values left out [DESIGN] D67", () => {
    expect(found(RECORD, "where id")).toEqual([2]);
    expect(found(RECORD, "bo")).toEqual([0, 3]);
    expect(found(RECORD, " ")).toEqual([0, 1, 2, 3, 4]);
    expect(comparedPlans(RECORD, [1, 2], "w1")).toEqual([
      { before: "Scan STAFF", after: "Index STAFF_PK", differs: true },
      { before: "rows 10", after: "rows 10", differs: false },
    ]);
    expect(comparedPlans(RECORD, [0, 2], "w1")[0]).toEqual({ before: "", after: "Index STAFF_PK", differs: true });
    const picked = firstPicked(RECORD);
    expect([...picked]).toEqual([1, 2, 3]);
    const md = summary(RECORD, { picked, productionValues: false, conclusions: "Add an index.", format: "markdown" });
    expect(md).toContain("# Live Session of Ann");
    expect(md).toContain("## At 09:02:00");
    expect(md).toContain("```\nSELECT NAME, SALARY FROM STAFF\n```");
    expect(md).toContain("| NAME | SALARY |\n|---|---|\n| Ada \\| A | masked |");
    expect(md).toContain("A result of NAME, SALARY: its values are left out.");
    expect(md).toContain("More rows were read than are written here.");
    expect(md).toContain("## At 09:04:00, Bo suggested");
    expect(md).toContain("## Conclusions\n\nAdd an index.");
    const withValues = summary(RECORD, {
      picked: new Set([1]),
      productionValues: true,
      conclusions: "",
      format: "markdown",
    });
    expect(withValues).not.toContain("its values are left out");
    expect(withValues).not.toContain("SELECT NAME FROM STAFF WHERE ID = 1");
    const html = summary(RECORD, { picked: new Set([3]), productionValues: false, conclusions: "", format: "html" });
    expect(html).toContain("<pre><code>SELECT &lt;script&gt;</code></pre>");
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });

  it("lists the records, steps through one, opens a query, compares plans, and saves the summary previewed [DESIGN] D67", async () => {
    const asked = catalogBackend({
      live_records: () => [{ path: "/cfg/live-records/session-1.jsonl", head: RECORD.head, bytes: 900 }],
      read_live_record: () => RECORD,
      save_text_file: () => "/data/summary.md",
    });
    const store = await opened();
    within(store, <RecordsDialog />);
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /presented by Ann/u }));
      await settle();
    });
    expect(asked.find((a) => a.command === "read_live_record")?.args).toEqual({
      path: "/cfg/live-records/session-1.jsonl",
    });
    expect(screen.getByRole("region", { name: "The moment" }).textContent).toContain("Bo joined");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("tab", { name: "Dev" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } });
    expect(screen.getByRole("table", { name: "Plans compared" }).textContent).toContain("Index STAFF_PK");
    fireEvent.click(screen.getByRole("button", { name: "Open in Worksheet" }));
    expect(store.current().worksheets.at(-1)).toMatchObject({ text: "SELECT NAME, SALARY FROM STAFF", title: "Dev" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Find in the record" }), { target: { value: "<script>" } });
    fireEvent.click(screen.getByRole("button", { name: /Bo suggested/u }));
    expect(screen.getByRole("region", { name: "The moment" }).textContent).toContain("SELECT <script>");
    fireEvent.click(screen.getByRole("button", { name: "Summary for a Ticket…" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Shared by Bo/u }));
    const preview = screen.getByLabelText("Summary preview").textContent;
    expect(preview).not.toContain("WHERE ID = 1");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save Summary…" }));
      await settle();
    });
    expect(asked.find((a) => a.command === "save_text_file")?.args).toEqual({
      name: "live-session-2026-11-21.md",
      text: preview,
    });
    expect(screen.getByText("Saved as /data/summary.md.")).toBeTruthy();
  });

  it("says when no session is recorded, and why a record cannot be read [DESIGN] D67", async () => {
    let none = true;
    catalogBackend({
      live_records: () =>
        none ? [] : [{ path: "/cfg/live-records/s.jsonl", head: { ...RECORD.head, sealed: true }, bytes: 9 }],
      read_live_record: () =>
        refused({ sqlcode: -910, sqlstate: "TB910", message: "it is sealed, and the keychain holds no key for it" }),
    });
    const store = await opened();
    within(store, <RecordsDialog />);
    await settle();
    expect(screen.getByText("No session has been recorded on this machine.")).toBeTruthy();
    none = false;
    within(store, <RecordsDialog />);
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sealed/u }));
      await settle();
    });
    expect(screen.getByText("it is sealed, and the keychain holds no key for it")).toBeTruthy();
  });

  it("writes a summary of any tab: of no environment, no SQL, a long plan, no result, a column of no name, many rows [DESIGN] D67", () => {
    const plain: SharedTab = {
      ...tab(
        "development",
        "",
        Array.from({ length: 15 }, (_, n) => `step ${String(n)}`),
      ),
      environment: null,
      results: {
        columns: [{ name: null, typeName: "INTEGER", masked: false }],
        rows: Array.from({ length: 25 }, (_, n) => [n % 2 === 0 ? String(n) : null]),
        cut: false,
      },
    };
    const bare: SharedTab = { ...plain, id: "b1", title: "Bare", plan: [], results: null };
    const record: RecordRead = {
      ...RECORD,
      entries: [
        { kind: "shared", at: 0, by: null, state: { tabs: [plain, bare], active: null, pointer: null, copy: false } },
        { kind: "left", at: 1, by: "Bo" },
      ],
    };
    expect(found(record, "bo")).toEqual([1]);
    expect(comparedPlans(record, [0, 1], "w1").at(-1)).toEqual({ before: "step 14", after: "", differs: true });
    expect(comparedPlans(record, [0, 0], "none")).toEqual([]);
    const md = summary(record, {
      picked: new Set([0, 1]),
      productionValues: false,
      conclusions: " ",
      format: "markdown",
    });
    expect(md).toContain("### Dev\n");
    expect(md).toContain("… 3 lines more");
    expect(md).toContain("|  |\n|---|\n| 0 |\n| NULL |");
    expect(md).toContain("More rows were read than are written here.");
    expect(md).toContain("### Bare\n");
    expect(md).not.toContain("Conclusions");
    const html = summary(record, { picked: new Set([0]), productionValues: false, conclusions: "", format: "html" });
    expect(html).toContain("<table><tr><th></th></tr><tr><td>0</td></tr>");
  });
});
