/**
 * What the explorer has read of a connection's catalog (RULES.md D33):
 * the schemas, each schema's objects and each table's detail as they are
 * opened, the nodes expanded, and a search's results.
 */
import type { Found, Schema, SchemaObjects, Security, TableDetail } from "../ipc/catalog";

/** An object of the catalog the details panel shows. */
export type Selected =
  | { readonly kind: "table"; readonly schema: string; readonly name: string }
  | { readonly kind: "routine"; readonly schema: string; readonly specific: string; readonly name: string }
  | { readonly kind: "sequence"; readonly schema: string; readonly name: string }
  | { readonly kind: "domain"; readonly schema: string; readonly name: string }
  | { readonly kind: "type"; readonly schema: string; readonly name: string }
  | { readonly kind: "schema"; readonly schema: string }
  | { readonly kind: "user"; readonly name: string }
  | { readonly kind: "role"; readonly name: string };

/** A connection's catalog, as far as it has been read. */
export interface CatalogState {
  readonly schemas: readonly Schema[] | null;
  readonly objects: Readonly<Record<string, SchemaObjects>>;
  readonly tables: Readonly<Record<string, TableDetail>>;
  readonly security: Security | null;
  readonly expanded: readonly string[];
  readonly filter: string;
  readonly found: readonly Found[] | null;
  /** The objects chosen, by Cmd or Ctrl and a click, for a script of them. */
  readonly chosen: readonly Selected[];
}

/** A catalog of which nothing is read. */
export const EMPTY_CATALOG: CatalogState = {
  schemas: null,
  objects: {},
  tables: {},
  security: null,
  expanded: [],
  filter: "",
  found: null,
  chosen: [],
};

/** The key of a table's detail: its schema and name. */
export function tableKey(schema: string, name: string): string {
  return `${schema}\u0000${name}`;
}
