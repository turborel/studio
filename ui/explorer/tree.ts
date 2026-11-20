/**
 * The catalog's tree, as the explorer draws it (RULES.md D33): each row
 * its node, depth, label and whether it opens, read from what is loaded;
 * a filter keeps the objects whose names hold it, and their folders.
 */
import type { SchemaObjects, TableDetail } from "../ipc/catalog";
import { constraintIcon, type IconName } from "../icons/Icon";
import { type CatalogState, type Selected, tableKey } from "./catalogState";

/** A row of the tree. */
export interface TreeRow {
  readonly id: string;
  readonly label: string;
  readonly depth: number;
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly note?: string;
  readonly select?: Selected;
  /** Its icon, where its kind alone does not say: a view's, a constraint's. */
  readonly icon?: IconName;
}

/** The icon of each kind of node, by the first part of its identifier. */
const KIND_ICONS: Readonly<Record<string, IconName>> = {
  schema: "schema",
  folder: "folder",
  table: "table",
  column: "column",
  index: "index",
  trigger: "trigger",
  routine: "routine",
  sequence: "sequence",
  domain: "domain",
  type: "type",
  user: "user",
  role: "role",
  security: "users",
};

/** The icon of `row`, if its kind has one. */
export function iconOf(row: TreeRow): IconName | null {
  return row.icon ?? KIND_ICONS[row.id.split(SEP)[0] ?? ""] ?? null;
}

/** What a schema too large to list whole says, of the catalog's limit on a list. */
export const TRUNCATED = "Only the first 20,000 of each kind are listed";

/** A row's node, a separator between its parts. */
export const SEP = "\u0000";

/** A node's identifier of `parts`. */
export function nodeId(...parts: string[]): string {
  return parts.join(SEP);
}

/** Whether `label` holds `filter`, in any case. */
function matches(label: string, filter: string): boolean {
  return filter === "" || label.toLowerCase().includes(filter.toLowerCase());
}

/** The rows of a folder of `children`, opened or closed, kept if it holds a match. */
function folder(
  state: CatalogState,
  id: string,
  label: string,
  depth: number,
  children: (d: number) => TreeRow[],
): TreeRow[] {
  const inner = children(depth + 1);
  if (state.filter !== "" && inner.length === 0) {
    return [];
  }
  const expanded = state.filter !== "" || state.expanded.includes(id);
  const row: TreeRow = { id, label, depth, expandable: true, expanded };
  return expanded ? [row, ...inner] : [row];
}

/** The rows of a table's parts, once its detail is read. */
function tableParts(detail: TableDetail | undefined, schema: string, name: string, depth: number): TreeRow[] {
  if (detail === undefined) {
    return [{ id: nodeId("loading", schema, name), label: "Loading…", depth, expandable: false, expanded: false }];
  }
  const parts: TreeRow[] = detail.columns.map((c) => ({
    id: nodeId("column", schema, detail.name, c.name),
    label: c.name,
    depth,
    expandable: false,
    expanded: false,
    note: `${c.typeWritten}${c.nullable ? "" : " NOT NULL"}`,
  }));
  for (const k of detail.constraints) {
    parts.push({
      id: nodeId("constraint", schema, detail.name, k.name),
      label: k.name,
      depth,
      expandable: false,
      expanded: false,
      note: k.kind,
      icon: constraintIcon(k.kind),
    });
  }
  for (const i of detail.indexes.filter((x) => !x.implied)) {
    parts.push({
      id: nodeId("index", schema, detail.name, i.name),
      label: i.name,
      depth,
      expandable: false,
      expanded: false,
      note: "INDEX",
    });
  }
  for (const t of detail.triggers) {
    parts.push({
      id: nodeId("trigger", schema, detail.name, t.name),
      label: t.name,
      depth,
      expandable: false,
      expanded: false,
      note: "TRIGGER",
    });
  }
  return parts;
}

/** The rows of a schema's tables of `kind`, views or the rest. */
function tables(state: CatalogState, schema: string, objects: SchemaObjects, views: boolean, depth: number): TreeRow[] {
  return objects.tables
    .filter((t) => (t.kind === "VIEW") === views && matches(t.name, state.filter))
    .flatMap((t) => {
      const id = nodeId("table", schema, t.name);
      const expanded = state.expanded.includes(id);
      const row: TreeRow = {
        id,
        label: t.name,
        depth,
        expandable: true,
        expanded,
        select: { kind: "table", schema, name: t.name },
        icon: views ? "view" : "table",
      };
      return expanded ? [row, ...tableParts(state.tables[tableKey(schema, t.name)], schema, t.name, depth + 1)] : [row];
    });
}

