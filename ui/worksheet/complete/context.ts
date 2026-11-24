/**
 * Where in a statement the cursor is, read by its words (RULES.md D40):
 * the word being typed and its qualifier, the clause it is in and the
 * words before it, so completion offers what the grammar allows there.
 * The text is read as Turborel's lexical elements are: nothing in a
 * string, a delimited identifier or a comment is a word of the
 * statement's.
 */
import { spans } from "../scan";

/** A word, a delimited identifier, or punctuation, of a statement. */
export interface Token {
  readonly text: string;
  readonly from: number;
  readonly to: number;
  readonly kind: "word" | "quoted" | "punct" | "number";
}

/** What may be written where the cursor is. */
export type Place =
  | { readonly kind: "none" }
  | { readonly kind: "start" }
  | { readonly kind: "qualified"; readonly qualifier: readonly string[] }
  | { readonly kind: "object"; readonly sequences: boolean; readonly derived: boolean }
  | { readonly kind: "afterObject" }
  | { readonly kind: "joinOn"; readonly joined: string }
  | { readonly kind: "insertColumns"; readonly table: readonly string[] }
  | { readonly kind: "type" }
  | { readonly kind: "expression"; readonly clause: string };

/** The cursor's place, the word being typed and where it begins. */
export interface Context {
  readonly place: Place;
  /** The word being typed, as written so far; empty if none. */
  readonly word: string;
  /** Where the word begins. */
  readonly from: number;
  /** Where the `*` just before the cursor is, of SELECT *, if it is there. */
  readonly star: number | null;
}

/** The clauses that begin where one of these words is written. */
const CLAUSES = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP",
  "BY",
  "HAVING",
  "ORDER",
  "SET",
  "VALUES",
  "ON",
  "JOIN",
  "INTO",
  "UPDATE",
  "TABLE",
  "USING",
  "RETURNING",
  "WINDOW",
]);
/** The words after which a table is named. */
const OBJECT_WORDS = new Set(["FROM", "JOIN", "INTO", "UPDATE", "TABLE"]);

/** The tokens of `text`'s code, before `end`. */
export function tokens(text: string, end: number): Token[] {
  const found: Token[] = [];
  for (const span of spans(text.slice(0, end))) {
    if (span.kind === "identifier") {
      found.push({ text: text.slice(span.from, span.to), from: span.from, to: span.to, kind: "quoted" });
    }
    if (span.kind !== "code") {
      continue;
    }
    const pattern = /([A-Za-z_][A-Za-z0-9_$]*)|([0-9]+(?:\.[0-9]*)?)|(<>|<=|>=|\|\||[^\sA-Za-z0-9_])/gu;
    for (const m of text.slice(span.from, span.to).matchAll(pattern)) {
      const from = span.from + m.index;
      const kind = m[1] !== undefined ? "word" : m[2] !== undefined ? "number" : "punct";
      found.push({ text: m[0], from, to: from + m[0].length, kind });
    }
  }
  return found;
}

/** Where the statement the cursor is in begins: after the last `;` of code before it. */
export function statementStart(text: string, cursor: number): number {
  let start = 0;
  for (const t of tokens(text, cursor)) {
    if (t.text === ";") {
      start = t.to;
    }
  }
  return start;
}

/** Whether the cursor is in a string, a delimited identifier or a comment left open. */
function inLiteral(text: string, cursor: number): boolean {
  const before = text.slice(0, cursor);
  const last = spans(before).at(-1);
  if (last === undefined || last.kind === "code") {
    return false;
  }
  const body = before.slice(last.from + 1);
  switch (last.kind) {
    case "string":
      return !body.endsWith("'");
    case "identifier":
      return !body.endsWith('"');
    case "comment":
      return before.slice(last.from).startsWith("--") || !before.endsWith("*/");
  }
}

/** The upper-cased text of a word token, or the token's text. */
function upper(t: Token | undefined): string {
  return t === undefined ? "" : t.kind === "word" ? t.text.toUpperCase() : t.text;
}

/** The names of the dotted chain ending just before `at`, as `A.B.` before a word. */
function qualifierBefore(list: readonly Token[], at: number): string[] {
  const names: string[] = [];
  let i = at;
  while (list[i - 1]?.text === "." && (list[i - 2]?.kind === "word" || list[i - 2]?.kind === "quoted")) {
    const t = list[i - 2];
    if (t === undefined) {
      break;
    }
    names.unshift(t.kind === "quoted" ? t.text.slice(1, -1).replaceAll('""', '"') : t.text.toUpperCase());
    i -= 2;
  }
  return names;
}

