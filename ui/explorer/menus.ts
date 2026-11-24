/**
 * The explorer's context menus (RULES.md D53): of a connection, a schema,
 * a table or view, and the parts of each, every item doing what the
 * explorer's buttons, the details' actions and the commands do. What
 * destroys or renames runs in a worksheet of its own, through the
 * connection's guards, as anything typed.
 */
import { namer } from "../data/ddl";
import { openDdl } from "../data/ddlActions";
import type { DataTask } from "../data/tasks";
import { catalogDefinition, catalogRoutine, type DefinitionOf, type Parameter, type ScriptAs } from "../ipc/catalog";
import type { ConnectionSpec } from "../ipc/connections";
import { attempt, show } from "../state/actions";
import { loadSchemas, loadTable, select } from "../state/catalog";
import { runStatements } from "../state/running";
import type { Store } from "../state/store";
import { changeWorksheet, openWorksheet } from "../state/worksheets";
import type { MenuEntry, MenuItem } from "../shell/ContextMenu";
import { prompted } from "../shell/PromptDialog";
import { baseTables, readModel } from "../model/live";
import { openModel } from "../model/models";
import { openSecurity } from "../admin/menus";

/** The rows a table's data opens with. */
export const OPEN_ROWS = 200;

/** `name` as SQL writes it, of the store's reserved words. */
function named(store: Store, name: string): string {
  return namer(store.current().reservedWords)(name);
}

/** `schema`.`name` as SQL writes them. */
export function qualifiedName(store: Store, schema: string, name: string): string {
  return `${named(store, schema)}.${named(store, name)}`;
}

/** Copies `text` to the clipboard, its failure the error shown. */
export function copyText(store: Store, text: string): Promise<void> {
  return attempt(store, () => navigator.clipboard.writeText(text)).then(() => undefined);
}

/** A new worksheet on `connection`, its session's schema set to `schema` first where it is another. */
export async function newWorksheetOn(store: Store, connection: number, schema: string | null): Promise<string> {
  const id = openWorksheet(store, "");
  changeWorksheet(store, id, (w) => ({ ...w, connection }));
  const session = store.current().open.find((c) => c.id === connection)?.session;
  if (schema !== null && session !== undefined && session.schema !== schema) {
    await runStatements(store, id, [
      { sql: `SET SCHEMA '${schema.replaceAll("'", "''")}'`, from: 0, to: 0, class: "session" },
    ]);
  }
  return id;
}

/** Runs `sql`, titled `title`, in a worksheet of its own on `connection`, through the guards. */
function runInWorksheet(store: Store, connection: number, sql: string, title: string): Promise<void> {
  return openDdl(store, connection, { sql, title }, true).then(() => undefined);
}

/** Shows `task`'s dialog. */
function task(store: Store, t: DataTask): () => void {
  return () => {
    show(store, { kind: "data", task: t });
  };
}

/** The connection URI of `spec`, with no password: its own URI's taken out, or one written of its settings. */
export function uriOf(spec: ConnectionSpec): string {
  if (spec.uri !== undefined && spec.uri !== "") {
    return spec.uri.replace(/^(turborel:\/\/[^:@/?]*):[^@/?]*@/u, "$1@");
  }
  const settings: [string, string | undefined][] = [
    ["port", spec.port],
    ["tls_mode", spec.tlsMode],
    ["channel_binding", spec.channelBinding],
    ["connect_timeout", spec.connectTimeout],
    ["service", spec.service],
    ["service_file", spec.serviceFile],
    ["passfile", spec.passfile],
    ["target", spec.target],
    ["load_balance", spec.loadBalance],
    ["tls_roots", spec.tlsRoots],
    ["tls_system_roots", spec.tlsSystemRoots],
    ["tls_certificate", spec.tlsCertificate],
    ["tls_key", spec.tlsKey],
    ["server_name", spec.serverName],
  ];
  const query = settings
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v ?? "")}`)
    .join("&");
  const user = spec.user === undefined || spec.user === "" ? "" : `${encodeURIComponent(spec.user)}@`;
  const hosts = (spec.host ?? "")
    .split(",")
    .map((h) => (h.includes("/") || h.includes("\\") ? encodeURIComponent(h.trim()) : h.trim()))
    .join(",");
  return `turborel://${user}${hosts}${query === "" ? "" : `/?${query}`}`;
}

