import { act, fireEvent, screen } from "@testing-library/react";
import type { TableDetail } from "../ipc/catalog";
import { catalogBackend, opened, refused, settle, within } from "../test/catalog";
import { DataDialog } from "./DataDialog";
import { comparedColumns, difference, MAX_COMPARED_ROWS } from "./compareData";

/** A table of `columns`, its key ID. */
function table(name: string, columns: [string, string][], key = true): TableDetail {
  return {
    schema: "ANN",
    name,
    kind: "BASE TABLE",
    columns: columns.map(([n, t], i) => ({
      name: n,
      position: i + 1,
      typeWritten: t,
      default: null,
      nullable: n !== "ID",
      identity: null,
      generated: null,
      domain: null,
    })),
    constraints: key
      ? [{ name: `${name}_PK`, kind: "PRIMARY KEY", columns: ["ID"], check: null, references: null, deferrable: false }]
      : [],
    indexes: [],
    triggers: [],
    privileges: [],
    view: null,
    partitioning: null,
    partitionOf: null,
  };
}

const SOURCE = table("PRICES", [
  ["ID", "INTEGER"],
  ["NAME", "VARCHAR(20)"],
  ["PRICE", "DECIMAL(9,2)"],
  ["NOTE", "CLOB(1M)"],
]);
const TARGET = table("PRICES_COPY", [
  ["ID", "INTEGER"],
  ["NAME", "VARCHAR(20)"],
  ["PRICE", "DECIMAL(9,2)"],
  ["NOTE", "CLOB(1M)"],
  ["EXTRA", "DATE"],
]);

describe("two tables' rows compared", () => {
  it("compares the columns both have, but large objects, by the target's key [DESIGN] D45", () => {
    const compared = comparedColumns(SOURCE, TARGET);
    expect(compared?.columns.map((c) => c.name)).toEqual(['"ID"', '"NAME"', '"PRICE"']);
    expect(compared?.key.map((k) => k.at)).toEqual([0]);
    expect(compared?.skipped).toEqual(["NOTE"]);
    expect(comparedColumns(SOURCE, table("T", [["ID", "INTEGER"]], false))).toBeNull();
    expect(comparedColumns(table("S", [["X", "INTEGER"]]), TARGET)).toBeNull();
  });

  it("writes the statements that make the target's rows the source's, each value a literal [DESIGN] D45", () => {
    const compared = comparedColumns(SOURCE, TARGET);
    if (compared === null) {
      throw new Error("no comparison");
    }
    const found = difference(compared, '"ANN"."PRICES_COPY"', {
      source: [
        ["1", "Pen", "2.50"],
        ["2", "Ink's", "3.00"],
        ["4", "Pad", null],
      ],
      target: [
        ["1", "Pen", "2.50"],
        ["2", "Ink", "3.10"],
        ["3", "Nib", "1.00"],
      ],
    });
    expect(found).toEqual({
      inserts: 1,
      updates: 1,
      deletes: 1,
      same: 1,
      statements: [
        `UPDATE "ANN"."PRICES_COPY" SET "NAME" = 'Ink''s', "PRICE" = 3.00 WHERE "ID" = 2;`,
        `INSERT INTO "ANN"."PRICES_COPY" ("ID", "NAME", "PRICE") VALUES (4, 'Pad', NULL);`,
        `DELETE FROM "ANN"."PRICES_COPY" WHERE "ID" = 3;`,
      ],
    });
  });
});

