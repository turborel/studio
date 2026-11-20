/**
 * Turborel's SQL as the editor reads it (RULES.md D36): its reserved words
 * from Turborel's own lexer, given by the backend; the words its
 * statements read that are no reserved words (Turborel's `appendix/
 * b-key-words.md`); and its types (its `sql/02-data-types.md`). A name is
 * written as Turborel's lexer reads it back: bare where it is a regular
 * identifier in upper case and no reserved word, else delimited.
 */
import { SQLDialect } from "@codemirror/lang-sql";

/**
 * Words Turborel's statements read where they write them, though none is
 * one of SQL-92's reserved words: those its appendix of key words names,
 * and those its statements' pages write, as CREATE FUNCTION's RETURNS.
 * The editor colours them as key words; Turborel reads each as an
 * identifier anywhere else.
 */
export const STATEMENT_WORDS: readonly string[] = [
  "EXPLAIN",
  "ANALYZE",
  "INDEX",
  "PASSWORD",
  "DATABASE",
  "OWNER",
  "CANCEL",
  "RESEAL",
  "BACKUP",
  "INCREMENTAL",
  "LABEL",
  "RESTORE",
  "POINT",
  "RESCAN",
  "TARGET",
  "COMMITTED",
  "UNCOMMITTED",
  "REPEATABLE",
  "SERIALIZABLE",
  "STATEMENT",
  "RECURSIVE",
  "PARTITION",
  "RANGE",
  "OVER",
  "WINDOW",
  "FILTER",
  "CYCLE",
  "START",
  "ROLLUP",
  "CUBE",
  "GROUPING",
  "LATERAL",
  "RETURNS",
  "RETURN",
  "FUNCTION",
  "TRIGGER",
  "SEQUENCE",
  "ROLE",
  "SAVEPOINT",
  "RELEASE",
  "MERGE",
  "MATCHED",
  "IF",
  "LOOP",
  "WHILE",
  "REPEAT",
  "UNTIL",
  "DO",
  "ELSEIF",
  "CALL",
  "TRUNCATE",
  "DETERMINISTIC",
  "CONTAINS",
  "READS",
  "MODIFIES",
  "DATA",
  "EXTENSION",
  "PERIOD",
  "SYSTEM_TIME",
  "VERSIONING",
  "OVERLAPS",
  "WITHOUT",
  "PORTION",
  "RENAME",
  "ATTACH",
  "DETACH",
  "USING",
];

/** Turborel's types, as its chapter of data types names them. */
export const TYPE_WORDS: readonly string[] = [
  "CHARACTER",
  "CHAR",
  "VARCHAR",
  "VARYING",
  "NCHAR",
  "NATIONAL",
  "BINARY",
  "VARBINARY",
  "CLOB",
  "NCLOB",
  "BLOB",
  "LARGE",
  "OBJECT",
  "BOOLEAN",
  "NUMERIC",
  "DECIMAL",
  "DEC",
  "INTEGER",
  "INT",
  "SMALLINT",
  "BIGINT",
  "REAL",
  "DOUBLE",
  "PRECISION",
  "FLOAT",
  "DECFLOAT",
  "DATE",
  "TIME",
  "TIMESTAMP",
  "INTERVAL",
  "ZONE",
  "ROW",
  "ARRAY",
  "MULTISET",
  "REF",
  "JSON",
  "XML",
  "UUID",
  "FULLTEXT",
  "FT_PATTERN",
  "VECTOR",
  "ST_GEOMETRY",
  "GEOMETRY",
  "ST_POINT",
  "POINT",
  "ST_LINESTRING",
  "LINESTRING",
  "ST_POLYGON",
  "POLYGON",
];

/** The editor's dialect of Turborel's SQL, of its reserved words `reserved`. */
export function turborelDialect(reserved: readonly string[]): SQLDialect {
  const types = new Set(TYPE_WORDS);
  const keywords = [...new Set([...reserved, ...STATEMENT_WORDS])].filter((w) => !types.has(w));
  return SQLDialect.define({
    keywords: keywords.join(" ").toLowerCase(),
    types: TYPE_WORDS.join(" ").toLowerCase(),
    builtin: "current_date current_time current_timestamp current_user session_user system_user user",
    identifierQuotes: '"',
    caseInsensitiveIdentifiers: true,
    specialVar: "?:",
  });
}

/** A regular identifier: a letter, then letters, digits and underscores. */
const REGULAR = /^[A-Z][A-Z0-9_]*$/u;

/** `name` as SQL writes it, of `reserved` words: bare if Turborel reads it back so, else delimited. */
export function sqlName(name: string, reserved: ReadonlySet<string>): string {
  if (REGULAR.test(name) && !reserved.has(name)) {
    return name;
  }
  return `"${name.replaceAll('"', '""')}"`;
}

/** The words the formatter writes in the key words' case: reserved, the statements', and the types. */
export function formatWords(reserved: readonly string[]): ReadonlySet<string> {
  return new Set([...reserved, ...STATEMENT_WORDS, ...TYPE_WORDS]);
}