/** The kinds of script of a table, and their names. */
const SCRIPTS: readonly (readonly [ScriptAs, string])[] = [
  ["create", "CREATE"],
  ["alter", "ALTER"],
  ["drop", "DROP"],
  ["select", "SELECT"],
  ["insert", "INSERT"],
  ["update", "UPDATE"],
  ["delete", "DELETE"],
];

/** The submenu that writes `of`'s definition, to a worksheet or the clipboard. */
function scriptTo(store: Store, connection: number, label: string, of: DefinitionOf): MenuEntry {
  const text = () => catalogDefinition(connection, of);
  return {
    label,
    items: [
      {
        label: "To Worksheet",
        icon: "worksheet",
        run: () =>
          attempt(store, async () => {
            const sql = await text();
            const id = openWorksheet(store, sql, label);
            changeWorksheet(store, id, (w) => ({ ...w, connection }));
          }).then(() => undefined),
      },
      {
        label: "To Clipboard",
        icon: "copy",
        run: () => attempt(store, async () => navigator.clipboard.writeText(await text())).then(() => undefined),
      },
    ],
  };
}

/** The items that copy `name`, and its qualified name where it has a schema. */
function copyItems(store: Store, name: string, schema: string | null): MenuItem[] {
  return [
    { label: "Copy Name", icon: "copy", run: () => copyText(store, named(store, name)) },
    ...(schema === null
      ? []
      : [
          {
            label: "Copy Qualified Name",
            icon: "copy",
            run: () => copyText(store, qualifiedName(store, schema, name)),
          } as const,
        ]),
  ];
}

/** The item that drops by `sql`, after the guards ask. */
function dropItem(store: Store, connection: number, label: string, sql: string): MenuEntry {
  return { label, icon: "remove", destructive: true, run: () => runInWorksheet(store, connection, sql, label) };
}

/** The menu of schema `schema` on `connection`. */
export function schemaMenu(store: Store, connection: number, schema: string): MenuItem[] {
  return [
    { label: "New Worksheet", icon: "newWorksheet", run: () => newWorksheetOn(store, connection, schema) },
    "separator",
    { label: "Create Table…", icon: "table", run: task(store, { kind: "createTable", connection, schema }) },
    { label: "Import into New Table…", icon: "open", run: task(store, { kind: "importNew", connection, schema }) },
    { label: "Generate Script…", icon: "definition", run: task(store, { kind: "generate", connection, schema }) },
    {
      label: "Open Model",
      icon: "graph",
      run: () =>
        attempt(store, async () => {
          const model = await readModel(connection, schema, {
            tables: await baseTables(connection, schema),
            name: schema,
          });
          openModel(store, model, { connection });
        }).then(() => undefined),
    },
    { label: "Compare Schema…", icon: "compare", run: task(store, { kind: "compareSchemas", connection, schema }) },
    {
      label: "Analyze Schema…",
      icon: "analyze",
      run: () => {
        show(store, { kind: "analyzer", connection, schema });
      },
    },
    "separator",
    ...copyItems(store, schema, null),
    { label: "Properties", icon: "details", run: () => select(store, connection, { kind: "schema", schema }) },
    { label: "Refresh", icon: "reconnect", run: () => loadSchemas(store, connection) },
  ];
}

