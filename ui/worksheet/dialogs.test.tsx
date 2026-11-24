import { fireEvent, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { HistoryEntry } from "../ipc/worksheet";
import { show } from "../state/actions";
import { worksheetOf } from "../state/worksheets";
import { SESSION } from "../test/backend";
import { catalogBackend, must, opened, settle, within } from "../test/catalog";
import { CLASS_NAMES, FavouriteDialog, GuardDialog, HistoryDialog, ValuesDialog } from "./dialogs";

const ENTRY: HistoryEntry = {
  sql: "SELECT * FROM STAFF",
  at: 1,
  connection: "Orders",
  saved: "ab",
  millis: 4,
  rows: 3,
  sqlstate: "00000",
};

describe("the guards' dialog", () => {
  it("says what the script does, what it destroys and what Studio cannot tell, and answers [RULE] R-SEC-8", async () => {
    catalogBackend();
    const store = await opened();
    const answer = vi.fn();
    within(
      store,
      <GuardDialog
        confirm={{ class: "unclassified", destroys: ["DROP TABLE"], unclassified: ["CALL P()"], production: true }}
        answer={answer}
      />,
    );
    expect(screen.getByText("This is a production connection, and the script may write.")).toBeTruthy();
    expect(screen.getByText(`The script ${CLASS_NAMES.unclassified}.`)).toBeTruthy();
    expect(screen.getByText("DROP TABLE")).toBeTruthy();
    expect(screen.getByText("CALL P()").tagName).toBe("CODE");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    fireEvent.click(screen.getByRole("button", { name: "Don't Run" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(answer.mock.calls).toEqual([[true], [false], [false]]);
  });
});

describe("the values' dialog", () => {
  it("offers the values given last, each text or NULL, and the script's variables [DESIGN] D36", async () => {
    catalogBackend();
    const store = await opened();
    const answer = vi.fn();
    within(
      store,
      <ValuesDialog
        names={["a", "?2", "a"]}
        types={["NUMERIC(10,0)", "DATE", "NUMERIC(10,0)"]}
        outputs={["Parameter 4 INTEGER, OUT parameter 4"]}
        remembered={{ a: "7", s: "ANN" }}
        variables={["s"]}
        answer={answer}
      />,
    );
    expect(screen.getByLabelText<HTMLInputElement>(/^:a/u).value).toBe("7");
    expect(document.body.textContent).toContain(
      "Given back in the CALL's row, not asked for: Parameter 4 INTEGER, OUT parameter 4",
    );
    fireEvent.change(screen.getByLabelText(/^Parameter 2/u), { target: { value: "2026-01-01" } });
    fireEvent.click(must(screen.getAllByRole("checkbox", { name: "NULL" })[0]));
    fireEvent.change(screen.getByLabelText("${s}"), { target: { value: "BOB" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(answer).toHaveBeenLastCalledWith({ binds: { a: null, "?2": "2026-01-01" }, variables: { s: "BOB" } });
    fireEvent.click(must(screen.getAllByRole("checkbox", { name: "NULL" })[0]));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(answer).toHaveBeenLastCalledWith(null);
  });
});

describe("the history's dialog", () => {
  it("searches as typed, opens or runs an entry in a worksheet, and is cleared [DESIGN] D36", async () => {
    const asked = catalogBackend({
      search_history: (args) =>
        String(args["text"]) === "none" ? [] : [ENTRY, { ...ENTRY, sql: "x".repeat(130), rows: null, at: 2 }],
      clear_history: () => null,
      run_statement: () => ({
        kind: "ran",
        answer: {
          outcome: { kind: "done", sqlcode: 0, sqlstate: "00000", rowsAffected: null, generated: [] },
          warnings: [],
          serverTime: null,
          session: SESSION,
        },
      }),
    });
    const store = await opened();
    show(store, { kind: "history" });
    within(store, <HistoryDialog />);
    await settle();
    expect(screen.getByText("SELECT * FROM STAFF")).toBeTruthy();
    expect(screen.getByText(`${"x".repeat(120)}…`)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search the history"), { target: { value: "none" } });
    await settle();
    expect(screen.getByText("Nothing in the history holds that.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search the history"), { target: { value: "" } });
    await settle();
    fireEvent.click(must(screen.getAllByRole("button", { name: "Open" })[0]));
    expect(store.current().worksheets.at(-1)?.text).toBe("SELECT * FROM STAFF");
    expect(store.current().dialog).toBeNull();
    fireEvent.click(must(screen.getAllByRole("button", { name: "Run" })[0]));
    await settle();
    const ranIn = store.current().worksheets.at(-1);
    expect(ranIn === undefined ? undefined : worksheetOf(store.current(), ranIn.id)?.runs).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear History" }));
    await settle();
    expect(asked.some((a) => a.command === "clear_history")).toBe(true);
    expect(screen.getByText("Nothing in the history.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
  });

  it("shows none if the history cannot be read [DESIGN] D36", async () => {
    catalogBackend({ search_history: () => Promise.reject(new Error("unreadable")) });
    const store = await opened();
    within(store, <HistoryDialog />);
    await settle();
    expect(screen.getByText("Nothing in the history.")).toBeTruthy();
  });
});

describe("the favourite's dialog", () => {
  it("keeps the query by the name given [DESIGN] D36", async () => {
    const asked = catalogBackend({ keep_query: (args) => [args["query"]] });
    const store = await opened();
    show(store, { kind: "favourite", sql: "VALUES (1)" });
    within(store, <FavouriteDialog sql="VALUES (1)" />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Add" }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " One " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await settle();
    expect(asked.find((a) => a.command === "keep_query")?.args["query"]).toMatchObject({
      name: "One",
      sql: "VALUES (1)",
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(store.current().dialog).toBeNull();
  });
});
