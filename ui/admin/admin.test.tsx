import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import type { Ran } from "../ipc/connections";
import type { ViewName, ViewRows } from "../ipc/admin";
import { rowMenu } from "../explorer/CatalogTree";
import { EMPTY_CATALOG } from "../explorer/catalogState";
import { tableMenu } from "../explorer/menus";
import { nodeId } from "../explorer/tree";
import type { MenuItem } from "../shell/ContextMenu";
import { SESSION } from "../test/backend";
import { catalogBackend, opened, refused, settle, within } from "../test/catalog";
import type { Store } from "../state/store";
import { runAct } from "./admin";
import { accountMenu, securityMenu } from "./menus";
import { MAX_SAMPLES, MonitorPanel } from "./MonitorPanel";
import { SecurityDialog, type SecurityForm } from "./SecurityDialog";

/** What an act gave. */
const RAN: { kind: "ran"; answer: Ran } = {
  kind: "ran",
  answer: {
    outcome: { kind: "done", sqlcode: 0, sqlstate: "00000", rowsAffected: 0, generated: [] },
    warnings: [],
    serverTime: null,
    session: { ...SESSION, schema: "HR" },
  },
};

/** The rows each view gives. */
const VIEWS: Partial<Record<ViewName, ViewRows>> = {
  connections: {
    columns: ["ID", "USER_NAME", "PEER", "SECURE", "STATE", "APPLICATION"],
    rows: [
      ["1", "ANN", "local", "NO", "RUNNING", "Turborel Studio"],
      ["2", "BOB", "10.0.0.2", "YES", "IDLE", null],
    ],
    absent: false,
  },
  connectionAttributes: { columns: ["CONNECTION_ID", "ATTRIBUTE_NAME", "ATTRIBUTE_VALUE"], rows: [], absent: false },
  server: {
    columns: [
      "WORKERS_BUSY",
      "STATEMENTS_WAITING",
      "CONNECTIONS",
      "REFUSED",
      "CLOSED_UNTOLD",
      "COMMITTED",
      "ROLLED_BACK",
    ],
    rows: [["1", "0", "2", "0", "0", "10", "1"]],
    absent: false,
  },
  replicas: { columns: ["MEMBER"], rows: [], absent: true },
  settings: {
    columns: [
      "SETTING_NAME",
      "SETTING_VALUE",
      "VALUE_SOURCE",
      "DEFAULT_VALUE",
      "VALUE_KIND",
      "IS_SESSION_SETTABLE",
      "TAKES_EFFECT",
      "DESCRIPTION",
      "STARTED_VALUE",
      "IS_PENDING",
    ],
    rows: [
      ["LOCKS.WAIT", "OFF", "DEFAULT", "OFF", "ONE OF ON, OFF", "YES", "AT ONCE", "Whether a lock waits.", null, "NO"],
      ["STATEMENT.TIMEOUT_MS", "0", "DEFAULT", "0", "INTEGER FROM 0", "YES", "AT ONCE", null, null, "NO"],
      [
        "MEMORY.BUDGET_BYTES",
        "1",
        "DEFAULT",
        "1",
        "INTEGER FROM 1",
        "NO",
        "AT THE NEXT START",
        "The budget.",
        null,
        "NO",
      ],
    ],
    absent: false,
  },
};

/** The act of `menu`'s item `label`. */
function pick(menu: readonly MenuItem[], label: string): () => void {
  const found = menu.find((i) => i !== "separator" && i.label === label);
  if (found === undefined || found === "separator" || !("run" in found)) {
    throw new Error(`no ${label}`);
  }
  const run = found.run;
  return () => void run();
}

/** Shows the dialog of `form` on connection 1. */
function dialog(store: Store, form: SecurityForm) {
  return within(store, <SecurityDialog connection={1} form={form} />);
}

afterEach(cleanup);

