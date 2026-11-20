/**
 * What the editor knows of the catalog (RULES.md D33, D36): the tables of
 * the schemas read, for completion; a table named in the text, found by
 * its name or its alias in the statement; and its columns, read as they
 * are asked for.
 */
import type { SQLNamespace } from "@codemirror/lang-sql";
import type { TableDetail } from "../../ipc/catalog";
import { tableKey } from "../../explorer/catalogState";
import { loadTable } from "../../state/catalog";
import type { Store } from "../../state/store";
import { worksheetOf } from "../../state/worksheets";
import { sqlName } from "../dialect";

/** A worksheet's editor's way to the store. */
export interface Bridge {
  readonly store: Store;
  readonly worksheet: string;
}

/** The connection of the bridge's worksheet, if it has one open. */
export function connectionOf(bridge: Bridge): number | null {
  return worksheetOf(bridge.store.current(), bridge.worksheet)?.connection ?? null;
}

/** The session's default schema on the bridge's connection. */
export function defaultSchema(bridge: Bridge): string | null {
  const id = connectionOf(bridge);
  return bridge.store.current().open.find((c) => c.id === id)?.session.schema ?? null;
}

/** The tables of the schemas read on the bridge's connection, for completion: each schema's tables, their columns as read. */
export function namespace(bridge: Bridge): SQLNamespace {
  const now = bridge.store.current();
  const catalog = now.catalogs[connectionOf(bridge) ?? -1];
  const reserved = new Set(now.reservedWords);
  const tree: Record<string, Record<string, string[]>> = {};
  for (const [schema, objects] of Object.entries(catalog?.objects ?? {})) {
    const tables: Record<string, string[]> = {};
    for (const t of objects.tables) {
      const detail = catalog?.tables[tableKey(schema, t.name)];
      tables[sqlName(t.name, reserved)] = detail?.columns.map((c) => sqlName(c.name, reserved)) ?? [];
    }
    tree[sqlName(schema, reserved)] = tables;
  }
  return tree;
}

/** A name as written, its quotes taken off, or in upper case if not delimited. */
export function unquoted(name: string): string {
  return name.startsWith('"') ? name.slice(1, -1).replaceAll('""', '"') : name.toUpperCase();
}

/** The table the statement `text` reads as `name`: by its alias in FROM or JOIN, else by that name; its schema if written. */
export function tableNamed(text: string, name: string): { schema: string | null; table: string } {
  const word = String.raw`("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)`;
  const pattern = new RegExp(
    String.raw`\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:${word}\.)?${word}(?:\s+(?:AS\s+)?${word})?`,
    "giu",
  );
  const wanted = unquoted(name);
  for (const [, schema, table, alias] of text.matchAll(pattern)) {
    if (table !== undefined && alias !== undefined && unquoted(alias) === wanted) {
      return { schema: schema === undefined ? null : unquoted(schema), table: unquoted(table) };
    }
  }
  return { schema: null, table: wanted };
}

/** The table `schema`.`table`, its schema the session's if none is given, read if not read: none if the user may see none. */
export async function tableDetail(bridge: Bridge, schema: string | null, table: string): Promise<TableDetail | null> {
  const id = connectionOf(bridge);
  const owner = schema ?? defaultSchema(bridge);
  if (id === null || owner === null) {
    return null;
  }
  const key = tableKey(owner, table);
  const known = bridge.store.current().catalogs[id]?.tables[key];
  if (known !== undefined) {
    return known;
  }
  const errorBefore = bridge.store.current().error;
  await loadTable(bridge.store, id, owner, table);
  // A name that is no table's is no failure of the user's: the error it raised is let go.
  bridge.store.update((now) => ({ ...now, error: errorBefore }));
  return bridge.store.current().catalogs[id]?.tables[key] ?? null;
}