/** The items of base table `name`'s tasks: its rows opened filtered, altered, its indexes, analysis, import, export and comparison. */
function tableTasks(store: Store, connection: number, schema: string, name: string): MenuItem[] {
  const of = { connection, schema, table: name };
  const analyzer = (tab?: "indexes") => () => {
    show(store, { kind: "analyzer", connection, schema, table: name, ...(tab === undefined ? {} : { tab }) });
  };
  return [
    { label: "Open Data Filtered…", icon: "filter", run: task(store, { kind: "editRows", ...of }) },
    { label: "Alter Table…", icon: "edit", run: task(store, { kind: "alterTable", ...of }) },
    { label: "Indexes…", icon: "index", run: analyzer("indexes") },
    { label: "Analyze Table…", icon: "analyze", run: analyzer() },
    "separator",
    { label: "Import…", icon: "open", run: task(store, { kind: "import", ...of }) },
    { label: "Export…", icon: "export", run: task(store, { kind: "export", ...of }) },
    { label: "Compare Rows…", icon: "compare", run: task(store, { kind: "compare", ...of }) },
  ];
}

/** The item that renames base table `table`, `name` of `schema`, after asking its new name. */
function renameTable(store: Store, connection: number, table: string, name: string): MenuEntry {
  return {
    label: "Rename…",
    icon: "edit",
    run: async () => {
      const to = await prompted(store, `Rename ${name}`, "New name", name);
      if (to !== null) {
        await runInWorksheet(store, connection, `ALTER TABLE ${table} RENAME TO ${named(store, to)}`, `Rename ${name}`);
      }
    },
  };
}

/** The menu of table or view `name` of `schema` on `connection`, a view if `view`. */
export function tableMenu(store: Store, connection: number, schema: string, name: string, view: boolean): MenuItem[] {
  const table = qualifiedName(store, schema, name);
  const scripts = (view ? SCRIPTS.filter(([s]) => s === "create" || s === "select" || s === "drop") : SCRIPTS).map(
    ([script, label]) => scriptTo(store, connection, label, { kind: "table", schema, name, script }),
  );
  const selected = () => select(store, connection, { kind: "table", schema, name });
  return [
    { label: "New Worksheet", icon: "newWorksheet", run: () => newWorksheetOn(store, connection, schema) },
    {
      label: "Open Data",
      icon: "table",
      run: () =>
        runInWorksheet(store, connection, `SELECT * FROM ${table} FETCH FIRST ${String(OPEN_ROWS)} ROWS ONLY`, name),
    },
    ...(view ? [] : tableTasks(store, connection, schema, name)),
    { label: "Script As", icon: "definition", items: scripts },
    "separator",
    ...copyItems(store, name, schema),
    ...(view ? [] : [renameTable(store, connection, table, name)]),
    {
      label: "Privileges…",
      icon: "key",
      run: openSecurity(store, connection, { kind: "privileges", table, title: `${schema}.${name}` }),
    },
    dropItem(store, connection, view ? "Drop View" : "Drop Table", `DROP ${view ? "VIEW" : "TABLE"} ${table} RESTRICT`),
    "separator",
    { label: "Dependencies", icon: "foreignKey", run: selected },
    { label: "Properties", icon: "details", run: selected },
    { label: "Refresh", icon: "reconnect", run: () => loadTable(store, connection, schema, name) },
  ];
}

/** What a part of a table is: its kind, its table, and its name. */
export interface PartOf {
  readonly kind: "column" | "constraint" | "index" | "trigger";
  readonly schema: string;
  readonly table: string;
  readonly name: string;
}

