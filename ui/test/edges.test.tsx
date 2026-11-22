import { emit } from "@tauri-apps/api/event";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { App, MENU_EVENT } from "../App";
import { STUDIO_EVENT } from "../ipc/events";
import { CommandPalette } from "../shell/CommandPalette";
import { ConnectionDialog } from "../shell/ConnectionDialog";
import { ConnectionsPanel } from "../shell/ConnectionsPanel";
import { ContextMenu } from "../shell/ContextMenu";
import { command, runCommand } from "../commands/commands";
import { keyOf } from "../commands/keys";
import { Modal } from "../shell/Modal";
import { checkAfterWake, connectSpec } from "../state/actions";
import { Store, StoreContext, useStore } from "../state/store";
import { mockBackend, SESSION } from "./backend";

/** A component that reads the store. */
function Reader() {
  useStore();
  return null;
}

describe("the edges of the front end", () => {
  it("refuses a component rendered outside its store [DESIGN] D31", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Reader />)).toThrow("outside its store");
  });

  it("runs no command that is not, or cannot run, or has no active connection [DESIGN] D30", async () => {
    const asked = mockBackend();
    const store = new Store();
    const context = { store, resetLayout: () => undefined };
    await runCommand("nope", context);
    await command("transaction.commit")?.run(context);
    expect(asked).toEqual([]);
  });

  it("reads a key by the platform it runs on [DESIGN] D30", () => {
    expect(keyOf(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, metaKey: true }))).toBe("Mod+K");
  });

  it("keeps a dialog with nothing to focus as it is [RULE] R-UI-1", () => {
    const { getByRole } = render(
      <Modal title="Empty" onClose={() => undefined}>
        <p>Nothing here takes the focus.</p>
      </Modal>,
    );
    const dialog = getByRole("dialog");
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(dialog).toBeTruthy();
  });

  it("connects again a connection that does not answer as the computer wakes [DESIGN] D24", async () => {
    let lost = false;
    const asked = mockBackend({
      ping_connection: () => {
        lost = true;
        throw new Error("no answer");
      },
      reconnect: () => SESSION,
    });
    const store = new Store();
    await connectSpec(store, "X", { user: "ann" }, { environment: "development", readOnly: false }, null);
    store.update((now) => ({ ...now, open: now.open.map((c) => ({ ...c, session: { ...c.session, lost: true } })) }));
    await checkAfterWake(store);
    expect(lost).toBe(true);
    expect(asked.map((a) => a.command)).toContain("reconnect");
  });
});

describe("more of the window's paths", () => {
  it("keeps the dialog open when a save fails, and names a connection with no name [RULE] R-ERR-2", async () => {
    const asked = mockBackend({
      save_connection: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the backend rejects with Studio's error, not an Error
        throw { sqlcode: -910, sqlstate: "TB910", message: "a colour is written #RRGGBB" };
      },
    });
    const store = new Store();
    store.update((now) => ({ ...now, dialog: { kind: "connection", editing: null } }));
    render(
      <StoreContext.Provider value={store}>
        <ConnectionDialog editing={null} />
      </StoreContext.Provider>,
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText("User"), { target: { value: "ann" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Save and Connect" }));
    await act(async () => {
      await new Promise((settled) => setTimeout(settled, 0));
    });
    expect(store.current().dialog).toEqual({ kind: "connection", editing: null });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Connect without Saving" }));
    await act(async () => {
      await new Promise((settled) => setTimeout(settled, 0));
    });
    expect(store.current().open[0]?.name).toBe("Connection");
    expect(asked.filter((a) => a.command === "save_connection")).toHaveLength(2);
  });

  it("makes an open connection active by a click, and disconnects it [DESIGN] D24", async () => {
    let next = 0;
    mockBackend({ open_connection: () => ({ connection: ++next, session: SESSION }) });
    const store = new Store();
    await connectSpec(store, "A", { user: "ann" }, { environment: "development", readOnly: false }, null);
    await connectSpec(store, "B", { user: "ann" }, { environment: "development", readOnly: false }, null);
    render(
      <StoreContext.Provider value={store}>
        <ConnectionsPanel />
        <ContextMenu />
      </StoreContext.Provider>,
    );
    fireEvent.click(screen.getByRole("treeitem", { name: "A" }));
    expect(store.current().active).toBe(1);
    fireEvent.keyDown(screen.getByRole("treeitem", { name: "B" }), { key: "Enter" });
    expect(store.current().active).toBe(2);
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "A" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Disconnect" }));
    await act(async () => {
      await new Promise((settled) => setTimeout(settled, 0));
    });
    expect(store.current().open.map((c) => c.name)).toEqual(["B"]);
  });

  it("runs nothing on Enter when no command matches [DESIGN] D30", () => {
    mockBackend();
    const store = new Store();
    render(
      <StoreContext.Provider value={store}>
        <CommandPalette context={{ store, resetLayout: () => undefined }} />
      </StoreContext.Provider>,
    );
    const input = screen.getByRole("combobox", { name: "Command" });
    fireEvent.change(input, { target: { value: "no such command" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "Command Palette" })).toBeTruthy();
  });

  it("takes a session the backend tells, and resets the layout by the menu [DESIGN] D24", async () => {
    mockBackend();
    const store = new Store();
    render(<App store={store} />);
    await act(async () => {
      await connectSpec(store, "X", { user: "ann" }, { environment: "development", readOnly: false }, null);
    });
    const changed = { ...SESSION, schema: "SALES" };
    await act(async () => {
      await emit(STUDIO_EVENT, { kind: "session", connection: 1, session: changed });
      await emit(MENU_EVENT, "layout.reset");
    });
    expect(store.current().open[0]?.session.schema).toBe("SALES");
  });
});
