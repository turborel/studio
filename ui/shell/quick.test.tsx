import { act, fireEvent, screen } from "@testing-library/react";
import type { IDockviewHeaderActionsProps } from "dockview-react";
import type { CommandContext } from "../commands/commands";
import { diagramMenu, tableNodeMenu } from "../model/menus";
import { emptyModel, modelTable } from "../model/model";
import { modelOf, openModel } from "../model/models";
import { changeWorksheet, openWorksheet, worksheetOf } from "../state/worksheets";
import { catalogBackend, must, opened, settle, STAFF, within } from "../test/catalog";
import { editorMenu, tabMenu } from "../worksheet/menus";
import { commandEntry, type MenuEntry, type MenuItem } from "./ContextMenu";
import { NewWorksheetAction } from "./Dock";
import { WelcomePanel } from "./panels";
import { prompted, PromptDialog } from "./PromptDialog";

/** The entry `path` names, through submenus, of `items`. */
function entry(items: readonly MenuItem[], ...path: string[]): MenuEntry {
  const [first, ...rest] = path;
  const found = items.find((i): i is MenuEntry => i !== "separator" && i.label === first);
  if (found === undefined) {
    throw new Error(`no item ${String(first)}`);
  }
  return rest.length === 0 ? found : entry(found.items ?? [], ...rest);
}

/** Runs the entry `path` names. */
async function choose(items: readonly MenuItem[], ...path: string[]): Promise<void> {
  await act(async () => {
    await entry(items, ...path).run?.();
  });
  await settle();
}

