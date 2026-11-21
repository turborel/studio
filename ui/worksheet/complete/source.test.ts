import { changeWorksheet, openWorksheet } from "../../state/worksheets";
import { catalogBackend, OBJECTS, opened, STAFF } from "../../test/catalog";
import { ensureObjects } from "../../state/catalog";
import { storeCatalog } from "./source";

describe("completion's catalog", () => {
  it("reads the window's cache, and reads further only while the worksheet runs nothing [DESIGN] D40", async () => {
    const asked = catalogBackend();
    const store = await opened();
    const id = openWorksheet(store);
    const bridge = { store, worksheet: id };
    expect(storeCatalog(bridge).schemas()).toEqual([]);
    await ensureObjects(store, 1, "ANN");
    await ensureObjects(store, 1, "ANN");
    expect(asked.filter((a) => a.command === "catalog_objects")).toHaveLength(1);
    const catalog = storeCatalog(bridge);
    expect(catalog.schemas()).toEqual(["ANN"]);
    expect(catalog.objects("ANN")).toEqual([
      { name: "STAFF", kind: "table" },
      { name: "PAYROLL", kind: "view" },
      { name: "ORDER_NO", kind: "sequence" },
    ]);
    expect(catalog.objects("NONE")).toEqual([]);
    expect(catalog.routines("ANN")).toEqual(OBJECTS.routines);
    expect(catalog.routines("NONE")).toEqual([]);
    expect(await catalog.signature("ANN", "DOUBLED_1")).toBe("DOUBLED(IN N INTEGER) RETURNS INTEGER");
    expect(await catalog.signature("ANN", "DOUBLED_1")).toBe("DOUBLED(IN N INTEGER) RETURNS INTEGER");
    expect(asked.filter((a) => a.command === "catalog_routine")).toHaveLength(1);
    changeWorksheet(store, id, (w) => ({ ...w, running: true }));
    const busy = storeCatalog(bridge);
    expect(await busy.table(null, "STAFF")).toBeNull();
    expect(await busy.signature("ANN", "OTHER_1")).toBeNull();
    changeWorksheet(store, id, (w) => ({ ...w, running: false }));
    expect(await storeCatalog(bridge).table(null, "STAFF")).toEqual(STAFF);
    changeWorksheet(store, id, (w) => ({ ...w, running: true }));
    expect(await storeCatalog(bridge).table("ANN", "STAFF")).toEqual(STAFF);
    expect(storeCatalog(bridge).recent("NOTHING")).toBe(0);
    changeWorksheet(store, id, (w) => ({ ...w, connection: null }));
    expect(await storeCatalog(bridge).signature("ANN", "X")).toBeNull();
  });
});
