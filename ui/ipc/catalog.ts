/**
 * The catalog's commands, typed as the backend gives them (RULES.md D33,
 * R-TS-2): schemas, a schema's objects, an object whole, its definition,
 * its dependencies, and a search.
 */
import { invoke } from "@tauri-apps/api/core";

/** A schema. */
export interface Schema {
  readonly name: string;
  readonly owner: string | null;
}

/** A table or view, by name and kind. */
export interface TableRef {
  readonly name: string;
  readonly kind: string;
}

/** A routine, by its specific name, name and kind. */
export interface RoutineRef {
  readonly specific: string;
  readonly name: string;
  readonly kind: string;
}

/** A sequence generator. */
export interface Sequence {
  readonly name: string;
  readonly typeWritten: string;
  readonly start: string | null;
  readonly minimum: string | null;
  readonly maximum: string | null;
  readonly increment: string | null;
  readonly cycle: boolean;
}

/** A domain. */
export interface Domain {
  readonly name: string;
  readonly typeWritten: string;
  readonly default: string | null;
  readonly checks: readonly (readonly [string, string])[];
}

/** What a schema holds. */
export interface SchemaObjects {
  readonly tables: readonly TableRef[];
  readonly routines: readonly RoutineRef[];
  readonly sequences: readonly Sequence[];
  readonly domains: readonly Domain[];
  readonly types: readonly (readonly [string, string])[];
  readonly truncated: boolean;
}

/** A column. */
export interface Column {
  readonly name: string;
  readonly position: number;
  readonly typeWritten: string;
  readonly default: string | null;
  readonly nullable: boolean;
  readonly identity: string | null;
  readonly generated: string | null;
  readonly domain: string | null;
}

/** What a foreign key references. */
export interface Reference {
  readonly schema: string;
  readonly table: string;
  readonly columns: readonly string[];
  readonly matching: string;
  readonly onUpdate: string;
  readonly onDelete: string;
}

/** A table's constraint. */
export interface Constraint {
  readonly name: string;
  readonly kind: string;
  readonly columns: readonly string[];
  readonly check: string | null;
  readonly references: Reference | null;
  readonly deferrable: boolean;
}

/** An index. */
export interface Index {
  readonly name: string;
  readonly method: string;
  readonly unique: boolean;
  readonly columns: readonly string[];
  readonly implied: boolean;
  readonly options: readonly (readonly [string, string])[];
}

/** A partition of a partitioned table. */
export interface Partition {
  readonly schema: string;
  readonly name: string;
  readonly bound: string;
  readonly partitioned: boolean;
}

/** A trigger. */
export interface Trigger {
  readonly schema: string;
  readonly name: string;
  readonly event: string;
  readonly timing: string;
  readonly orientation: string;
  readonly condition: string | null;
  readonly action: string | null;
}

/** A privilege on a table. */
export interface Privilege {
  readonly grantor: string;
  readonly grantee: string;
  readonly privilege: string;
  readonly grantable: boolean;
  readonly column: string | null;
}

/** A table or view, whole. */
export interface TableDetail {
  readonly schema: string;
  readonly name: string;
  readonly kind: string;
  readonly columns: readonly Column[];
  readonly constraints: readonly Constraint[];
  readonly indexes: readonly Index[];
  readonly triggers: readonly Trigger[];
  readonly privileges: readonly Privilege[];
  readonly view: { readonly definition: string | null; readonly checkOption: string } | null;
  readonly partitioning: {
    readonly strategy: string;
    readonly key: string;
    readonly partitions: readonly Partition[];
  } | null;
  readonly partitionOf: { readonly schema: string; readonly name: string; readonly bound: string } | null;
}

/** A user-defined type. */
export interface UserType {
  readonly schema: string;
  readonly name: string;
  readonly category: string;
  readonly instantiable: boolean;
  readonly isFinal: boolean;
  readonly source: string | null;
  readonly attributes: readonly {
    readonly name: string;
    readonly typeWritten: string;
    readonly default: string | null;
  }[];
}

/** A routine's parameter. */
export interface Parameter {
  readonly mode: string;
  readonly name: string | null;
  readonly typeWritten: string;
}

