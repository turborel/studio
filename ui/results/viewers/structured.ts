/**
 * JSON and XML for their viewers (RULES.md D39): a JSON value parsed for
 * its tree, and XML laid out a node a line, each indented by its depth.
 */

/** A JSON value parsed, or why it is none. */
export type ParsedJson = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly why: string };

/** `text` parsed as JSON. */
export function parseJson(text: string): ParsedJson {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (thrown: unknown) {
    return { ok: false, why: thrown instanceof Error ? thrown.message : String(thrown) };
  }
}

/** A token of XML's text: a tag, a comment or declaration, or text between. */
function xmlTokens(text: string): string[] {
  return text.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/gu) ?? [];
}

/** `xml`, an XML value's text, a node a line, indented by `indent` spaces a level; its text kept as written. */
export function prettyXml(xml: string, indent = 2): string {
  const lines: string[] = [];
  let depth = 0;
  const tokens = xmlTokens(xml);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = must(tokens[i]);
    const pad = " ".repeat(indent * depth);
    if (token.startsWith("</")) {
      depth = Math.max(0, depth - 1);
      lines.push(`${" ".repeat(indent * depth)}${token}`);
    } else if (token.startsWith("<") && !token.startsWith("<?") && !token.startsWith("<!") && !token.endsWith("/>")) {
      const text = tokens[i + 1];
      const close = tokens[i + 2];
      if (text !== undefined && !text.startsWith("<") && close?.startsWith("</") === true) {
        lines.push(`${pad}${token}${text}${close}`);
        i += 2;
      } else {
        lines.push(`${pad}${token}`);
        depth += 1;
      }
    } else if (token.trim() !== "") {
      lines.push(`${pad}${token.startsWith("<") ? token : token.trim()}`);
    }
  }
  return lines.join("\n");
}

/** `value`, which is there. */
function must<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("no token");
  }
  return value;
}
