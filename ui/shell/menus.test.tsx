import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import type { CommandContext } from "../commands/commands";
import { rowMenu } from "../explorer/CatalogTree";
import { argumentOf, newWorksheetOn, uriOf } from "../explorer/menus";
import { nodeId, type TreeRow } from "../explorer/tree";
import { catalogBackend, must, opened, settle, within } from "../test/catalog";
import { SESSION } from "../test/backend";
import { worksheetOf } from "../state/worksheets";
import type { Store } from "../state/store";
import { CommandContextOf, commandEntry, type MenuEntry, type MenuItem, openMenu, useMenu } from "./ContextMenu";
import { openMenuOf, savedMenu } from "./ConnectionsPanel";

/** The entry `path` names, through submenus, of `items`. */
function entry(items: readonly MenuItem[], ...path: string[]): MenuEntry {
  const [first, ...rest] = path;
  const found = items.find((i): i is MenuEntry => i !== "separator" && i.label === first);
  if (found === undefined) {
    throw new Error(`no item ${String(first)} in ${items.map((i) => (i === "separator" ? "-" : i.label)).join(", ")}`);
  }
  return rest.length === 0 ? found : entry(found.items ?? [], ...rest);
}

/** Runs the entry `path` names, and lets what it asked of the backend settle. */
async function choose(items: readonly MenuItem[], ...path: string[]): Promise<void> {
  await act(async () => {
    await entry(items, ...path).run?.();
  });
  await settle();
}

/** A row of the catalog's tree, of `id`'s parts, selecting `select`. */
function row(parts: string[], extra: Partial<TreeRow> = {}): TreeRow {
  return { id: nodeId(...parts), label: parts.at(-1) ?? "", depth: 0, expandable: false, expanded: false, ...extra };
}

/** The statements run, in order. */
function sent(asked: { command: string; args: Record<string, unknown> }[]): unknown[] {
  return asked.filter((a) => a.command === "run_statement").map((a) => a.args["sql"]);
}

/** A store of connection 1 open, its backend running each statement, giving the clipboard's text. */
async function setUp() {
  const asked = catalogBackend({
    catalog_graphs: () => [],
    split_script: (args) => [
      {
        from: 0,
        to: String(args["text"]).length,
        statement: {
          text: args["text"],
          class: "read",
          destroys: null,
          floor: null,
          readWrite: false,
          connects: false,
        },
      },
    ],
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
  const copied: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: (t: string) => Promise.resolve(copied.push(t)) },
    configurable: true,
  });
  const store = await opened();
  store.update((now) => ({ ...now, reservedWords: ["SELECT"] }));
  return { asked, store, copied };
}

/** Answers the question the store's dialog asks with `value`. */
function answer(store: Store, value: string | null): void {
  const dialog = store.current().dialog;
  if (dialog?.kind !== "prompt") {
    throw new Error("no question asked");
  }
  dialog.answer(value);
}