/** The menu of a column, constraint, index or trigger of a table on `connection`. */
export function partMenu(store: Store, connection: number, part: PartOf): MenuItem[] {
  const table = qualifiedName(store, part.schema, part.table);
  const name = named(store, part.name);
  const drops: Record<PartOf["kind"], MenuItem[]> = {
    column: [
      {
        label: "Rename Column…",
        icon: "edit",
        run: async () => {
          const to = await prompted(store, `Rename ${part.name}`, "New name", part.name);
          if (to !== null) {
            await runInWorksheet(
              store,
              connection,
              `ALTER TABLE ${table} RENAME COLUMN ${name} TO ${named(store, to)}`,
              `Rename ${part.name}`,
            );
          }
        },
      },
      dropItem(store, connection, "Drop Column", `ALTER TABLE ${table} DROP COLUMN ${name} RESTRICT`),
    ],
    constraint: [
      dropItem(store, connection, "Drop Constraint", `ALTER TABLE ${table} DROP CONSTRAINT ${name} RESTRICT`),
    ],
    index: [dropItem(store, connection, "Drop Index", `DROP INDEX ${name}`)],
    trigger: [
      dropItem(store, connection, "Drop Trigger", `DROP TRIGGER ${qualifiedName(store, part.schema, part.name)}`),
    ],
  };
  return [
    ...copyItems(store, part.name, null),
    ...drops[part.kind],
    "separator",
    {
      label: "Properties",
      icon: "details",
      run: () => select(store, connection, { kind: "table", schema: part.schema, name: part.table }),
    },
  ];
}

/**
 * An argument of a CALL the routine runner writes, of `p`: a `?` the worksheet asks for; but DEFAULT, its default
 * written after it in a comment, of an IN parameter that has one, which the user may write a value for instead, or
 * leave so (Turborel's D979; RULES.md D71). An INOUT parameter keeps its `?`, as DEFAULT would give its value back
 * nowhere.
 */
export function argumentOf(p: Parameter): string {
  if (p.mode !== "IN" || p.default === null) {
    return "?";
  }
  // The default is the server's text: written in a comment only where it can neither end the comment nor open one
  // within it, so it is never read as SQL (R-SAFE-2).
  return /\/\*|\*\//u.test(p.default) ? "DEFAULT" : `DEFAULT /* ${p.default} */`;
}

/** Opens a worksheet that runs routine `specific` of `schema`, each parameter an argument as `argumentOf` writes it. */
async function execute(store: Store, connection: number, schema: string, specific: string): Promise<void> {
  await attempt(store, async () => {
    const r = await catalogRoutine(connection, schema, specific);
    const args = r.parameters.map(argumentOf).join(", ");
    const called = `${qualifiedName(store, schema, r.name)}(${args})`;
    const sql = r.kind === "PROCEDURE" ? `CALL ${called}` : `VALUES (${called})`;
    await runInWorksheet(store, connection, sql, r.name);
  });
}

/** The name of the item that drops a routine, sequence, domain or type. */
const DROPS = { routine: "Drop Routine", sequence: "Drop Sequence", domain: "Drop Domain", type: "Drop Type" } as const;

/** The menu of a routine, sequence, domain or type of `schema` on `connection`. */
export function objectMenu(
  store: Store,
  connection: number,
  object: {
    readonly kind: "routine" | "sequence" | "domain" | "type";
    readonly schema: string;
    readonly name: string;
    readonly specific?: string;
  },
): MenuItem[] {
  const { kind, schema, name } = object;
  const specific = object.specific ?? name;
  const of: DefinitionOf = kind === "routine" ? { kind, schema, specific } : { kind, schema, name };
  const drop =
    kind === "routine"
      ? `DROP SPECIFIC ROUTINE ${qualifiedName(store, schema, specific)} RESTRICT`
      : `DROP ${kind.toUpperCase()} ${qualifiedName(store, schema, name)} RESTRICT`;
  return [
    ...(kind === "routine"
      ? [
          { label: "Execute…", icon: "run", run: () => execute(store, connection, schema, specific) } as const,
          "separator" as const,
        ]
      : []),
    { label: "Script As", icon: "definition", items: [scriptTo(store, connection, "CREATE", of)] },
    ...copyItems(store, name, schema),
    dropItem(store, connection, DROPS[kind], drop),
    "separator",
    {
      label: "Properties",
      icon: "details",
      run: () =>
        select(store, connection, kind === "routine" ? { kind, schema, specific, name } : { kind, schema, name }),
    },
  ];
}
