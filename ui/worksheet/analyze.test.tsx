import { fireEvent, render, screen } from "@testing-library/react";
import { analyzeChange, changesData } from "../state/analyzeChange";
import { Store, StoreContext } from "../state/store";
import { openWorksheet } from "../state/worksheets";
import { SESSION } from "../test/backend";
import { catalogBackend, opened, settle } from "../test/catalog";
import { AnalyzeChangeDialog } from "./AnalyzeChangeDialog";

describe("Explain Analyze of a data change", () => {
  it("is known of a data change alone [DESIGN] D61", () => {
    expect(changesData({ sql: "DELETE FROM T WHERE A = 1", from: 0, to: 1, class: "writeRows" })).toBe(true);
    expect(
      changesData({ sql: "SELECT * FROM FINAL TABLE (INSERT INTO T VALUES (1))", from: 0, to: 1, class: "writeRows" }),
    ).toBe(false);
    expect(changesData({ sql: "UPDATE T SET A = 1", from: 0, to: 1, class: "read" })).toBe(false);
  });

  it("rolls back to its savepoint inside a transaction open, which goes on [DESIGN] D61", async () => {
    const asked = catalogBackend({
      run_statement: () => ({
        kind: "ran",
        answer: { outcome: null, warnings: [], serverTime: null, session: SESSION },
      }),
      session_state: () => SESSION,
    });
    const store = await opened();
    store.update((now) => ({
      ...now,
      open: now.open.map((c) => ({
        ...c,
        session: { ...c.session, transaction: { active: true, autocommit: false, readOnly: false } },
      })),
    }));
    const id = openWorksheet(store, "");
    store.update((now) => ({
      ...now,
      worksheets: now.worksheets.map((w) => (w.id === id ? { ...w, connection: 1 } : w)),
    }));
    await analyzeChange(store, id, { sql: "DELETE FROM T WHERE A = 1", from: 0, to: 1, class: "writeRows" }, false);
    await settle();
    const sent = asked
      .filter((a) => a.command === "run_statement" || a.command === "set_autocommit")
      .map((a) => a.args["sql"]);
    expect(sent).toEqual([
      "SAVEPOINT STUDIO_ANALYZE",
      "EXPLAIN ANALYZE DELETE FROM T WHERE A = 1",
      "ROLLBACK TO SAVEPOINT STUDIO_ANALYZE",
      "RELEASE SAVEPOINT STUDIO_ANALYZE",
    ]);
  });

  it("says it changes data, its first choice the setting's, and offers plain EXPLAIN instead [DESIGN] D61 D70", () => {
    const store = new Store();
    const chosen: (string | null)[] = [];
    const shown = (keeps: boolean) => {
      store.update((now) => ({ ...now, settings: { ...now.settings, analyzeKeepsChanges: keeps } }));
      return render(
        <StoreContext.Provider value={store}>
          <AnalyzeChangeDialog sql="UPDATE T SET A = 1" answer={(c) => chosen.push(c)} />
        </StoreContext.Provider>,
      );
    };
    const { unmount } = shown(false);
    expect(screen.getByText(/runs this statement for real/u)).toBeTruthy();
    expect(document.activeElement?.textContent).toBe("Analyze, Then Roll Back");
    fireEvent.click(screen.getByRole("button", { name: "Analyze, Then Roll Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Analyze and Keep Changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(/Explain Without Running shows its plan and what it would do/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Explain Without Running" }));
    unmount();
    shown(true);
    expect(document.activeElement?.textContent).toBe("Analyze and Keep Changes");
    expect(chosen).toEqual(["rollBack", "keep", null, "explain"]);
  });
});
