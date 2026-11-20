/**
 * A statement's text read as SQL's lexical elements are (Turborel's
 * `sql/01-lexical.md`): what is code, and what is a string, a delimited
 * identifier or a comment, which no marker of a worksheet's is read in
 * (RULES.md D36).
 */

/** A run of text of one kind. */
export interface Span {
  readonly kind: "code" | "string" | "identifier" | "comment";
  readonly from: number;
  readonly to: number;
}

/** Where the quoted run opened at `at` by `quote` ends, a quote written twice being one inside it. */
function quoted(text: string, at: number, quote: string): number {
  let i = at + 1;
  while (i < text.length) {
    if (text[i] === quote) {
      if (text[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return text.length;
}

/** Where the comment opened at `at` ends: a line's at its newline, a bracketed one's at its closing, nested. */
function commented(text: string, at: number): number {
  if (text.startsWith("--", at)) {
    const end = text.indexOf("\n", at);
    return end === -1 ? text.length : end;
  }
  let depth = 0;
  let i = at;
  while (i < text.length) {
    if (text.startsWith("/*", i)) {
      depth += 1;
      i += 2;
    } else if (text.startsWith("*/", i)) {
      depth -= 1;
      i += 2;
      if (depth === 0) {
        return i;
      }
    } else {
      i += 1;
    }
  }
  return text.length;
}

/** The spans of `text`, in order, covering it whole. */
export function spans(text: string): Span[] {
  const found: Span[] = [];
  let code = 0;
  let i = 0;
  const close = (kind: Span["kind"], to: number) => {
    if (code < i) {
      found.push({ kind: "code", from: code, to: i });
    }
    found.push({ kind, from: i, to });
    i = to;
    code = to;
  };
  while (i < text.length) {
    const c = text[i];
    if (c === "'") {
      close("string", quoted(text, i, "'"));
    } else if (c === '"') {
      close("identifier", quoted(text, i, '"'));
    } else if (text.startsWith("--", i) || text.startsWith("/*", i)) {
      close("comment", commented(text, i));
    } else {
      i += 1;
    }
  }
  if (code < text.length) {
    found.push({ kind: "code", from: code, to: text.length });
  }
  return found;
}