describe("the compare dialog", () => {
  it("compares a table with the target chosen, tells what differs, and opens the script that syncs it [DESIGN] D45", async () => {
    let rows = 0;
    const asked = catalogBackend({
      catalog_table: (args) => (args["name"] === "PRICES" ? SOURCE : TARGET),
      run_statement: (args) => {
        rows += 1;
        const target = String(args["sql"]).includes("PRICES_COPY");
        return {
          kind: "ran",
          answer: {
            outcome: {
              kind: "rows",
              result: rows,
              columns: [],
              page: {
                from: 0,
                rows: target
                  ? [
                      ["1", "Pen", "2.50"],
                      ["3", "Nib", "1.00"],
                    ]
                  : [["1", "Pen", "2.50"]],
                rowsRead: 1,
                complete: target,
                lobs: [],
              },
            },
            warnings: [],
            serverTime: null,
            session: { authorization: "ANN" },
          },
        };
      },
      fetch_rows: () => ({ from: 1, rows: [["2", "Ink", "3.00"]], rowsRead: 2, complete: true, lobs: [] }),
    });
    const store = await opened();
    within(store, <DataDialog task={{ kind: "compare", connection: 1, schema: "ANN", table: "PRICES" }} />);
    fireEvent.change(screen.getByLabelText("Table"), { target: { value: "PRICES_COPY" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Connection" }), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Schema"), { target: { value: "ANN" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Compare" }));
      await settle();
    });
    expect(screen.getByText("1 rows the same; 1 to insert, 0 to update and 1 to delete in the target.")).toBeTruthy();
    expect(screen.getByText("Large objects are not compared: NOTE.")).toBeTruthy();
    expect(asked.filter((a) => a.command === "run_statement").map((a) => a.args["sql"])).toEqual([
      'SELECT "ID", "NAME", "PRICE" FROM "ANN"."PRICES" ORDER BY "ID"',
      'SELECT "ID", "NAME", "PRICE" FROM "ANN"."PRICES_COPY" ORDER BY "ID"',
    ]);
    expect(asked.filter((a) => a.command === "close_result")).toHaveLength(2);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Script in Worksheet" }));
      await settle();
    });
    expect(store.current().worksheets.at(-1)).toMatchObject({
      title: "Sync PRICES_COPY",
      text: `INSERT INTO "ANN"."PRICES_COPY" ("ID", "NAME", "PRICE") VALUES (2, 'Ink', 3.00);\nDELETE FROM "ANN"."PRICES_COPY" WHERE "ID" = 3;`,
    });
  });

  it("says why tables are not compared: no key shared, a table not read, or too many rows [DESIGN] D45", async () => {
    let answer: unknown = {
      kind: "ran",
      answer: {
        outcome: { kind: "done", sqlcode: 0, sqlstate: "00000", rowsAffected: null, generated: [] },
        warnings: [],
        serverTime: null,
        session: {},
      },
    };
    let detail: unknown = table("PRICES_COPY", [["ID", "INTEGER"]], false);
    catalogBackend({
      catalog_table: (args) => (args["name"] === "PRICES" ? SOURCE : detail),
      run_statement: () => answer,
      fetch_rows: () => ({
        from: 1,
        rows: Array.from({ length: MAX_COMPARED_ROWS + 1 }, () => ["1", "x", "1"]),
        rowsRead: MAX_COMPARED_ROWS + 2,
        complete: false,
        lobs: [],
      }),
    });
    const store = await opened();
    within(store, <DataDialog task={{ kind: "compare", connection: 1, schema: "ANN", table: "PRICES" }} />);
    fireEvent.change(screen.getByLabelText("Table"), { target: { value: "PRICES_COPY" } });
    const compare = async () => {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Compare" }));
        await settle();
      });
    };
    await compare();
    expect(screen.getByText(/has no key the two tables share/u)).toBeTruthy();
    detail = TARGET;
    await compare();
    expect(screen.getByText("ANN.PRICES could not be read.")).toBeTruthy();
    answer = {
      kind: "ran",
      answer: {
        outcome: {
          kind: "rows",
          result: 1,
          columns: [],
          page: { from: 0, rows: [["1", "x", "1"]], rowsRead: 1, complete: false, lobs: [] },
        },
        warnings: [],
        serverTime: null,
        session: {},
      },
    };
    await compare();
    expect(screen.getByText(`ANN.PRICES has more than ${String(MAX_COMPARED_ROWS)} rows: compare fewer.`)).toBeTruthy();
    detail = refused({ message: "no such table" });
    await compare();
    expect(screen.getByText("no such table")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
  });
});
