/**
 * Turborel's built-in functions, for completion (RULES.md D40): each
 * signature of its manual's tables of functions, as `cargo xtask headings`
 * copies them at the pinned commit, with what it gives and where the
 * manual says so; and the few its manual describes under headings of
 * their own.
 */
import table from "./turborel-functions.tsv?raw";

/** A built-in function. */
export interface BuiltIn {
  readonly name: string;
  readonly signature: string;
  readonly value: string;
  readonly page: string;
  readonly heading: string;
}

/** The functions the manual describes under headings of their own, each by its page and heading. */
const OWN_HEADINGS: readonly BuiltIn[] = [
  {
    name: "COALESCE",
    signature: "COALESCE(a, b [, ...])",
    value: "the first of its values that is not null",
    page: "sql/04-expressions.md",
    heading: "CASE, NULLIF and COALESCE",
  },
  {
    name: "NULLIF",
    signature: "NULLIF(a, b)",
    value: "null if a equals b, else a",
    page: "sql/04-expressions.md",
    heading: "CASE, NULLIF and COALESCE",
  },
  {
    name: "GREATEST",
    signature: "GREATEST(a, b [, ...])",
    value: "the greatest of its values",
    page: "sql/04-expressions.md",
    heading: "GREATEST and LEAST",
  },
  {
    name: "LEAST",
    signature: "LEAST(a, b [, ...])",
    value: "the least of its values",
    page: "sql/04-expressions.md",
    heading: "GREATEST and LEAST",
  },
  {
    name: "UUID_V4",
    signature: "UUID_V4()",
    value: "a random UUID",
    page: "sql/04-expressions.md",
    heading: "UUID_V4 and UUID_V7",
  },
  {
    name: "UUID_V7",
    signature: "UUID_V7()",
    value: "a UUID ordered by time",
    page: "sql/04-expressions.md",
    heading: "UUID_V4 and UUID_V7",
  },
  {
    name: "CAST",
    signature: "CAST(x AS type)",
    value: "x as a value of type",
    page: "sql/04-expressions.md",
    heading: "CAST",
  },
];

/** The functions of the manual's tables, then those of headings of their own, each name and signature once. */
export function builtIns(source: string = table): BuiltIn[] {
  const rows = source
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const [page = "", heading = "", signature = "", value = ""] = line.split("\t");
      const open = signature.indexOf("(");
      return { name: open === -1 ? "" : signature.slice(0, open).trim(), signature, value, page, heading };
    });
  const seen = new Set<string>();
  return [...rows, ...OWN_HEADINGS].filter((f) => {
    const key = `${f.name}\u0000${f.signature}`;
    if (seen.has(key) || f.name === "") {
      return false;
    }
    seen.add(key);
    return true;
  });
}