describe("an act of administration", () => {
  it("runs, asks what the guards ask, and tells a failure [DESIGN] D57", async () => {
    let calls = 0;
    const asked = catalogBackend({
      admin_act: (args) => {
        calls += 1;
        if (args["confirmed"] === false && (args["act"] as { kind: string }).kind === "dropUser") {
          return {
            kind: "confirm",
            answer: { class: "security", destroys: ["DROP USER"], unclassified: [], production: false },
          };
        }
        if ((args["act"] as { kind: string }).kind === "createRole") {
          return refused({ sqlcode: -103, sqlstate: "2A000", message: "the role exists" });
        }
        return RAN;
      },
    });
    const store = await opened();
    expect(await runAct(store, 1, { kind: "setSession", name: "X", value: { kind: "default" } })).toEqual({
      kind: "done",
    });
    expect(store.current().open[0]?.session.schema).toBe("HR");
    expect(asked.some((a) => a.command === "catalog_security")).toBe(false);
    const dropping = runAct(store, 1, { kind: "dropUser", name: "BOB" });
    await settle();
    const guard = store.current().dialog;
    if (guard?.kind !== "guard") {
      throw new Error("no question");
    }
    act(() => {
      guard.answer(true);
    });
    expect(await dropping).toEqual({ kind: "done" });
    expect(asked.some((a) => a.command === "catalog_security")).toBe(true);
    const declining = runAct(store, 1, { kind: "dropUser", name: "BOB" });
    await settle();
    const again = store.current().dialog;
    if (again?.kind === "guard") {
      act(() => {
        again.answer(false);
      });
    }
    expect(await declining).toEqual({ kind: "declined" });
    expect(await runAct(store, 1, { kind: "createRole", name: "R" })).toEqual({
      kind: "failed",
      why: "the role exists",
    });
    expect(calls).toBe(5);
  });
});

