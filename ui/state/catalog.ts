/**
 * The explorer's actions on a connection's catalog (RULES.md D33): each
 * reads what the tree opens, a list or an object at a time, and keeps it
 * in the window's store; a failure is kept as the error shown.
 */
import {
  catalogDefinition,
  catalogObjects,
  catalogSchemas,
  catalogSearch,
  catalogSecurity,
  catalogTable,
  type DefinitionOf,
} from "../ipc/catalog";
import { EMPTY_CATALOG, type CatalogState, type Selected, tableKey } from "../explorer/catalogState";
import { nodeId, SEP } from "../explorer/tree";
import { isStudioError } from "./actions";
import type { Store } from "./store";

/** Changes connection `id`'s catalog by `change`. */
function changeCatalog(store: Store, id: number, change: (now: CatalogState) => CatalogState): void {
  store.update((now) => ({ ...now, catalogs: { ...now.catalogs, [id]: change(now.catalogs[id] ?? EMPTY_CATALOG) } }));
}

/** Runs `work`, keeping its failure as the state's error. */
async function reading(store: Store, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (thrown: unknown) {
    if (isStudioError(thrown)) {
      store.update((now) => ({ ...now, error: thrown }));
    }
  }
}

/** Reads connection `id`'s schemas, forgetting what was read before. */
export async function loadSchemas(store: Store, id: number): Promise<void> {
  await reading(store, async () => {
    const schemas = await catalogSchemas(id);
    changeCatalog(store, id, () => ({ ...EMPTY_CATALOG, schemas }));
  });
}

/** Reads the table `schema`.`name` of connection `id`, if not read. */
export async function loadTable(store: Store, id: number, schema: string, name: string): Promise<void> {
  if (store.current().catalogs[id]?.tables[tableKey(schema, name)] !== undefined) {
    return;
  }
  await reading(store, async () => {
    const detail = await catalogTable(id, schema, name);
    changeCatalog(store, id, (c) => ({ ...c, tables: { ...c.tables, [tableKey(schema, name)]: detail } }));
  });
}

/** Reads what node `node` of connection `id` opens on, if not read. */
async function loadUnder(store: Store, id: number, node: string): Promise<void> {
  const [kind, schema = "", name = ""] = node.split(SEP);
  const catalog = store.current().catalogs[id] ?? EMPTY_CATALOG;
  if (kind === "schema" && catalog.objects[schema] === undefined) {
    await reading(store, async () => {
      const objects = await catalogObjects(id, schema);
      changeCatalog(store, id, (c) => ({ ...c, objects: { ...c.objects, [schema]: objects } }));
    });
  } else if (kind === "table") {
    await loadTable(store, id, schema, name);
  } else if (kind === "security" && catalog.security === null) {
    await reading(store, async () => {
      const security = await catalogSecurity(id);
      changeCatalog(store, id, (c) => ({ ...c, security }));
    });
  }
}

/** Reads connection `id`'s users and roles again, as after an act of administration. */
export async function reloadSecurity(store: Store, id: number): Promise<void> {
  await reading(store, async () => {
    const security = await catalogSecurity(id);
    changeCatalog(store, id, (c) => ({ ...c, security }));
  });
}

/** Opens node `node` of connection `id`'s tree, reading what it holds, or closes it. */
export async function toggle(store: Store, id: number, node: string): Promise<void> {
  const open = (store.current().catalogs[id] ?? EMPTY_CATALOG).expanded.includes(node);
  changeCatalog(store, id, (c) => ({
    ...c,
    expanded: open ? c.expanded.filter((n) => n !== node) : [...c.expanded, node],
  }));
  if (!open) {
    await loadUnder(store, id, node);
  }
}

/** Filters connection `id`'s tree by `filter`, reading each schema's objects not yet read. */
export async function filterTree(store: Store, id: number, filter: string): Promise<void> {
  changeCatalog(store, id, (c) => ({ ...c, filter }));
  if (filter === "") {
    return;
  }
  const catalog = store.current().catalogs[id] ?? EMPTY_CATALOG;
  const unread = (catalog.schemas ?? []).filter((s) => catalog.objects[s.name] === undefined);
  for (const schema of unread) {
    await loadUnder(store, id, nodeId("schema", schema.name));
  }
}

/** Searches connection `id`'s names and definitions for `text`. */
export async function searchCatalog(store: Store, id: number, text: string): Promise<void> {
  if (text.trim() === "") {
    changeCatalog(store, id, (c) => ({ ...c, found: null }));
    return;
  }
  await reading(store, async () => {
    const found = await catalogSearch(id, text.trim());
    changeCatalog(store, id, (c) => ({ ...c, found }));
  });
}

/** Selects `object` of connection `id`, reading a table's detail if need be. */
export async function select(store: Store, id: number, object: Selected): Promise<void> {
  store.update((now) => ({ ...now, selected: { connection: id, object } }));
  if (object.kind === "table") {
    await loadTable(store, id, object.schema, object.name);
  }
}

/** Chooses `object` of connection `id` for a script of the objects chosen, or lets it go. */
export function toggleChosen(store: Store, id: number, object: Selected): void {
  const key = JSON.stringify(object);
  changeCatalog(store, id, (c) => ({
    ...c,
    chosen: c.chosen.some((o) => JSON.stringify(o) === key)
      ? c.chosen.filter((o) => JSON.stringify(o) !== key)
      : [...c.chosen, object],
  }));
}

/** What a script of `object` is asked of, if it has a definition. */
export function definitionOf(object: Selected): DefinitionOf | null {
  switch (object.kind) {
    case "table":
      return { kind: "table", schema: object.schema, name: object.name, script: "create" };
    case "routine":
      return { kind: "routine", schema: object.schema, specific: object.specific };
    case "sequence":
    case "domain":
    case "type":
      return { kind: object.kind, schema: object.schema, name: object.name };
    case "schema":
      return { kind: "schema", schema: object.schema };
    case "user":
    case "role":
      return null;
  }
}

/** The definitions of the objects chosen on connection `id`, in the order chosen, as one script; the choice let go. */
export async function scriptChosen(store: Store, id: number): Promise<string | null> {
  const chosen = store.current().catalogs[id]?.chosen ?? [];
  const parts: string[] = [];
  try {
    for (const object of chosen) {
      const of = definitionOf(object);
      if (of !== null) {
        parts.push(await catalogDefinition(id, of));
      }
    }
  } catch (thrown: unknown) {
    if (isStudioError(thrown)) {
      store.update((now) => ({ ...now, error: thrown }));
    }
    return null;
  }
  changeCatalog(store, id, (c) => ({ ...c, chosen: [] }));
  return parts.join("\n");
}

/** Reads the schemas of connection `id`, if not read, and the objects of schema `schema`, if not read, the tree as it is. */
export async function ensureObjects(store: Store, id: number, schema: string): Promise<void> {
  if (store.current().catalogs[id]?.schemas === undefined || store.current().catalogs[id]?.schemas === null) {
    await reading(store, async () => {
      const schemas = await catalogSchemas(id);
      changeCatalog(store, id, (c) => ({ ...c, schemas }));
    });
  }
  if (store.current().catalogs[id]?.objects[schema] === undefined) {
    await reading(store, async () => {
      const objects = await catalogObjects(id, schema);
      changeCatalog(store, id, (c) => ({ ...c, objects: { ...c.objects, [schema]: objects } }));
    });
  }
}
