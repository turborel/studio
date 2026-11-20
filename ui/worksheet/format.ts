/**
 * The SQL formatter (RULES.md D36): a statement laid out by its clauses,
 * each beginning a line; AND and OR of a condition, and a list's items
 * past the line's width, each on a line of their own, indented; a
 * subquery indented within its parentheses. Key words are written in the
 * case the settings say; strings, delimited identifiers and comments are
 * kept as written, so the statement's meaning never changes.
 */
import type { KeyWordCase } from "../ipc/preferences";
import { spans } from "./scan";

/** How the formatter lays a statement out. */
export interface FormatOptions {
  readonly keyWords: KeyWordCase;
  readonly indent: number;
  readonly lineWidth: number;
  /** The words written in the key words' case, in upper case. */
  readonly words: ReadonlySet<string>;
}

/** A token, and whether space came before it as written. */
interface Token {
  readonly kind: "word" | "quoted" | "number" | "comment" | "punct";
  readonly text: string;
  readonly spaced: boolean;
}

/** The clauses that begin a line, each of one word or more, the longest first. */
const CLAUSES: readonly (readonly string[])[] = [
  ["UNION", "ALL"],
  ["GROUP", "BY"],
  ["ORDER", "BY"],
  ["PARTITION", "BY"],
  ["INSERT", "INTO"],
  ["DELETE", "FROM"],
  ["LEFT", "OUTER", "JOIN"],
  ["RIGHT", "OUTER", "JOIN"],
  ["FULL", "OUTER", "JOIN"],
  ["LEFT", "JOIN"],
  ["RIGHT", "JOIN"],
  ["FULL", "JOIN"],
  ["INNER", "JOIN"],
  ["CROSS", "JOIN"],
  ["NATURAL", "JOIN"],
  ["SELECT"],
  ["FROM"],
  ["WHERE"],
  ["HAVING"],
  ["UNION"],
  ["INTERSECT"],
  ["EXCEPT"],
  ["VALUES"],
  ["SET"],
  ["UPDATE"],
  ["WITH"],
  ["JOIN"],
  ["FETCH"],
  ["OFFSET"],
  ["WINDOW"],
];
/** The words that begin a line within a condition. */
const CONNECTIVES = new Set(["AND", "OR", "ON"]);
/** What a subquery begins with. */
const QUERY_STARTS = new Set(["SELECT", "WITH", "VALUES"]);
/** Punctuation no space goes before. */
const NO_SPACE_BEFORE = new Set([",", ")", ";", "."]);
/** Punctuation no space goes after. */
const NO_SPACE_AFTER = new Set(["(", "."]);

/** The tokens of `text`'s code between `from` and `to`. */
function codeTokens(text: string, from: number, to: number): Token[] {
  const found: Token[] = [];
  const pattern =
    /([A-Za-z_][A-Za-z0-9_$]*)|([0-9]+(?:\.[0-9]*)?(?:[eE][+-]?[0-9]+)?|\.[0-9]+)|(<>|<=|>=|\|\||[^\sA-Za-z0-9_])/gu;
  for (const match of text.slice(from, to).matchAll(pattern)) {
    const [whole, word, number] = match;
    const at = from + match.index;
    const spaced = at === 0 || /\s/u.test(text[at - 1] ?? "");
    found.push({ kind: word !== undefined ? "word" : number !== undefined ? "number" : "punct", text: whole, spaced });
  }
  return found;
}

/** The tokens of `text`. */
function tokens(text: string): Token[] {
  return spans(text).flatMap((span): Token[] => {
    if (span.kind === "code") {
      return codeTokens(text, span.from, span.to);
    }
    const kind = span.kind === "comment" ? "comment" : "quoted";
    return [{ kind, text: text.slice(span.from, span.to), spaced: true }];
  });
}

/** `word` in the case `options` say, if it is a key word. */
function cased(word: string, options: FormatOptions): string {
  if (!options.words.has(word.toUpperCase())) {
    return word;
  }
  switch (options.keyWords) {
    case "upper":
      return word.toUpperCase();
    case "lower":
      return word.toLowerCase();
    case "keep":
      return word;
  }
}

/** How many tokens at `at` make a clause, 0 if none begins there. */
function clauseAt(list: readonly Token[], at: number): number {
  for (const clause of CLAUSES) {
    if (clause.every((w, i) => list[at + i]?.kind === "word" && list[at + i]?.text.toUpperCase() === w)) {
      return clause.length;
    }
  }
  return 0;
}

