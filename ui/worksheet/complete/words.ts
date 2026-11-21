/**
 * A statement's sources read by its words (RULES.md D40), where Turborel's
 * parser cannot read it, as a statement being written seldom parses: each
 * table FROM, JOIN, INTO and UPDATE name, its schema and alias; each
 * common table expression WITH names, and its columns; each derived
 * table's alias.
 */
import { type Token, tokens } from "./context";
import type { ScopeSource } from "./engine";
import { unquote } from "./engine";

/** Words that are no alias, after a table's name. */
const NOT_ALIASES = new Set([
  "ON",
  "WHERE",
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "OUTER",
  "CROSS",
  "NATURAL",
  "GROUP",
  "ORDER",
  "HAVING",
  "UNION",
  "EXCEPT",
  "INTERSECT",
  "SET",
  "VALUES",
  "USING",
  "FETCH",
  "OFFSET",
  "WINDOW",
  "LIMIT",
  "SELECT",
  "DEFAULT",
  "AS",
]);

/** Whether `t` is a name. */
function isName(t: Token | undefined): t is Token {
  return t !== undefined && (t.kind === "word" || t.kind === "quoted");
}

/** The upper-cased text of a word, or a token's text. */
function up(t: Token | undefined): string {
  return t === undefined ? "" : t.kind === "word" ? t.text.toUpperCase() : t.text;
}

/** The table named from token `i`: its schema, name and alias, and where it ends. */
function tableAt(list: readonly Token[], i: number): { source: ScopeSource; next: number } | null {
  const first = list[i];
  if (!isName(first) || NOT_ALIASES.has(up(first))) {
    return null;
  }
  let at = i + 1;
  let schema: string | null = null;
  let name = unquote(first.text);
  const second = list[at + 1];
  if (list[at]?.text === "." && isName(second)) {
    schema = name;
    name = unquote(second.text);
    at += 2;
  }
  if (up(list[at]) === "AS") {
    at += 1;
  }
  const alias = list[at];
  const aliased = isName(alias) && !NOT_ALIASES.has(up(alias));
  return {
    source: { kind: "table", schema, name, alias: aliased ? unquote(alias.text) : null, columns: null, outer: true },
    next: aliased ? at + 1 : at,
  };
}

/** The columns of the parenthesized list from token `i`, if one opens there. */
function listAt(list: readonly Token[], i: number): string[] | null {
  if (list[i]?.text !== "(") {
    return null;
  }
  const names: string[] = [];
  for (let at = i + 1; at < list.length && list[at]?.text !== ")"; at += 1) {
    const t = list[at];
    if (isName(t)) {
      names.push(unquote(t.text));
    }
  }
  return names;
}

/** The common table expressions of `list`: WITH, or a comma, then a name, a list, AS and a parenthesis. */
function ctes(list: readonly Token[]): ScopeSource[] {
  const found: ScopeSource[] = [];
  list.forEach((t, i) => {
    const name = list[i + 1];
    if ((up(t) === "WITH" || (t.text === "," && found.length > 0)) && isName(name) && up(name) !== "RECURSIVE") {
      const columns = listAt(list, i + 2);
      const asAt = columns === null ? i + 2 : list.findIndex((x, j) => j > i + 2 && x.text === ")") + 1;
      if (up(list[asAt]) === "AS" && list[asAt + 1]?.text === "(") {
        found.push({ kind: "cte", schema: null, name: unquote(name.text), alias: null, columns, outer: true });
      }
    }
  });
  return found;
}

/** The sources of `statement`'s text before and after the cursor, read by their words. */
export function wordScope(statement: string): ScopeSource[] {
  const list = tokens(statement, statement.length);
  const found: ScopeSource[] = ctes(list);
  let inFrom = false;
  for (let i = 0; i < list.length; i += 1) {
    const word = up(list[i]);
    if (["FROM", "JOIN", "INTO", "UPDATE"].includes(word) || (inFrom && word === ",")) {
      inFrom = word === "FROM" || word === "JOIN" || (inFrom && word === ",");
      const table = tableAt(list, i + 1);
      if (table !== null) {
        found.push(table.source);
        i = table.next - 1;
      }
    } else if (word === ")" && inFrom) {
      const at = up(list[i + 1]) === "AS" ? i + 2 : i + 1;
      const alias = list[at];
      if (isName(alias) && !NOT_ALIASES.has(up(alias))) {
        found.push({
          kind: "derived",
          schema: null,
          name: null,
          alias: unquote(alias.text),
          columns: null,
          outer: true,
        });
      }
    } else if (["WHERE", "GROUP", "ORDER", "HAVING", "SET", "VALUES"].includes(word)) {
      inFrom = false;
    }
  }
  return found.map((s) =>
    s.kind === "table" && s.schema === null && found.some((c) => c.kind === "cte" && c.name === s.name)
      ? { ...s, kind: "cte" }
      : s,
  );
}
