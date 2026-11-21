import type { Theme } from "@glideapps/glide-data-grid";
import type { ColumnInfo } from "../ipc/connections";
import { PALETTES } from "../theme/tokens";
import { columnWidth, gridCell, gridTheme, headerDrawer, sortMark } from "./Grid";

const ID: ColumnInfo = { name: "ID", typeWritten: "INTEGER", typeName: null, notNull: true };
const COLUMNS: ColumnInfo[] = [ID, { name: null, typeWritten: "VARCHAR(600)", typeName: null, notNull: false }];

/** The colours of the tests' cells. */
const COLOURS = { muted: "#777777", changed: "#eeeeee", removed: "#aa0000" };

describe("the grid's drawing", () => {
  it("draws numbers to the right, a null muted, a long value cut, in Studio's colours [DESIGN] D13 D39", () => {
    const shown = (rows: (string | null)[][]) => ({ columns: COLUMNS, rows, editing: null, lobs: [] });
    expect(gridCell(shown([["1", null]]), [0, 0], COLOURS)).toMatchObject({ data: "1", contentAlign: "right" });
    expect(gridCell(shown([["1", null]]), [1, 0], COLOURS)).toMatchObject({
      displayData: "NULL",
      themeOverride: { textDark: "#777777" },
    });
    expect(gridCell(shown([["1", "x".repeat(600)]]), [1, 0], COLOURS)).toMatchObject({
      displayData: `${"x".repeat(500)}…`,
    });
    expect(gridCell(shown([]), [5, 9], COLOURS)).toMatchObject({
      displayData: "NULL",
      contentAlign: "left",
      readonly: true,
    });
    expect(gridTheme("dark")).toMatchObject({ bgCell: PALETTES.dark.background, textDark: PALETTES.dark.text });
    expect(sortMark([], 0)).toBe("");
    expect(sortMark([{ column: 0, descending: true }], 0)).toBe(" ▼");
    expect(
      sortMark(
        [
          { column: 1, descending: false },
          { column: 0, descending: false },
        ],
        0,
      ),
    ).toBe(" ▲2");
    expect(columnWidth(ID, 0, [["1"]])).toBe(69);
    expect(columnWidth({ ...ID, name: null }, 1, [[null, "y".repeat(900)]])).toBe(320);
  });

  it("writes a header's name on one line and its declared type below [DESIGN] D39", () => {
    const written: [string, string][] = [];
    const ctx = {
      save: () => undefined,
      restore: () => undefined,
      fillText: (text: string) => written.push([text, ctx.font]),
      fillStyle: "",
      font: "",
    };
    const draw = headerDrawer(COLUMNS);
    const theme = { textHeader: "#000", textLight: "#777", fontFamily: "mono" } as Theme;
    draw(
      {
        ctx,
        column: { title: "ID ▲", id: "0" },
        columnIndex: 0,
        theme,
        rect: { x: 0, y: 0, width: 80, height: 42 },
      } as unknown as Parameters<typeof draw>[0],
      () => undefined,
    );
    draw(
      {
        ctx,
        column: { title: "(9)", id: "9" },
        columnIndex: 9,
        theme,
        rect: { x: 0, y: 0, width: 80, height: 42 },
      } as unknown as Parameters<typeof draw>[0],
      () => undefined,
    );
    expect(written).toEqual([
      ["ID ▲", "600 12px mono"],
      ["INTEGER", "11px mono"],
      ["(9)", "600 12px mono"],
      ["", "11px mono"],
    ]);
  });
});
