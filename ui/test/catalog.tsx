/**
 * What the explorer's tests share (RULES.md R-TEST-7): a catalog of the
 * schema ANN, the backend that serves it over the one mock, and a store
 * with a connection to it open.
 */
import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SchemaObjects, Security, TableDetail } from "../ipc/catalog";
import type { SavedConnection } from "../ipc/saved";
import { connectSaved, refreshSaved } from "../state/actions";
import { Store, StoreContext } from "../state/store";
import { mockBackend } from "./backend";
import { ContextMenu } from "../shell/ContextMenu";

/** Renders `children` within `store`, and the context menu the window shows. */
export function within(store: Store, children: ReactNode) {
  return render(
    <StoreContext.Provider value={store}>
      {children}
      <ContextMenu />
    </StoreContext.Provider>,
  );
}

/** Lets the backend's answers settle. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((settled) => setTimeout(settled, 0));
  });
}

/** What the schema ANN holds. */
export const OBJECTS: SchemaObjects = {
  tables: [
    { name: "STAFF", kind: "BASE TABLE" },
    { name: "PAYROLL", kind: "VIEW" },
  ],
  routines: [{ specific: "DOUBLED_1", name: "DOUBLED", kind: "FUNCTION" }],
  sequences: [
    {
      name: "ORDER_NO",
      typeWritten: "BIGINT",
      start: "1000",
      minimum: null,
      maximum: null,
      increment: "1",
      cycle: false,
    },
  ],
  domains: [{ name: "MONEY", typeWritten: "DECIMAL(9,2)", default: "0", checks: [] }],
  types: [["ADDRESS", "STRUCTURED"]],
  truncated: false,
};

/** The table ANN.STAFF, whole. */
export const STAFF: TableDetail = {
  schema: "ANN",
  name: "STAFF",
  kind: "BASE TABLE",
  columns: [
    {
      name: "ID",
      position: 1,
      typeWritten: "INTEGER",
      default: null,
      nullable: false,
      identity: "ALWAYS",
      generated: null,
      domain: null,
    },
    {
      name: "NAME",
      position: 2,
      typeWritten: "VARCHAR(20)",
      default: "'x'",
      nullable: true,
      identity: null,
      generated: null,
      domain: null,
    },
    {
      name: "DEPT",
      position: 3,
      typeWritten: "INTEGER",
      default: null,
      nullable: true,
      identity: null,
      generated: "ID * 2",
      domain: null,
    },
  ],
  constraints: [
    { name: "STAFF_PK", kind: "PRIMARY KEY", columns: ["ID"], check: null, references: null, deferrable: false },
    {
      name: "STAFF_DEPT",
      kind: "FOREIGN KEY",
      columns: ["DEPT"],
      check: null,
      references: {
        schema: "ANN",
        table: "DEPTS",
        columns: ["ID"],
        matching: "NONE",
        onUpdate: "NO ACTION",
        onDelete: "CASCADE",
      },
      deferrable: false,
    },
    { name: "NAMED", kind: "CHECK", columns: [], check: "NAME <> ''", references: null, deferrable: true },
  ],
  indexes: [
    {
      name: "STAFF_NAME",
      method: "BTREE",
      unique: false,
      columns: ["NAME"],
      implied: false,
      options: [["FILL", "50"]],
    },
    { name: "ANN.STAFF.UNIQUE1", method: "BTREE", unique: true, columns: ["ID"], implied: true, options: [] },
    {
      name: "STAFF_NOTE\u0000ANN\u0000STAFF_OLD",
      method: "BTREE",
      unique: false,
      columns: ["NAME"],
      implied: true,
      options: [],
    },
  ],
  triggers: [
    {
      schema: "ANN",
      name: "STAMPED",
      event: "INSERT",
      timing: "BEFORE",
      orientation: "ROW",
      condition: null,
      action: "SET NEW.NAME = 'y'",
    },
  ],
  privileges: [
    { grantor: "ANN", grantee: "BOB", privilege: "SELECT", grantable: true, column: null },
    { grantor: "ANN", grantee: "CAROL", privilege: "UPDATE", grantable: false, column: "NAME" },
  ],
  view: null,
  partitioning: null,
  partitionOf: null,
  storage: { engine: "rowstore", options: [["STATISTICS.SAMPLE", "20000"]] },
};

/** The users and roles. */
export const SECURITY: Security = {
  users: [{ name: "ANN", owner: true, createRole: true }],
  roles: [{ grantee: "BOB", role: "CLERK", grantable: false }],
  enabled: ["CLERK"],
  administrable: ["CLERK"],
};

/** The saved connection the tests open. */
export const SAVED: SavedConnection = {
  id: "ab",
  name: "Orders",
  folder: [],
  spec: { user: "ann" },
  environment: "development",
  colour: null,
  readOnly: false,
  pinned: false,
  favourites: [],
};

/** The backend of a catalog of schema ANN, which keeps `saved` as it is saved. */
export function catalogBackend(
  extra: Record<string, (args: Record<string, unknown>) => unknown> = {},
  saved: SavedConnection = SAVED,
) {
  let kept = saved;
  return mockBackend({
    list_saved_connections: () => ({ connections: [{ connection: kept, passwordSaved: false }], recent: [] }),
    save_connection: (args) => {
      kept = args["connection"] as SavedConnection;
      return kept;
    },
    catalog_schemas: () => [{ name: "ANN", owner: "ANN" }],
    catalog_objects: () => OBJECTS,
    catalog_table: () => STAFF,
    catalog_security: () => SECURITY,
    catalog_definition: (args) => `-- ${JSON.stringify(args["of"])}`,
    catalog_dependencies: () => ({ uses: [{ kind: "TABLE", schema: "ANN", name: "DEPTS" }], usedBy: [] }),
    catalog_routine: () => ({
      schema: "ANN",
      specific: "DOUBLED_1",
      name: "DOUBLED",
      kind: "FUNCTION",
      returns: "INTEGER",
      parameters: [{ mode: "IN", name: "N", typeWritten: "INTEGER", default: null }],
      body: null,
      deterministic: true,
      dataAccess: "CONTAINS SQL",
      privileges: [{ grantor: "ANN", grantee: "DAN", privilege: "EXECUTE", grantable: false, column: null }],
    }),
    catalog_usage: () => [{ grantor: "ANN", grantee: "ERIN", privilege: "USAGE", grantable: false, column: null }],
    ...extra,
  });
}

/** A store with connection 1 open, of the saved connection given. */
export async function opened(saved: SavedConnection = SAVED): Promise<Store> {
  const store = new Store();
  await refreshSaved(store);
  await connectSaved(store, saved, null);
  return store;
}

/** `value`, which the test is sure of: a failure of the test if it is none. */
export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("the test expected a value");
  }
  return value;
}

/** A promise the backend rejects with Studio's error `error`, as it fails. */
export function refused(error: object): Promise<never> {
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the backend rejects with Studio's error, not an Error
  return Promise.reject(error);
}