describe("a new worksheet a click away", () => {
  it("from the start panel, and the plus after a group's tabs of worksheets [DESIGN] D53", async () => {
    catalogBackend();
    const store = await opened();
    within(store, <WelcomePanel />);
    fireEvent.click(screen.getByRole("button", { name: "New Worksheet" }));
    expect(store.current().worksheets).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "New Connection…" }));
    expect(store.current().dialog?.kind).toBe("connection");
    const props = (ids: string[]) => ({ panels: ids.map((id) => ({ id })) }) as unknown as IDockviewHeaderActionsProps;
    within(store, <NewWorksheetAction {...props(["worksheet:a"])} />);
    fireEvent.click(screen.getAllByRole("button", { name: "New Worksheet" }).at(-1) ?? document.body);
    expect(store.current().worksheets).toHaveLength(2);
    const { container } = within(store, <NewWorksheetAction {...props(["explorer"])} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("a worksheet's menus", () => {
  it("of its tab: close it, the others or those to its right, pin, rename, duplicate and show its connection [DESIGN] D53", async () => {
    catalogBackend();
    const store = await opened();
    const [a, b, c, d] = ["A", "B", "C", "D"].map((t) => openWorksheet(store, t, t));
    const group = [must(a), must(b), must(c), must(d)];
    changeWorksheet(store, must(d), (w) => ({ ...w, pinned: true }));
    await choose(tabMenu(store, must(b), []), "Close to the Right");
    expect(store.current().worksheets).toHaveLength(4);
    await choose(tabMenu(store, must(b), group), "Close to the Right");
    expect(store.current().worksheets.map((w) => w.title)).toEqual(["A", "B", "D"]);
    await choose(tabMenu(store, must(b), group), "Pin Tab");
    expect(worksheetOf(store.current(), must(b))?.pinned).toBe(true);
    await choose(tabMenu(store, must(b), group), "Unpin Tab");
    await choose(tabMenu(store, must(b), group), "Duplicate");
    expect(store.current().worksheets.at(-1)?.title).toBe("B (copy)");
    const renaming = entry(tabMenu(store, must(b), group), "Rename…").run?.();
    await settle();
    const dialog = store.current().dialog;
    if (dialog?.kind === "prompt") {
      dialog.answer("Bee");
    }
    await act(async () => {
      await renaming;
    });
    expect(worksheetOf(store.current(), must(b))?.title).toBe("Bee");
    await choose(tabMenu(store, must(b), group), "Reveal Connection");
    expect(store.current().active).toBe(1);
    await choose(tabMenu(store, must(b), group), "Close Others");
    expect(store.current().worksheets.map((w) => w.title)).toEqual(["Bee", "D", "B (copy)"]);
    await choose(tabMenu(store, must(b), group), "Close");
    expect(tabMenu(store, must(b), group)).toEqual([]);
  });

  it("of its editor: the worksheet's commands of the registry [DESIGN] D53", async () => {
    catalogBackend();
    const store = await opened();
    openWorksheet(store, "VALUES (1)");
    const context: CommandContext = { store, resetLayout: () => undefined };
    const items = editorMenu((id) => commandEntry(id, context));
    expect(items.filter((i) => i !== "separator").map((i) => i.label)).toContain("Explain Analyze");
    expect(entry(items, "Run Statement").key).toBe("Mod+Enter");
  });
});

describe("a model's diagram menus", () => {
  it("hide a table, script it, remove it, add the tables it references, and lay the diagram out again [DESIGN] D53", async () => {
    catalogBackend({ catalog_graphs: () => [] });
    const store = await opened();
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: (t: string) => Promise.resolve(copied.push(t)) },
      configurable: true,
    });
    const staff = modelTable({
      ...STAFF,
      constraints: [
        ...STAFF.constraints,
        {
          name: "STAFF_BOSS",
          kind: "FOREIGN KEY",
          columns: ["ID"],
          check: null,
          references: {
            schema: "ANN",
            table: "BOSSES",
            columns: ["ID"],
            matching: "NONE",
            onUpdate: "NO ACTION",
            onDelete: "NO ACTION",
          },
          deferrable: false,
        },
      ],
    });
    const id = openModel(store, { ...emptyModel("M"), tables: [staff] }, { connection: 1 });
    const doc = () => must(modelOf(store.current(), id));
    const opens = { add: vi.fn(), edit: vi.fn() };
    await choose(tableNodeMenu(store, doc(), "ANN.STAFF", opens), "Edit Table…");
    expect(opens.edit).toHaveBeenCalledWith("ANN.STAFF");
    await choose(tableNodeMenu(store, doc(), "ANN.STAFF", opens), "Script As CREATE", "To Clipboard");
    expect(copied.at(-1)).toContain("CREATE TABLE ANN.STAFF");
    await choose(tableNodeMenu(store, doc(), "ANN.STAFF", opens), "Script As CREATE", "To Worksheet");
    expect(store.current().worksheets.at(-1)?.text).toContain("CREATE TABLE ANN.STAFF");
    await choose(tableNodeMenu(store, doc(), "ANN.STAFF", opens), "Add Referenced Tables");
    expect(doc().model.tables.map((t) => t.name)).toEqual(["STAFF", "STAFF"]);
    await choose(tableNodeMenu(store, doc(), "ANN.STAFF", opens), "Hide from Diagram");
    expect(doc().hidden).toEqual(["ANN.STAFF"]);
    await choose(diagramMenu(store, doc(), opens), "Show Hidden Tables");
    expect(doc().hidden).toEqual([]);
    await choose(diagramMenu(store, doc(), opens), "Lay Out Again");
    await choose(diagramMenu(store, doc(), opens), "Add Table…");
    expect(opens.add).toHaveBeenCalled();
    const none = tableNodeMenu(store, doc(), "ANN.NONE", opens);
    expect(entry(none, "Add Referenced Tables").disabled).toBe(true);
    await choose(none, "Add Referenced Tables");
    await choose(none, "Script As CREATE", "To Clipboard");
    expect(copied.at(-1)).toBe("");
    await choose(tableNodeMenu(store, doc(), "ANN.STAFF", opens), "Remove from Model");
    expect(doc().model.tables).toHaveLength(0);
  });
});

describe("a question of one line", () => {
  it("is answered by OK or Return, and let go by Cancel [DESIGN] D53", async () => {
    catalogBackend();
    const store = await opened();
    const asked = prompted(store, "Rename", "New name", "OLD");
    const d = store.current().dialog;
    if (d?.kind !== "prompt") {
      throw new Error("no question");
    }
    within(store, <PromptDialog {...d} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: " " } });
    expect(screen.getByRole("button", { name: "OK" })).toHaveProperty("disabled", true);
    fireEvent.submit(screen.getByRole("textbox"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: " NEW " } });
    fireEvent.submit(screen.getByRole("textbox"));
    expect(await asked).toBe("NEW");
    const letGo = prompted(store, "Rename", "New name");
    const e = store.current().dialog;
    if (e?.kind === "prompt") {
      within(store, <PromptDialog {...e} />);
      fireEvent.click(screen.getAllByRole("button", { name: "Cancel" }).at(-1) ?? document.body);
    }
    expect(await letGo).toBeNull();
    expect(store.current().dialog).toBeNull();
  });
});
