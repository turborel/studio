import { act, fireEvent, render, screen } from "@testing-library/react";
import { mockBackend } from "../test/backend";
import { settle } from "../test/catalog";
import { Store } from "../state/store";
import { loadAll } from "../state/actions";
import { StoreContext } from "../state/store";
import { NoticeBanner } from "./ErrorBanner";
import { FailureBoundary, failureDetails, watchFailures } from "./Failure";

/** A part of the window that fails as it is drawn. */
function Failing(): never {
  throw new TypeError("Attempted to assign to readonly property.");
}

describe("a failure the window did not handle", () => {
  it("shows a panel in place of the window, and keeps the failure in the log [DESIGN] D49", async () => {
    const asked = mockBackend({ log_failure: () => null, forget_layout: () => null });
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: (t: string) => Promise.resolve(written.push(t)) },
      configurable: true,
    });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <FailureBoundary>
        <Failing />
      </FailureBoundary>,
    );
    quiet.mockRestore();
    expect(screen.getByRole("heading", { name: "Turborel Studio met a failure" })).toBeTruthy();
    expect(screen.getByText(/^TypeError: Attempted to assign to readonly property\./u)).toBeTruthy();
    await settle();
    expect(String(asked.find((a) => a.command === "log_failure")?.args["text"])).toContain(
      "TypeError: Attempted to assign",
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy Details" }));
    await settle();
    expect(written[0]).toContain("TypeError");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset Layout and Reload" }));
    await settle();
    expect(asked.some((a) => a.command === "forget_layout")).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("tells a failure of a script or a promise in the banner, and keeps it [DESIGN] D49", async () => {
    const asked = mockBackend({ log_failure: () => null });
    const told: string[] = [];
    const stop = watchFailures((e) => told.push(e.message));
    window.dispatchEvent(new ErrorEvent("error", { error: new RangeError("too far"), message: "too far" }));
    window.dispatchEvent(new ErrorEvent("error", { message: "a message alone" }));
    const rejected = (reason: unknown) => {
      const event = new Event("unhandledrejection") as PromiseRejectionEvent;
      Object.defineProperty(event, "reason", { value: reason });
      window.dispatchEvent(event);
    };
    rejected({ message: "not allowed" });
    rejected(new Error("an error"));
    rejected("a text");
    stop();
    window.dispatchEvent(new ErrorEvent("error", { message: "after" }));
    expect(told).toEqual(["RangeError: too far", "a message alone", "not allowed", "Error: an error", "a text"]);
    await settle();
    expect(asked.filter((a) => a.command === "log_failure")).toHaveLength(5);
    expect(failureDetails("x", "in App")).toBe("x\\nin App".replace("\\n", "\n"));
  });
});

describe("loading the window's state", () => {
  it("keeps each part that came when another did not, and tells the files set aside [DESIGN] D49", async () => {
    let told = 0;
    mockBackend({
      list_queries: () => Promise.reject(new Error("queries.json: no")),
      sql_words: () => ["SELECT"],
      set_aside_notices: () => {
        told += 1;
        return told === 1 ? ["/c/queries.json did not fit, so Studio set it aside"] : [];
      },
    });
    const store = new Store();
    await loadAll(store);
    expect(store.current().reservedWords).toEqual(["SELECT"]);
    expect(store.current().error?.message).toBe("queries.json: no");
    expect(store.current().notices).toEqual(["/c/queries.json did not fit, so Studio set it aside"]);
    render(
      <StoreContext.Provider value={store}>
        <NoticeBanner />
      </StoreContext.Provider>,
    );
    expect(screen.getByText("/c/queries.json did not fit, so Studio set it aside")).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    });
    expect(store.current().notices).toEqual([]);
    mockBackend({ set_aside_notices: () => Promise.reject(new Error("gone")) });
    await loadAll(store);
    expect(store.current().notices).toEqual([]);
  });
});