describe("the explorer's menus", () => {
  it("run a procedure's IN parameter of a default as DEFAULT, its default told in a comment that cannot end early [DESIGN] D71", () => {
    const of = (mode: string, def: string | null) =>
      argumentOf({ mode, name: "N", typeWritten: "INTEGER", default: def });
    expect(of("IN", null)).toBe("?");
    expect(of("IN", "5")).toBe("DEFAULT /* 5 */");
    expect(of("INOUT", "5")).toBe("?");
    expect(of("OUT", null)).toBe("?");
    expect(of("IN", "'*/ DROP TABLE T; /*'")).toBe("DEFAULT");
    expect(of("IN", "'/* a'")).toBe("DEFAULT");
  });

  it("of a table: open its data, script it, copy its names, rename and drop it through the guards [DESIGN] D53", async () => {
    const { asked, store, copied } = await setUp();
    const items = rowMenu(
      store,
      1,
      row(["table", "ANN", "STAFF"], { select: { kind: "table", schema: "ANN", name: "STAFF" } }),
    );
    await choose(items, "Open Data");
    expect(sent(asked).at(-1)).toBe("SELECT * FROM ANN.STAFF FETCH FIRST 200 ROWS ONLY");
    await choose(items, "Copy Name");
    await choose(items, "Copy Qualified Name");
    expect(copied).toEqual(["STAFF", "ANN.STAFF"]);
    await choose(items, "Script As", "SELECT", "To Worksheet");
    expect(store.current().worksheets.at(-1)?.title).toBe("SELECT");
    await choose(items, "Script As", "CREATE", "To Clipboard");
    expect(copied.at(-1)).toContain('"table"');
    const renaming = entry(items, "Rename…").run?.();
    await settle();
    answer(store, "CREW");
    await act(async () => {
      await renaming;
    });
    await settle();
    expect(sent(asked).at(-1)).toBe("ALTER TABLE ANN.STAFF RENAME TO CREW");
    expect(entry(items, "Drop Table").destructive).toBe(true);
    await choose(items, "Drop Table");
    expect(sent(asked).at(-1)).toBe("DROP TABLE ANN.STAFF RESTRICT");
    for (const label of ["Open Data Filtered…", "Alter Table…", "Import…", "Export…", "Compare Rows…"]) {
      await choose(items, label);
      expect(store.current().dialog?.kind).toBe("data");
    }
    await choose(items, "Indexes…");
    expect(store.current().dialog).toMatchObject({ kind: "analyzer", table: "STAFF", tab: "indexes" });
    await choose(items, "Analyze Table…");
    await choose(items, "Properties");
    expect(store.current().selected?.object).toEqual({ kind: "table", schema: "ANN", name: "STAFF" });
    await choose(items, "Dependencies");
    await choose(items, "Refresh");
    expect(asked.filter((a) => a.command === "catalog_table").length).toBeGreaterThan(0);
  });

  it("of a view, a schema, a table's parts and other objects: their fitting subsets [DESIGN] D53", async () => {
    const { asked, store, copied } = await setUp();
    const view = rowMenu(
      store,
      1,
      row(["table", "ANN", "PAYROLL"], { select: { kind: "table", schema: "ANN", name: "PAYROLL" }, icon: "view" }),
    );
    expect(() => entry(view, "Rename…")).toThrow();
    await choose(view, "Drop View");
    expect(sent(asked).at(-1)).toBe("DROP VIEW ANN.PAYROLL RESTRICT");
    const schema = rowMenu(store, 1, row(["schema", "ANN"], { select: { kind: "schema", schema: "ANN" } }));
    for (const label of ["Create Table…", "Generate Script…", "Compare Schema…"]) {
      await choose(schema, label);
      expect(store.current().dialog?.kind).toBe("data");
    }
    await choose(schema, "Analyze Schema…");
    expect(store.current().dialog?.kind).toBe("analyzer");
    await choose(schema, "Open Model");
    expect(store.current().models).toHaveLength(1);
    await choose(schema, "Properties");
    await choose(schema, "Refresh");
    const column = rowMenu(store, 1, row(["column", "ANN", "STAFF", "AGE"]));
    await choose(column, "Drop Column");
    expect(sent(asked).at(-1)).toBe("ALTER TABLE ANN.STAFF DROP COLUMN AGE RESTRICT");
    const renaming = entry(column, "Rename Column…").run?.();
    await settle();
    answer(store, null);
    await act(async () => {
      await renaming;
    });
    expect(sent(asked).at(-1)).toBe("ALTER TABLE ANN.STAFF DROP COLUMN AGE RESTRICT");
    await choose(rowMenu(store, 1, row(["constraint", "ANN", "STAFF", "STAFF_AGE"])), "Drop Constraint");
    await choose(rowMenu(store, 1, row(["index", "ANN", "STAFF", "STAFF_BY_AGE"])), "Drop Index");
    await choose(rowMenu(store, 1, row(["trigger", "ANN", "STAFF", "STAFF_LOG"])), "Drop Trigger");
    await choose(rowMenu(store, 1, row(["trigger", "ANN", "STAFF", "STAFF_LOG"])), "Properties");
    expect(sent(asked).slice(-3)).toEqual([
      "ALTER TABLE ANN.STAFF DROP CONSTRAINT STAFF_AGE RESTRICT",
      "DROP INDEX STAFF_BY_AGE",
      "DROP TRIGGER ANN.STAFF_LOG",
    ]);
    const routine = rowMenu(
      store,
      1,
      row(["routine", "ANN", "0", "DOUBLED"], {
        select: { kind: "routine", schema: "ANN", name: "DOUBLED", specific: "DOUBLED_1" },
      }),
    );
    const executing = entry(routine, "Execute…").run?.();
    await settle();
    const values = store.current().dialog;
    if (values?.kind === "values") {
      values.answer(null);
    }
    await act(async () => {
      await executing;
    });
    expect(store.current().worksheets.at(-1)?.text).toBe("VALUES (ANN.DOUBLED(?))");
    await choose(routine, "Drop Routine");
    expect(sent(asked).at(-1)).toBe("DROP SPECIFIC ROUTINE ANN.DOUBLED_1 RESTRICT");
    await choose(routine, "Copy Name");
    expect(copied.at(-1)).toBe("DOUBLED");
    await choose(routine, "Properties");
    const sequence = rowMenu(
      store,
      1,
      row(["sequence", "ANN", "0", "ORDER_NO"], { select: { kind: "sequence", schema: "ANN", name: "ORDER_NO" } }),
    );
    await choose(sequence, "Drop Sequence");
    expect(sent(asked).at(-1)).toBe("DROP SEQUENCE ANN.ORDER_NO RESTRICT");
    await choose(sequence, "Properties");
    expect(rowMenu(store, 1, row(["folder", "ANN", "Tables"]))).toEqual([]);
  });

  it("of a connection: a new worksheet on it, its schema set, its URI copied with no password, and the saved one deleted when its name is typed [DESIGN] D53", async () => {
    const { asked, store, copied } = await setUp();
    const open = must(store.current().open[0]);
    const items = openMenuOf(store, open);
    await choose(items, "New Worksheet");
    expect(worksheetOf(store.current(), store.current().activeWorksheet)?.connection).toBe(1);
    await act(async () => {
      await newWorksheetOn(store, 1, "OTHER");
    });
    await settle();
    expect(sent(asked).at(-1)).toBe("SET SCHEMA 'OTHER'");
    await choose(items, "Copy URI");
    expect(copied.at(-1)).toMatch(/^turborel:\/\//u);
    await choose(items, "Refresh Catalog");
    await choose(items, "Analyze Schema…");
    await choose(items, "Edit Connection…");
    expect(store.current().dialog?.kind).toBe("connection");
    await choose(items, "Reconnect");
    const saved = must(store.current().saved.connections[0]).connection;
    const own = savedMenu(store, saved);
    await choose(own, "Pin");
    const deleting = entry(own, "Delete…").run?.();
    await settle();
    answer(store, saved.name);
    await act(async () => {
      await deleting;
    });
    await settle();
    expect(asked.some((a) => a.command === "delete_saved_connection")).toBe(true);
    await choose(items, "Disconnect");
  });

  it("let a rename go that is answered with nothing, rename a column, and call a procedure [DESIGN] D53", async () => {
    const { asked, store } = await setUp();
    catalogBackend({
      catalog_graphs: () => [],
      catalog_routine: () => ({
        schema: "ANN",
        specific: "P_1",
        name: "P",
        kind: "PROCEDURE",
        returns: null,
        parameters: [],
        body: null,
        deterministic: false,
        dataAccess: "MODIFIES SQL DATA",
        privileges: [],
      }),
      split_script: (args) => [
        {
          from: 0,
          to: String(args["text"]).length,
          statement: {
            text: args["text"],
            class: "read",
            destroys: null,
            floor: null,
            readWrite: false,
            connects: false,
          },
        },
      ],
      run_statement: (args) => {
        asked.push({ command: "run_statement", args });
        return {
          kind: "ran",
          answer: {
            outcome: { kind: "done", sqlcode: 0, sqlstate: "00000", rowsAffected: null, generated: [] },
            warnings: [],
            serverTime: null,
            session: SESSION,
          },
        };
      },
    });
    const table = rowMenu(
      store,
      1,
      row(["table", "ANN", "STAFF"], { select: { kind: "table", schema: "ANN", name: "STAFF" } }),
    );
    const renaming = entry(table, "Rename…").run?.();
    await settle();
    answer(store, null);
    await act(async () => {
      await renaming;
    });
    const column = rowMenu(store, 1, row(["column", "ANN", "STAFF", "AGE"]));
    const naming = entry(column, "Rename Column…").run?.();
    await settle();
    answer(store, "YEARS");
    await act(async () => {
      await naming;
    });
    await settle();
    expect(sent(asked).at(-1)).toBe("ALTER TABLE ANN.STAFF RENAME COLUMN AGE TO YEARS");
    const procedure = rowMenu(
      store,
      1,
      row(["routine", "ANN", "0", "P"], { select: { kind: "routine", schema: "ANN", name: "P", specific: "P_1" } }),
    );
    await choose(procedure, "Execute…");
    expect(sent(asked).at(-1)).toBe("CALL ANN.P()");
  });

  it("of a connection pinned, unsaved, or not deleted by a name mistyped [DESIGN] D53", async () => {
    const { asked, store } = await setUp();
    const saved = { ...must(store.current().saved.connections[0]).connection, pinned: true };
    expect(entry(savedMenu(store, saved), "Unpin").label).toBe("Unpin");
    const deleting = entry(savedMenu(store, saved), "Delete…").run?.();
    await settle();
    answer(store, "not its name");
    await act(async () => {
      await deleting;
    });
    expect(asked.some((a) => a.command === "delete_saved_connection")).toBe(false);
    const unsaved = { ...must(store.current().open[0]), savedId: null, session: { ...SESSION, schema: null } };
    expect(() => entry(openMenuOf(store, unsaved), "Copy URI")).toThrow();
    await choose(openMenuOf(store, unsaved), "Analyze Schema…");
    expect(store.current().dialog).toMatchObject({ kind: "analyzer", schema: "ANN" });
  });

  it("write a connection's URI of its settings, with no password [DESIGN] D53", () => {
    expect(uriOf({ uri: "turborel://ann:secret@db:7000/?tls_mode=require" })).toBe(
      "turborel://ann@db:7000/?tls_mode=require",
    );
    expect(uriOf({ host: "db1, /run/t.sock", user: "a b", port: "7500", tlsMode: "verify-full", serverName: "" })).toBe(
      "turborel://a%20b@db1,%2Frun%2Ft.sock/?port=7500&tls_mode=verify-full",
    );
    expect(uriOf({ host: "db" })).toBe("turborel://db");
  });
});

/** An element of a menu of `items`, opened by its button or its keys. */
function Opener({ items }: { readonly items: readonly MenuItem[] }) {
  const menu = useMenu(() => items);
  return (
    <button type="button" {...menu}>
      Open
    </button>
  );
}

describe("a context menu", () => {
  it("is moved through by the arrows, past lines and the disabled, opens a submenu, and runs what is chosen [DESIGN] D53", async () => {
    const { store } = await setUp();
    const ran: string[] = [];
    const items: MenuItem[] = [
      { label: "First", icon: "copy", key: "Mod+C", run: () => ran.push("first") },
      "separator",
      { label: "Off", disabled: true },
      { label: "More", items: [{ label: "Inner", run: () => ran.push("inner") }] },
      { label: "Drop", destructive: true, run: () => ran.push("drop") },
    ];
    within(store, <Opener items={items} />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.keyDown(opener, { key: "a" });
    expect(store.current().menu).toBeNull();
    fireEvent.keyDown(opener, { key: "F10", shiftKey: true });
    const menu = screen.getByRole("menu", { name: "Context menu" });
    expect(document.activeElement?.textContent).toContain("First");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("More");
    fireEvent.keyDown(menu, { key: "ArrowRight" });
    expect(screen.getByRole("menu", { name: "More" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu", { name: "More" }), { key: "Enter" });
    expect(ran).toEqual(["inner"]);
    expect(document.activeElement).toBe(opener);
    fireEvent.contextMenu(opener);
    const again = screen.getByRole("menu", { name: "Context menu" });
    fireEvent.keyDown(again, { key: "End" });
    expect(document.activeElement?.className).toContain("context-destructive");
    fireEvent.keyDown(again, { key: "Home" });
    fireEvent.keyDown(again, { key: "ArrowUp" });
    fireEvent.keyDown(again, { key: " " });
    expect(ran).toEqual(["inner", "drop"]);
    openMenu(store, { x: 5, y: 5 }, items);
    await settle();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(store.current().menu).toBeNull();
    act(() => {
      openMenu(store, { x: 5, y: 5 }, items);
    });
    fireEvent.click(must(document.querySelector(".menu-backdrop")));
    expect(store.current().menu).toBeNull();
    act(() => {
      openMenu(store, { x: 5, y: 5 }, items);
    });
    fireEvent.contextMenu(must(document.querySelector(".menu-backdrop")));
    expect(store.current().menu).toBeNull();
    cleanup();
  });

  it("takes a command's name, icon, key and whether it can run from the registry [DESIGN] D53", async () => {
    const { store } = await setUp();
    const context: CommandContext = { store, resetLayout: () => undefined };
    const made = commandEntry("worksheet.new", context);
    expect([made.label, made.icon, made.key, made.disabled]).toEqual(["New Worksheet", "newWorksheet", "Mod+N", false]);
    await act(async () => {
      await made.run?.();
    });
    expect(store.current().worksheets).toHaveLength(1);
    expect(commandEntry("worksheet.complete", context).disabled).toBe(true);
    expect(commandEntry("no.such", null, "Named").label).toBe("Named");
    within(
      store,
      <CommandContextOf.Provider value={context}>
        <Opener items={[]} />
      </CommandContextOf.Provider>,
    );
  });

  it("of nothing to choose keeps its place, and the keys of a menu wait while its submenu is open [DESIGN] D53", async () => {
    const { store } = await setUp();
    within(store, null);
    act(() => {
      openMenu(store, { x: 5000, y: 5000 }, ["separator", { label: "Off", disabled: true }]);
    });
    const menu = screen.getByRole("menu");
    for (const key of ["ArrowDown", "Home", "End", "Enter"]) {
      fireEvent.keyDown(menu, { key });
    }
    expect(store.current().menu).not.toBeNull();
    fireEvent.keyDown(menu, { key: "ArrowLeft" });
    expect(store.current().menu).toBeNull();
    act(() => {
      openMenu(store, { x: 5, y: 5 }, [{ label: "More", items: [{ label: "Inner" }] }]);
    });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("menu", { name: "Context menu" }), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("menu", { name: "More" }), { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "More" })).toBeNull();
    expect(commandEntry("worksheet.new", null).run?.()).toBeUndefined();
  });
});
