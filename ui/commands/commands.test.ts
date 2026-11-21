import menuSource from "../../src-tauri/src/menu.rs?raw";
import { connectSpec } from "../state/actions";
import { Store } from "../state/store";
import { closeWorksheet, openWorksheet } from "../state/worksheets";
import { mockBackend, SESSION } from "../test/backend";
import { type CommandContext, COMMANDS, command, defaultKeys, runCommand } from "./commands";

/** A context of `store`, counting the layouts reset. */
function context(store: Store): CommandContext & { resets: number } {
  const counted = { store, resets: 0, resetLayout: () => (counted.resets += 1) };
  return counted;
}

/** A store with one connection open. */
async function connected(): Promise<Store> {
  const store = new Store();
  await connectSpec(store, "X", { user: "ann" }, { environment: "development", readOnly: false }, null);
  return store;
}

describe("the commands", () => {
  it("are each named once, and keyed once [DESIGN] D30", () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = Object.values(defaultKeys());
    expect(new Set(keys).size).toBe(keys.length);
    expect(command("nope")).toBeUndefined();
  });

  it("run a connection's commands on the active connection alone [DESIGN] D30", async () => {
    const asked = mockBackend({
      run_statement: () => ({ kind: "ran", answer: { session: SESSION } }),
      reconnect: () => SESSION,
    });
    const idle = context(new Store());
    expect(command("transaction.commit")?.enabled(idle)).toBe(false);
    await runCommand("transaction.commit", idle);
    expect(asked).toEqual([]);
    const store = await connected();
    await runCommand("analyzer.open", context(store));
    expect(store.current().dialog).toMatchObject({ kind: "analyzer", connection: 1, schema: "ANN" });
    for (const id of [
      "transaction.commit",
      "transaction.rollback",
      "statement.cancel",
      "connection.reconnect",
      "connection.disconnect",
    ]) {
      await runCommand(id, context(store));
    }
    const sent = asked.map((a) => a.command);
    expect(sent).toEqual([
      "open_connection",
      "run_statement",
      "run_statement",
      "cancel_statement",
      "reconnect",
      "close_connection",
    ]);
    expect(store.current().open).toEqual([]);
  });

  it("zoom within its bounds and choose a theme [DESIGN] D20", async () => {
    mockBackend();
    const store = new Store();
    const ctx = context(store);
    await runCommand("zoom.in", ctx);
    expect(store.current().settings.zoomPercent).toBe(110);
    await runCommand("zoom.reset", ctx);
    for (let i = 0; i < 10; i += 1) {
      await runCommand("zoom.out", ctx);
    }
    expect(store.current().settings.zoomPercent).toBe(50);
    await runCommand("theme.dark", ctx);
    expect(store.current().settings.theme).toBe("dark");
  });

  it("show each dialog, and reset the layout [DESIGN] D30", async () => {
    mockBackend();
    const store = new Store();
    const ctx = context(store);
    const shown: unknown[] = [];
    for (const id of ["connection.new", "palette.open", "settings.open", "help.about", "help.shortcuts"]) {
      await runCommand(id, ctx);
      shown.push(store.current().dialog?.kind);
    }
    expect(shown).toEqual(["connection", "palette", "settings", "about", "shortcuts"]);
    await runCommand("layout.reset", ctx);
    expect(ctx.resets).toBe(1);
  });
});

describe("the menus", () => {
  it("name only Studio's commands, each by its title [DESIGN] D30", () => {
    const items = [...menuSource.matchAll(/Some\(\("([^"]+)", "([^"]+)"\)\)/gu)].map(([, id = "", label = ""]) => [
      id,
      label,
    ]);
    expect(items.length).toBeGreaterThan(30);
    for (const [id, label] of items) {
      expect(command(id ?? "")?.title, id).toBe(label);
    }
  });
});

describe("every command", () => {
  it("runs on the active worksheet, or does nothing where it cannot [DESIGN] D30", async () => {
    mockBackend({ open_sql_file: () => null, save_text_file: () => null, keep_worksheets: () => null });
    const store = await connected();
    const sheet = openWorksheet(store, "VALUES (1)");
    const ctx = context(store);
    for (const c of COMMANDS.filter(
      (x) =>
        x.category === "Worksheet" || x.id.startsWith("worksheet.") || x.id === "file.open" || x.id === "history.open",
    )) {
      await runCommand(c.id, ctx);
    }
    expect(["history", "folders", "builder"]).toContain(store.current().dialog?.kind);
    store.update((now) => ({ ...now, dialog: null }));
    expect(store.current().worksheets.length).toBeGreaterThanOrEqual(1);
    expect(sheet).not.toBe("");
    await runCommand("statement.cancel", ctx);
    closeWorksheet(store, store.current().activeWorksheet ?? "");
    expect(command("worksheet.reopen")?.enabled(ctx)).toBe(true);
  });
});