describe("the dialogs of users, roles and privileges", () => {
  it("make a user, its passwords the same, and change a password [DESIGN] D57", async () => {
    const asked = catalogBackend({ admin_act: () => RAN });
    const store = await opened();
    dialog(store, { kind: "createUser" });
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: " bob " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "s3cret" } });
    fireEvent.change(screen.getByLabelText("Password again"), { target: { value: "other" } });
    expect(screen.getByText("The passwords differ.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create User" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Password again"), { target: { value: "s3cret" } });
    fireEvent.click(screen.getByRole("button", { name: "Create User" }));
    await settle();
    expect(asked.find((a) => a.command === "admin_act")?.args["act"]).toEqual({
      kind: "createUser",
      name: "bob",
      password: "s3cret",
    });
    expect(store.current().dialog).toBeNull();
    cleanup();
    dialog(store, { kind: "password", user: "BOB" });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Password again"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Change Password" }));
    await settle();
    expect(asked.filter((a) => a.command === "admin_act").at(-1)?.args["act"]).toEqual({
      kind: "changePassword",
      name: "BOB",
      password: "x",
    });
  });

  it("make a role, grant and revoke one, and tell a failure [DESIGN] D57", async () => {
    const asked = catalogBackend({
      admin_act: (args) =>
        (args["act"] as { kind: string }).kind === "revokeRole"
          ? refused({ sqlcode: -1, sqlstate: "42000", message: "not granted" })
          : RAN,
    });
    const store = await opened();
    dialog(store, { kind: "createRole" });
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "AUDITORS" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Role" }));
    await settle();
    cleanup();
    dialog(store, { kind: "grantRole", role: "AUDITORS", grantee: "" });
    expect(screen.getByRole("button", { name: "Grant" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByRole("textbox", { name: "To or from (a user, a role, or PUBLIC)" }), {
      target: { value: "BOB" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "With admin option" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Revoke with CASCADE" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("not granted");
    fireEvent.click(screen.getByRole("button", { name: "Grant" }));
    await settle();
    const acts = asked.filter((a) => a.command === "admin_act").map((a) => a.args["act"]);
    expect(acts).toEqual([
      { kind: "createRole", name: "AUDITORS" },
      { kind: "revokeRole", role: "AUDITORS", grantee: "BOB", cascade: true },
      { kind: "grantRole", role: "AUDITORS", grantee: "BOB", admin: true },
    ]);
  });

  it("grant and revoke a table's privileges, and say a closed connection is [DESIGN] D57", async () => {
    const asked = catalogBackend({ admin_act: () => RAN });
    const store = await opened();
    dialog(store, { kind: "privileges", table: "ANN.STAFF", title: "ANN.STAFF" });
    expect(screen.getByText("Privileges on ANN.STAFF")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "INSERT" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "SELECT" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "With grant option" }));
    fireEvent.change(screen.getByRole("textbox", { name: "To or from (a user, a role, or PUBLIC)" }), {
      target: { value: "PUBLIC" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grant" }));
    await settle();
    expect(asked.find((a) => a.command === "admin_act")?.args["act"]).toEqual({
      kind: "grantPrivileges",
      privileges: ["insert"],
      table: "ANN.STAFF",
      grantee: "PUBLIC",
      grantOption: true,
    });
    cleanup();
    dialog(store, { kind: "privileges", table: "ANN.STAFF", title: "ANN.STAFF" });
    fireEvent.change(screen.getByRole("textbox", { name: "To or from (a user, a role, or PUBLIC)" }), {
      target: { value: "BOB" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await settle();
    expect(asked.filter((a) => a.command === "admin_act").at(-1)?.args["act"]).toEqual({
      kind: "revokePrivileges",
      privileges: ["select"],
      table: "ANN.STAFF",
      grantee: "BOB",
      cascade: false,
    });
    cleanup();
    within(store, <SecurityDialog connection={9} form={{ kind: "createRole" }} />);
    expect(screen.getByText("The connection is closed.")).toBeTruthy();
  });
});

describe("the menus of users, roles and privileges", () => {
  it("open their dialogs and run their acts [DESIGN] D57", async () => {
    const asked = catalogBackend({
      admin_act: () => RAN,
      catalog_security: () => ({
        users: [{ name: "BOB", owner: false, createRole: true }],
        roles: [],
        enabled: [],
        administrable: [],
      }),
    });
    const store = await opened();
    act(() => {
      store.update((now) => ({
        ...now,
        catalogs: {
          ...now.catalogs,
          1: {
            ...(now.catalogs[1] ?? EMPTY_CATALOG),
            security: {
              users: [{ name: "BOB", owner: false, createRole: true }],
              roles: [],
              enabled: [],
              administrable: [],
            },
          },
        },
      }));
    });
    pick(securityMenu(store, 1), "New User…")();
    expect(store.current().dialog).toEqual({ kind: "security", connection: 1, form: { kind: "createUser" } });
    pick(
      rowMenu(store, 1, {
        id: nodeId("security"),
        label: "Users and Roles",
        depth: 0,
        expandable: true,
        expanded: false,
      }),
      "New Role…",
    )();
    expect(store.current().dialog).toEqual({ kind: "security", connection: 1, form: { kind: "createRole" } });
    const user = accountMenu(store, 1, { kind: "user", name: "BOB" });
    pick(user, "Change Password…")();
    pick(user, "Grant a Role…")();
    expect(store.current().dialog).toEqual({
      kind: "security",
      connection: 1,
      form: { kind: "grantRole", role: "", grantee: "BOB" },
    });
    pick(user, "Forbid Creating Roles")();
    pick(user, "Drop User")();
    const role = accountMenu(store, 1, { kind: "role", name: "auditors" });
    pick(role, "Grant or Revoke…")();
    expect(store.current().dialog).toEqual({
      kind: "security",
      connection: 1,
      form: { kind: "grantRole", role: '"auditors"', grantee: "" },
    });
    pick(role, "Drop Role")();
    await settle();
    expect(asked.filter((a) => a.command === "admin_act").map((a) => (a.args["act"] as { kind: string }).kind)).toEqual(
      ["allowCreateRole", "dropUser", "dropRole"],
    );
    expect(pick(accountMenu(store, 1, { kind: "user", name: "EVE" }), "Let Create Roles")).toBeTruthy();
    pick(tableMenu(store, 1, "ANN", "STAFF", false), "Privileges…")();
    expect(store.current().dialog).toEqual({
      kind: "security",
      connection: 1,
      form: { kind: "privileges", table: "ANN.STAFF", title: "ANN.STAFF" },
    });
  });
});

describe("the monitor", () => {
  it("shows the sessions, cancels and ends one, and the server's counters drawn [DESIGN] D57", async () => {
    const asked = catalogBackend({
      admin_view: (args) => VIEWS[args["view"] as ViewName] ?? { columns: ["X"], rows: [], absent: false },
      admin_act: () => RAN,
    });
    const store = await opened();
    within(store, <MonitorPanel />);
    await settle();
    expect(screen.getByRole("table", { name: "Sessions" }).textContent).toContain("Turborel Studio");
    expect(screen.getAllByRole("button", { name: "Cancel Statement" })[1]).toHaveProperty("disabled", true);
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel Statement" })[0] ?? document.body);
    fireEvent.click(screen.getAllByRole("button", { name: "End Connection" })[1] ?? document.body);
    await settle();
    expect(asked.filter((a) => a.command === "admin_act").map((a) => a.args["act"])).toEqual([
      { kind: "cancelConnection", id: 1 },
      { kind: "endConnection", id: 2 },
    ]);
    expect(screen.getAllByText(/No rows/).length).toBe(1);
    fireEvent.click(screen.getByRole("tab", { name: "Server" }));
    await settle();
    expect(screen.getByText("The counters are drawn once read twice.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await settle();
    expect(screen.getByRole("figure", { name: "The server's counters over time" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Replication" }));
    await settle();
    expect(screen.getByText("This database is in no replica group.")).toBeTruthy();
    for (const tab of ["Jobs", "Files", "Memory", "Backups"]) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      await settle();
    }
    expect(screen.getByRole("heading", { name: "Restore points" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Read again every" }), { target: { value: "0" } });
    expect(MAX_SAMPLES).toBe(120);
  });

  it("sets a setting for the session or the database, or its default, and tells why not [DESIGN] D57", async () => {
    const asked = catalogBackend({
      admin_view: (args) =>
        VIEWS[args["view"] as ViewName] ?? refused({ sqlcode: -1, sqlstate: "42000", message: "no view" }),
      admin_act: (args) =>
        (args["act"] as { kind: string }).kind === "setDatabase"
          ? refused({ sqlcode: -104, sqlstate: "2A000", message: "not the owner" })
          : RAN,
    });
    const store = await opened();
    within(store, <MonitorPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    await settle();
    fireEvent.change(screen.getByRole("textbox", { name: "Filter the settings" }), { target: { value: "timeout" } });
    expect(screen.getByRole("table", { name: "Settings" }).textContent).not.toContain("LOCKS.WAIT");
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Set for Session" }));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("STATEMENT.TIMEOUT_MS is set.");
    fireEvent.click(screen.getByRole("button", { name: "Database Default" }));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("not the owner");
    expect(asked.filter((a) => a.command === "admin_act").map((a) => a.args["act"])).toEqual([
      { kind: "setSession", name: "STATEMENT.TIMEOUT_MS", value: { kind: "value", value: "5000", integer: true } },
      { kind: "setDatabase", name: "STATEMENT.TIMEOUT_MS", value: { kind: "default" } },
    ]);
    fireEvent.change(screen.getByRole("textbox", { name: "Filter the settings" }), { target: { value: "budget" } });
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    expect(screen.getByRole("button", { name: "Set for Session" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("tab", { name: "Jobs" }));
    await settle();
    expect(screen.getByText("no view")).toBeTruthy();
  });

  it("asks for a connection [DESIGN] D57", async () => {
    catalogBackend();
    const store = await opened();
    act(() => {
      store.update((now) => ({ ...now, active: null }));
    });
    within(store, <MonitorPanel />);
    expect(screen.getByText("Open a connection to monitor its server.")).toBeTruthy();
  });
});