/** A formatter's state as it writes. */
class Writer {
  readonly lines: string[] = [];
  line = "";
  level = 0;
  /** The levels each open parenthesis began at, and whether it holds a subquery. */
  readonly opens: { level: number; query: boolean }[] = [];
  constructor(readonly options: FormatOptions) {}

  /** The indentation of `level`. */
  pad(level: number): string {
    return " ".repeat(level * this.options.indent);
  }

  /** Ends the line, and begins one at `level`. */
  newline(level: number): void {
    if (this.line.trim() !== "") {
      this.lines.push(this.line.trimEnd());
    }
    this.line = this.pad(level);
  }

  /** Writes `text`, a space before it unless `tight`. */
  put(text: string, tight: boolean): void {
    const fresh = this.line.trim() === "";
    this.line += fresh || tight ? text : ` ${text}`;
  }

  /** Whether `text` would take the line past its width. */
  overflows(text: string): boolean {
    return this.line.length + 1 + text.length > this.options.lineWidth;
  }
}

/** Writes the token at `at` of `list`: the tokens it took. */
function write(w: Writer, list: readonly Token[], at: number): number {
  const token = list[at];
  if (token === undefined) {
    return 1;
  }
  const previous = list[at - 1];
  const tight = NO_SPACE_BEFORE.has(token.text) || (previous !== undefined && NO_SPACE_AFTER.has(previous.text));
  if (token.kind === "comment") {
    w.put(token.text, false);
    if (token.text.startsWith("--")) {
      w.newline(w.level + 1);
    }
    return 1;
  }
  if (token.kind === "punct") {
    return punctuation(w, list, at, tight);
  }
  if (token.kind !== "word") {
    w.put(token.text, tight);
    return 1;
  }
  const clause = clauseAt(list, at);
  if (clause > 0) {
    w.newline(w.level);
    const words = list.slice(at, at + clause).map((t) => cased(t.text, w.options));
    w.put(words.join(" "), false);
    return clause;
  }
  if (CONNECTIVES.has(token.text.toUpperCase())) {
    w.newline(w.level + 1);
  } else if (w.overflows(token.text)) {
    w.newline(w.level + 1);
  }
  w.put(cased(token.text, w.options), tight);
  return 1;
}

/** Opens a parenthesis: a subquery's indents what it holds. */
function open(w: Writer, list: readonly Token[], at: number, tight: boolean): void {
  const next = list[at + 1];
  const query = next?.kind === "word" && QUERY_STARTS.has(next.text.toUpperCase());
  // A function's parenthesis stays against its name, as written.
  w.put("(", tight || list[at]?.spaced === false);
  w.opens.push({ level: w.level, query });
  if (query) {
    w.level += 1;
  }
}

/** Closes a parenthesis: a subquery's on a line of its own, at the level it opened at. */
function close(w: Writer): void {
  const opened = w.opens.pop();
  if (opened?.query === true) {
    w.level = opened.level;
    w.newline(w.level);
  }
  w.put(")", opened?.query !== true);
}

/** Ends a statement, and leaves a blank line after it. */
function end(w: Writer): void {
  w.put(";", true);
  w.level = 0;
  w.opens.length = 0;
  w.newline(0);
  w.lines.push("");
}

/** Writes the punctuation at `at`: a subquery's parentheses indent it, a comma may end a line. */
function punctuation(w: Writer, list: readonly Token[], at: number, tight: boolean): number {
  const text = list[at]?.text ?? "";
  if (text === "(") {
    open(w, list, at, tight);
  } else if (text === ")") {
    close(w);
  } else if (text === ";") {
    end(w);
  } else {
    w.put(text, tight);
    if (text === "," && w.line.length > w.options.lineWidth * 0.8) {
      w.newline(w.level + 1);
    }
  }
  return 1;
}

/** `text`, formatted as `options` say. */
export function formatSql(text: string, options: FormatOptions): string {
  const list = tokens(text);
  const w = new Writer(options);
  let at = 0;
  while (at < list.length) {
    at += write(w, list, at);
  }
  w.newline(0);
  while (w.lines.at(-1) === "") {
    w.lines.pop();
  }
  return w.lines.join("\n") + (w.lines.length > 0 ? "\n" : "");
}