/** The last clause word before token `at`, at the same depth of parentheses, and the depth's opening token's place. */
function clauseOf(list: readonly Token[], at: number): { clause: string; index: number } {
  let depth = 0;
  for (let i = at - 1; i >= 0; i -= 1) {
    const t = upper(list[i]);
    if (t === ")") {
      depth += 1;
    } else if (t === "(") {
      if (depth === 0) {
        return { clause: "(", index: i };
      }
      depth -= 1;
    } else if (depth === 0 && CLAUSES.has(t)) {
      return { clause: t === "BY" ? `${upper(list[i - 1])} BY` : t, index: i };
    }
  }
  return { clause: "", index: -1 };
}

/** A rule of the cursor's place: the place, if the words before token `at` make it. */
type Rule = (list: readonly Token[], at: number) => Place | null;

/** After NEXT VALUE FOR, a sequence; after FROM, JOIN, INTO, UPDATE or TABLE, but CREATE TABLE, a table, after FROM or JOIN a derived table too. */
const objectRule: Rule = (list, at) => {
  const previous = upper(list[at - 1]);
  if (previous === "FOR" && upper(list[at - 2]) === "VALUE" && upper(list[at - 3]) === "NEXT") {
    return { kind: "object", sequences: true, derived: false };
  }
  const creating = previous === "TABLE" && list.slice(0, at - 1).some((t) => upper(t) === "CREATE");
  if (!OBJECT_WORDS.has(previous) || creating) {
    return null;
  }
  return { kind: "object", sequences: false, derived: previous === "FROM" || previous === "JOIN" };
};

/** After AS within CAST's parentheses, a type. */
const typeRule: Rule = (list, at) => {
  if (upper(list[at - 1]) !== "AS") {
    return null;
  }
  const { clause, index } = clauseOf(list, at - 1);
  return clause === "(" && upper(list[index - 1]) === "CAST" ? { kind: "type" } : null;
};

/** Within INSERT INTO t ( or INSERT INTO s.t (, its columns. */
const insertRule: Rule = (list, at) => {
  const { clause, index } = clauseOf(list, at);
  if (clause !== "(") {
    return null;
  }
  if (upper(list[index - 2]) === "INTO" && upper(list[index - 3]) === "INSERT") {
    return { kind: "insertColumns", table: [list[index - 1]?.text ?? ""] };
  }
  if (list[index - 2]?.text === "." && upper(list[index - 4]) === "INTO") {
    return { kind: "insertColumns", table: [list[index - 3]?.text ?? "", list[index - 1]?.text ?? ""] };
  }
  return null;
};

/** After JOIN t ON, the conditions to join it by. */
const joinRule: Rule = (list, at) => {
  if (upper(list[at - 1]) !== "ON" || clauseOf(list, at).clause !== "ON") {
    return null;
  }
  const join = list
    .slice(0, at - 1)
    .map(upper)
    .lastIndexOf("JOIN");
  return join === -1 ? null : { kind: "joinOn", joined: list[join + 1]?.text ?? "" };
};

/** The rules, in turn: the first that makes a place makes it. */
const RULES: readonly Rule[] = [objectRule, typeRule, insertRule, joinRule];

/** The place of the cursor after the words `list`, the word typed at token `at`. */
function placeOf(list: readonly Token[], at: number): Place {
  const qualifier = qualifierBefore(list, at);
  if (qualifier.length > 0) {
    return { kind: "qualified", qualifier };
  }
  if (at === 0) {
    return { kind: "start" };
  }
  for (const rule of RULES) {
    const place = rule(list, at);
    if (place !== null) {
      return place;
    }
  }
  const { clause } = clauseOf(list, at);
  if (clause === "FROM" || clause === "JOIN") {
    return upper(list[at - 1]) === "," ? { kind: "object", sequences: false, derived: true } : { kind: "afterObject" };
  }
  return { kind: "expression", clause };
}

/** The context of the cursor at `cursor` in `text`. */
export function contextAt(text: string, cursor: number): Context {
  if (inLiteral(text, cursor)) {
    return { place: { kind: "none" }, word: "", from: cursor, star: null };
  }
  const start = statementStart(text, cursor);
  const list = tokens(text, cursor).filter((t) => t.from >= start);
  const last = list.at(-1);
  const typing = last?.to === cursor && (last.kind === "word" || last.kind === "quoted");
  const at = typing ? list.length - 1 : list.length;
  const word = typing ? last.text : "";
  const from = typing ? last.from : cursor;
  const before = list[at - 1];
  const star =
    before?.text === "*" && before.to === cursor && clauseOf(list, at - 1).clause === "SELECT" ? before.from : null;
  return { place: placeOf(list, at), word, from, star };
}