/** A routine, whole. */
export interface RoutineDetail {
  readonly schema: string;
  readonly specific: string;
  readonly name: string;
  readonly kind: string;
  readonly returns: string | null;
  readonly parameters: readonly Parameter[];
  readonly body: string | null;
  readonly deterministic: boolean;
  readonly dataAccess: string;
  readonly privileges: readonly Privilege[];
}

/** The users, the roles granted and those enabled. */
export interface Security {
  readonly users: readonly { readonly name: string; readonly owner: boolean; readonly createRole: boolean }[];
  readonly roles: readonly { readonly grantee: string; readonly role: string; readonly grantable: boolean }[];
  readonly enabled: readonly string[];
  readonly administrable: readonly string[];
}

/** An object, by kind, schema and name. */
export interface ObjectRef {
  readonly kind: string;
  readonly schema: string;
  readonly name: string;
}

/** What an object uses, and what uses it. */
export interface Dependencies {
  readonly uses: readonly ObjectRef[];
  readonly usedBy: readonly ObjectRef[];
}

/** An object a search found. */
export interface Found {
  readonly object: ObjectRef;
  readonly inDefinition: boolean;
}

/** What a table is scripted as. */
export type ScriptAs = "create" | "alter" | "drop" | "select" | "insert" | "update" | "delete";

/** What a definition is asked of. */
export type DefinitionOf =
  | { readonly kind: "table"; readonly schema: string; readonly name: string; readonly script: ScriptAs }
  | { readonly kind: "routine"; readonly schema: string; readonly specific: string }
  | { readonly kind: "sequence"; readonly schema: string; readonly name: string }
  | { readonly kind: "domain"; readonly schema: string; readonly name: string }
  | { readonly kind: "type"; readonly schema: string; readonly name: string }
  | { readonly kind: "schema"; readonly schema: string };

/** The schemas the user may see. */
export function catalogSchemas(connection: number): Promise<Schema[]> {
  return invoke<Schema[]>("catalog_schemas", { connection });
}

/** What a schema holds. */
export function catalogObjects(connection: number, schema: string): Promise<SchemaObjects> {
  return invoke<SchemaObjects>("catalog_objects", { connection, schema });
}

/** A table or view, whole. */
export function catalogTable(connection: number, schema: string, name: string): Promise<TableDetail> {
  return invoke<TableDetail>("catalog_table", { connection, schema, name });
}

/** A routine, whole. */
export function catalogRoutine(connection: number, schema: string, specific: string): Promise<RoutineDetail> {
  return invoke<RoutineDetail>("catalog_routine", { connection, schema, specific });
}

/** A user-defined type, whole. */
export function catalogType(connection: number, schema: string, name: string): Promise<UserType> {
  return invoke<UserType>("catalog_type", { connection, schema, name });
}

/** USAGE granted on a domain or a sequence generator. */
export function catalogUsage(
  connection: number,
  schema: string,
  name: string,
  of: "domain" | "sequence",
): Promise<Privilege[]> {
  return invoke<Privilege[]>("catalog_usage", { connection, schema, name, of });
}

/** The users and roles. */
export function catalogSecurity(connection: number): Promise<Security> {
  return invoke<Security>("catalog_security", { connection });
}

/** What an object uses, and what uses it. */
export function catalogDependencies(connection: number, schema: string, name: string): Promise<Dependencies> {
  return invoke<Dependencies>("catalog_dependencies", { connection, schema, name });
}

/** The objects whose names or definitions hold `text`. */
export function catalogSearch(connection: number, text: string): Promise<Found[]> {
  return invoke<Found[]>("catalog_search", { connection, text });
}

/** An object's definition as SQL, or a table scripted as a statement. */
export function catalogDefinition(connection: number, of: DefinitionOf): Promise<string> {
  return invoke<string>("catalog_definition", { connection, of });
}

/** Asks where to save `text`, suggesting `name`: the path written, or null if cancelled. */
export function saveTextFile(name: string, text: string): Promise<string | null> {
  return invoke<string | null>("save_text_file", { name, text });
}