/** Leaves of `items`, each its label and what it selects, of `kind` within `within`. */
function leaves(
  state: CatalogState,
  items: readonly (readonly [string, Selected])[],
  [kind, within]: readonly [string, string],
  depth: number,
): TreeRow[] {
  return items
    .filter(([label]) => matches(label, state.filter))
    .map(([label, select], i) => ({
      id: nodeId(kind, within, String(i), label),
      label,
      depth,
      expandable: false,
      expanded: false,
      select,
    }));
}

/** The leaves of a schema's folders but its tables and views, each folder's name and its items. */
function schemaLeaves(
  schema: string,
  objects: SchemaObjects,
): (readonly [string, string, (readonly [string, Selected])[]])[] {
  return [
    [
      "Routines",
      "routine",
      objects.routines.map((r) => [r.name, { kind: "routine", schema, name: r.name, specific: r.specific }] as const),
    ],
    [
      "Sequences",
      "sequence",
      objects.sequences.map((q) => [q.name, { kind: "sequence", schema, name: q.name }] as const),
    ],
    ["Domains", "domain", objects.domains.map((d) => [d.name, { kind: "domain", schema, name: d.name }] as const)],
    ["Types", "type", objects.types.map(([name]) => [name, { kind: "type", schema, name }] as const)],
  ];
}

/** The rows of a schema's folders, once its objects are read. */
function schemaParts(state: CatalogState, schema: string, depth: number): TreeRow[] {
  const objects = state.objects[schema];
  if (objects === undefined) {
    return [{ id: nodeId("loading", schema), label: "Loading…", depth, expandable: false, expanded: false }];
  }
  const f = (name: string, children: (d: number) => TreeRow[]) =>
    folder(state, nodeId("folder", schema, name), name, depth, children);
  const cut: TreeRow[] = objects.truncated
    ? [{ id: nodeId("truncated", schema), label: TRUNCATED, depth, expandable: false, expanded: false }]
    : [];
  return [
    ...cut,
    ...f("Tables", (d) => tables(state, schema, objects, false, d)),
    ...f("Views", (d) => tables(state, schema, objects, true, d)),
    ...schemaLeaves(schema, objects).flatMap(([name, kind, items]) =>
      f(name, (d) => leaves(state, items, [kind, schema], d)),
    ),
  ];
}

/** The rows of the users and roles, once read. */
function security(state: CatalogState): TreeRow[] {
  const id = nodeId("security");
  if (state.filter !== "") {
    return [];
  }
  const expanded = state.expanded.includes(id);
  const row: TreeRow = { id, label: "Users and Roles", depth: 0, expandable: true, expanded };
  if (!expanded) {
    return [row];
  }
  if (state.security === null) {
    return [
      row,
      { id: nodeId("loading", "security"), label: "Loading…", depth: 1, expandable: false, expanded: false },
    ];
  }
  const users = state.security.users.map((u) => u.name);
  const roles = [...new Set(state.security.roles.map((r) => r.role))];
  return [
    row,
    ...leaves(
      state,
      users.map((name) => [name, { kind: "user", name }] as const),
      ["user", ""],
      1,
    ),
    ...leaves(
      state,
      roles.map((name) => [name, { kind: "role", name }] as const),
      ["role", ""],
      1,
    ),
  ];
}

/** Every row of the tree, as `state` has read and opened it. */
export function treeRows(state: CatalogState): TreeRow[] {
  const schemas = (state.schemas ?? []).flatMap((s) => {
    const id = nodeId("schema", s.name);
    const expanded = state.filter !== "" || state.expanded.includes(id);
    const row: TreeRow = {
      id,
      label: s.name,
      depth: 0,
      expandable: true,
      expanded,
      select: { kind: "schema", schema: s.name },
    };
    if (!expanded) {
      return [row];
    }
    const parts = schemaParts(state, s.name, 1);
    return state.filter !== "" && parts.every((p) => p.label === "Loading…") ? [] : [row, ...parts];
  });
  return [...schemas, ...security(state)];
}
