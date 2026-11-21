/**
 * The details of the object selected in the explorer (RULES.md D33): a
 * table's columns, keys, indexes, triggers, privileges, dependencies and
 * definition; a routine's parameters, body and definition; a sequence's,
 * a domain's and a schema's definition; a user's or role's grants. Every
 * name and value is shown as text (R-UI-4).
 */
import { type ReactNode, useEffect, useState } from "react";
import {
  catalogDependencies,
  catalogRoutine,
  catalogType,
  catalogUsage,
  type Dependencies,
  type Index,
  type Privilege,
  type Security,
  type TableDetail,
} from "../ipc/catalog";
import { isStudioError } from "../state/actions";
import { useStore, useStudio } from "../state/store";
import { Icon, type IconName } from "../icons/Icon";
import { type Selected, tableKey } from "./catalogState";
import { Definition } from "./Definition";
import { TableActions } from "./TableActions";
import { sameObject, savedOf, toggleFavourite } from "./Favourites";

/** A table of `rows`, under `headings`. */
export function Table({
  headings,
  rows,
  label,
}: {
  headings: readonly string[];
  rows: readonly (readonly string[])[];
  label: string;
}) {
  if (rows.length === 0) {
    return <p className="hint">None.</p>;
  }
  return (
    <table className="details-table" aria-label={label}>
      <thead>
        <tr>
          {headings.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={`${String(i)}.${row[0] ?? ""}`}>
            {row.map((cell, j) => (
              <td key={`${String(j)}.${cell}`}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Tabs of `parts`, the first shown first. */
function Tabs({ parts }: { parts: readonly (readonly [string, () => ReactNode])[] }) {
  const [shown, setShown] = useState(0);
  const part = parts[shown] ?? parts[0];
  return (
    <>
      <div role="tablist" className="tabs">
        {parts.map(([name], i) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={i === shown}
            onClick={() => {
              setShown(i);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div role="tabpanel">{part?.[1]()}</div>
    </>
  );
}

/** What `read` gives, read as the component is shown: null until read, or why it failed. */
function useRead<T>(read: () => Promise<T>, of: readonly unknown[]): T | string | null {
  const [got, setGot] = useState<{ of: string; value: T | string } | null>(null);
  const key = JSON.stringify(of);
  useEffect(() => {
    let current = true;
    const told = (value: T | string) => {
      if (current) {
        setGot({ of: key, value });
      }
    };
    read().then(told, (thrown: unknown) => {
      told(`Cannot read it: ${isStudioError(thrown) ? thrown.message : String(thrown)}`);
    });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` names what is read
  }, [key]);
  return got?.of === key ? got.value : null;
}

/** What an object uses, and what uses it, read as shown. */
function DependencyList({ connection, schema, name }: { connection: number; schema: string; name: string }) {
  const found = useRead(() => catalogDependencies(connection, schema, name), [connection, schema, name]);
  if (typeof found === "string" || found === null) {
    return <p className="hint">{found ?? "Reading…"}</p>;
  }
  const rows = (list: Dependencies["uses"]) => list.map((o) => [o.kind, o.schema, o.name]);
  return (
    <>
      <h4>Uses</h4>
      <Table label="Uses" headings={["Kind", "Schema", "Name"]} rows={rows(found.uses)} />
      <h4>Used by</h4>
      <Table label="Used by" headings={["Kind", "Schema", "Name"]} rows={rows(found.usedBy)} />
    </>
  );
}

/** A table's columns, as rows of text. */
function columnRows(detail: TableDetail): string[][] {
  return detail.columns.map((c) => [
    c.name,
    c.typeWritten,
    c.nullable ? "YES" : "NO",
    c.default ?? "",
    c.identity === null ? (c.generated ?? "") : `IDENTITY ${c.identity}`,
  ]);
}

/** A table's constraints, as rows of text. */
function constraintRows(detail: TableDetail): string[][] {
  return detail.constraints.map((k) => {
    const r = k.references;
    const target =
      r === null ? (k.check ?? "") : `${r.schema}.${r.table} (${r.columns.join(", ")}) ON DELETE ${r.onDelete}`;
    return [k.name, k.kind, k.columns.join(", "), target];
  });
}

/** The headings of a table of privileges. */
const PRIVILEGE_HEADINGS = ["Grantee", "Privilege", "Column", "Grantor", "Grantable"];

/** Privileges, as rows of text: a table's own with no column. */
function privilegeRows(privileges: readonly Privilege[]): string[][] {
  return privileges.map((p) => [p.grantee, p.privilege, p.column ?? "", p.grantor, p.grantable ? "YES" : "NO"]);
}

/** USAGE granted on a domain or sequence generator, read as shown. */
function Usage({
  connection,
  schema,
  name,
  of,
}: {
  connection: number;
  schema: string;
  name: string;
  of: "domain" | "sequence";
}) {
  const found = useRead(() => catalogUsage(connection, schema, name, of), [connection, schema, name, of]);
  if (typeof found === "string" || found === null) {
    return <p className="hint">{found ?? "Reading…"}</p>;
  }
  return <Table label="Usage" headings={PRIVILEGE_HEADINGS} rows={privilegeRows(found)} />;
}

/** What separates the parts of the name of an index a partitioned table's index made on a partition. */
const NAME_PARTS = "\u0000";

/** A name as shown: an index's made on a partition with its parts apart by a slash. */
export function shownName(name: string): string {
  return name.split(NAME_PARTS).join(" / ");
}

/** What the server made an index for, if it made it. */
function madeFor(index: Index): string {
  if (!index.implied) {
    return "";
  }
  return index.name.includes(NAME_PARTS) ? "its table's index" : "a key";
}

/** A table's partitions, or the table it is a partition of. */
function Partitions({ detail }: { detail: TableDetail }) {
  const of = detail.partitionOf;
  const by = detail.partitioning;
  return (
    <>
      {of !== null && (
        <p>
          A partition of {of.schema}.{of.name}: {of.bound}
        </p>
      )}
      {by !== null && (
        <>
          <p>
            PARTITION BY {by.strategy} ({by.key})
          </p>
          <Table
            label="Partitions"
            headings={["Schema", "Partition", "Bound", "Partitioned again"]}
            rows={by.partitions.map((p) => [p.schema, p.name, p.bound, p.partitioned ? "YES" : "NO"])}
          />
        </>
      )}
    </>
  );
}

/** A table's tabs, each its heading and its rows. */
function tableTabs(detail: TableDetail): (readonly [string, readonly string[], string[][]])[] {
  return [
    ["Columns", ["Name", "Type", "Null", "Default", "Identity or generated"], columnRows(detail)],
    ["Keys and checks", ["Name", "Kind", "Columns", "References or condition"], constraintRows(detail)],
    [
      "Indexes",
      ["Name", "Method", "Unique", "Columns", "Options", "Made for"],
      detail.indexes.map((i) => [
        shownName(i.name),
        i.method,
        i.unique ? "YES" : "NO",
        i.columns.join(", "),
        i.options.map(([option, value]) => `${option} = ${value}`).join(", "),
        madeFor(i),
      ]),
    ],
    [
      "Triggers",
      ["Name", "When", "Event", "For each", "Action"],
      detail.triggers.map((t) => [t.name, t.timing, t.event, t.orientation, t.action ?? ""]),
    ],
    ["Privileges", PRIVILEGE_HEADINGS, privilegeRows(detail.privileges)],
  ];
}

/** A table's details. */
function TableDetails({ connection, detail }: { connection: number; detail: TableDetail }) {
  const of = { kind: "table", schema: detail.schema, name: detail.name, script: "create" } as const;
  const parts: (readonly [string, () => ReactNode])[] = tableTabs(detail).map(
    ([name, headings, rows]) => [name, () => <Table label={name} headings={headings} rows={rows} />] as const,
  );
  if (detail.partitioning !== null || detail.partitionOf !== null) {
    parts.push(["Partitions", () => <Partitions detail={detail} />]);
  }
  parts.push([
    "Dependencies",
    () => <DependencyList connection={connection} schema={detail.schema} name={detail.name} />,
  ]);
  parts.push(["Definition", () => <Definition connection={connection} of={of} />]);
  return <Tabs parts={parts} />;
}

/** A routine's details, read as shown. */
function RoutineDetails({ connection, schema, specific }: { connection: number; schema: string; specific: string }) {
  const detail = useRead(() => catalogRoutine(connection, schema, specific), [connection, schema, specific]);
  if (typeof detail === "string" || detail === null) {
    return <p className="hint">{detail ?? "Reading…"}</p>;
  }
  return (
    <Tabs
      parts={[
        [
          "Parameters",
          () => (
            <Table
              label="Parameters"
              headings={["Mode", "Name", "Type"]}
              rows={detail.parameters.map((p) => [p.mode, p.name ?? "", p.typeWritten])}
            />
          ),
        ],
        ["Body", () => <pre className="definition-text">{detail.body ?? "Shown to its schema's owner alone."}</pre>],
        [
          "Privileges",
          () => <Table label="Privileges" headings={PRIVILEGE_HEADINGS} rows={privilegeRows(detail.privileges)} />,
        ],
        ["Definition", () => <Definition connection={connection} of={{ kind: "routine", schema, specific }} />],
        [
          "Debug",
          () => (
            <>
              <button type="button" disabled>
                Debug
              </button>
              <p className="hint">{NO_DEBUGGER}</p>
            </>
          ),
        ],
      ]}
    />
  );
}

/** A type's details, read as shown. */
function TypeDetails({ connection, schema, name }: { connection: number; schema: string; name: string }) {
  const found = useRead(() => catalogType(connection, schema, name), [connection, schema, name]);
  if (typeof found === "string" || found === null) {
    return <p className="hint">{found ?? "Reading…"}</p>;
  }
  const shape = found.source === null ? `${found.isFinal ? "" : "not "}final` : `of ${found.source}`;
  return (
    <>
      <p>
        {found.category} type, {shape}
        {found.instantiable ? "" : ", not instantiable"}
      </p>
      {found.source === null && (
        <Table
          label="Attributes"
          headings={["Name", "Type", "Default"]}
          rows={found.attributes.map((a) => [a.name, a.typeWritten, a.default ?? ""])}
        />
      )}
      <Definition connection={connection} of={{ kind: "type", schema, name }} />
    </>
  );
}

/** Why a routine cannot be debugged yet. */
export const NO_DEBUGGER =
  "Unavailable: Turborel does not yet give a debugger of SQL routines, with breakpoints and stepping.";

/** The icon of each kind of object selected. */
const KIND_ICONS: Readonly<Record<Selected["kind"], IconName>> = {
  table: "table",
  routine: "routine",
  sequence: "sequence",
  domain: "domain",
  type: "type",
  schema: "schema",
  user: "user",
  role: "role",
};

/** The heading of `object`, with its favourite's star if the connection is saved. */
function Heading({ connection, object }: { connection: number; object: Selected }) {
  const store = useStore();
  const saved = useStudio(() => savedOf(store, connection));
  const ref =
    "schema" in object && "name" in object
      ? {
          kind: object.kind.toUpperCase(),
          schema: object.schema,
          name: object.kind === "routine" ? object.specific : object.name,
        }
      : null;
  const starred = ref !== null && saved?.favourites.some((f) => sameObject(f, ref)) === true;
  const title = "name" in object ? object.name : object.schema;
  return (
    <h3 className="details-title">
      <Icon name={KIND_ICONS[object.kind]} />
      {object.kind}: {"schema" in object && "name" in object ? `${object.schema}.${title}` : title}
      {ref !== null && saved !== undefined && (
        <button
          type="button"
          className="tool"
          aria-pressed={starred}
          onClick={() => void toggleFavourite(store, connection, ref)}
        >
          <Icon name="favourite" emphasis={starred} />
          {starred ? "Favourite" : "Add to favourites"}
        </button>
      )}
    </h3>
  );
}

/** A sequence generator's or a domain's definition and USAGE. */
function Generated({
  connection,
  kind,
  schema,
  name,
}: {
  connection: number;
  kind: "sequence" | "domain";
  schema: string;
  name: string;
}) {
  return (
    <Tabs
      parts={[
        ["Definition", () => <Definition connection={connection} of={{ kind, schema, name }} />],
        ["Usage", () => <Usage connection={connection} schema={schema} name={name} of={kind} />],
      ]}
    />
  );
}

/** The roles granted to a user, or a role's grantees. */
function Grants({ kind, name, security }: { kind: "user" | "role"; name: string; security: Security | null }) {
  const grants = (security?.roles ?? []).filter((r) => (kind === "user" ? r.grantee : r.role) === name);
  const administers = kind === "role" && security?.administrable.includes(name) === true;
  return (
    <>
      {administers && <p>You may grant, revoke and drop this role.</p>}
      <Table
        label="Roles"
        headings={["Grantee", "Role", "With admin option"]}
        rows={grants.map((r) => [r.grantee, r.role, r.grantable ? "YES" : "NO"])}
      />
    </>
  );
}

/** The parts of `object` of connection `connection`. */
function Parts({ connection, object }: { connection: number; object: Selected }) {
  const table = useStudio((s) =>
    object.kind === "table" ? s.catalogs[connection]?.tables[tableKey(object.schema, object.name)] : undefined,
  );
  const security = useStudio((s) => s.catalogs[connection]?.security ?? null);
  switch (object.kind) {
    case "table":
      return table === undefined ? (
        <p className="hint">Reading…</p>
      ) : (
        <>
          <TableActions connection={connection} schema={table.schema} table={table.name} kind={table.kind} />
          <TableDetails connection={connection} detail={table} />
        </>
      );
    case "routine":
      return <RoutineDetails connection={connection} schema={object.schema} specific={object.specific} />;
    case "type":
      return <TypeDetails connection={connection} schema={object.schema} name={object.name} />;
    case "sequence":
    case "domain":
      return <Generated connection={connection} kind={object.kind} schema={object.schema} name={object.name} />;
    case "schema":
      return <Definition connection={connection} of={{ kind: "schema", schema: object.schema }} />;
    case "user":
    case "role":
      return <Grants kind={object.kind} name={object.name} security={security} />;
  }
}

/** The details panel. */
export function Details() {
  const selected = useStudio((s) => s.selected);
  if (selected === null) {
    return <div className="panel-empty">Nothing is selected.</div>;
  }
  return (
    <div className="panel details" role="region" aria-label="Details">
      <Heading connection={selected.connection} object={selected.object} />
      <Parts connection={selected.connection} object={selected.object} />
    </div>
  );
}
