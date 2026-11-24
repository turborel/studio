/**
 * The editor's colours (RULES.md D74): its tokens, gutter, active line,
 * cursor and popups, completion, its details and info, hints and lints,
 * each drawn of the theme's own CSS variables (`theme/tokens.ts`), so one
 * style serves both themes and follows the theme as it changes.
 */
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/** The colour of the theme's CSS variable of palette key `key`, as `synKeyword` is `--syn-keyword`. */
function token(key: string): string {
  return `var(--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)})`;
}

/** Each kind of token, by the theme's colour of it. */
export const SYNTAX = HighlightStyle.define([
  { tag: t.keyword, color: token("synKeyword") },
  { tag: [t.standard(t.name), t.function(t.variableName)], color: token("synFunction") },
  { tag: [t.string, t.special(t.string)], color: token("synString") },
  { tag: t.number, color: token("synNumber") },
  { tag: [t.comment, t.lineComment, t.blockComment], color: token("synComment"), fontStyle: "italic" },
  { tag: [t.operator, t.punctuation, t.paren, t.brace, t.squareBracket], color: token("synOperator") },
  { tag: [t.name, t.variableName, t.propertyName], color: token("synIdentifier") },
  { tag: [t.typeName, t.namespace], color: token("synType") },
  { tag: [t.bool, t.null, t.atom], color: token("synAtom") },
  { tag: t.special(t.name), color: token("synVariable") },
  { tag: t.invalid, color: token("synInvalid") },
]);

/** The editor's chrome and popups. */
const CHROME = EditorView.theme({
  "&": { color: token("synIdentifier"), backgroundColor: token("background") },
  ".cm-content": { caretColor: token("text") },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: token("text") },
  ".cm-activeLine": { backgroundColor: token("editorActiveLine") },
  ".cm-gutters": {
    backgroundColor: token("gutterBackground"),
    color: token("gutterText"),
    borderRight: `1px solid ${token("gutterBorder")}`,
  },
  ".cm-activeLineGutter": { backgroundColor: token("editorActiveLine"), color: token("gutterActiveText") },
  ".cm-tooltip": {
    backgroundColor: token("popupBackground"),
    color: token("popupText"),
    border: `1px solid ${token("popupBorder")}`,
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { color: token("popupText") },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: token("popupSelected"),
    color: token("onPopupSelected"),
  },
  ".cm-completionDetail": { color: token("popupMuted") },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail": {
    color: token("onPopupSelected"),
  },
  ".cm-completionMatchedText": { textDecoration: "underline", color: "inherit" },
  ".cm-completionInfo": {
    backgroundColor: token("popupBackground"),
    color: token("popupText"),
    border: `1px solid ${token("popupBorder")}`,
  },
  ".cm-tooltip-lint, .cm-diagnostic": { backgroundColor: token("popupBackground"), color: token("popupText") },
  ".cm-panels": { backgroundColor: token("surfaceRaised"), color: token("text") },
  ".cm-searchMatch": { outline: `1px solid ${token("accentText")}` },
});

/** The editor's colours: its tokens' and its chrome's. */
export function editorTheme(): Extension {
  return [syntaxHighlighting(SYNTAX), CHROME];
}
