/**
 * Tab in the editor (RULES.md D40): with the completion list open, it
 * takes the item highlighted, as Enter does; with none open, it completes
 * the word before the cursor in place where one candidate alone fits it,
 * opens the list where several do, and else indents, or moves to the next
 * placeholder of a snippet. Shift+Tab goes back a placeholder, or
 * outdents. Home and End jump to the list's first and last items while it
 * is open. Both keys are the commands Complete or Indent and Previous
 * Placeholder or Outdent, so they may be bound to others. Escape, then
 * Tab, leaves the editor, as CodeMirror's tab-focus mode gives.
 */
import {
  acceptCompletion,
  type Completion,
  CompletionContext,
  type CompletionResult,
  completionStatus,
  currentCompletions,
  hasNextSnippetField,
  hasPrevSnippetField,
  nextSnippetField,
  prevSnippetField,
  setSelectedCompletion,
  startCompletion,
} from "@codemirror/autocomplete";
import { indentLess, indentMore } from "@codemirror/commands";
import { Compartment, type Extension, Prec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";

/** A source of completions, as the editor's. */
export type Source = (context: CompletionContext) => Promise<CompletionResult | null> | CompletionResult | null;

/** The compartment of the Tab keys, given again as their bindings change. */
export const tabCompartment = new Compartment();

/** The commands of the Tab keys, and their keys by default. */
export const TAB_COMMANDS = { complete: "worksheet.complete", back: "worksheet.completeBack" } as const;

/** A key as Studio writes it, `Mod+Shift+P`, as CodeMirror does, `Mod-Shift-p`. */
export function cmKey(key: string): string {
  return key
    .split("+")
    .map((part) => (part.length === 1 ? part.toLowerCase() : part))
    .join("-");
}

/** The word being written before the cursor: letters, digits, `_` and `$`, of no selection. */
export function wordBefore(view: EditorView): string {
  const range = view.state.selection.main;
  if (!range.empty) {
    return "";
  }
  const line = view.state.doc.lineAt(range.head);
  return /[\w$]+$/u.exec(line.text.slice(0, range.head - line.from))?.[0] ?? "";
}

/** The options of `result` the text from its start to the cursor begins, in any case. */
export function fitting(result: CompletionResult, typed: string): readonly Completion[] {
  const word = typed.toLowerCase();
  return result.options.filter((o) => o.label.toLowerCase().startsWith(word));
}

/** Completes in place, opens the list, or indents, as the candidates of `source` for the word before the cursor say. */
async function completeOrList(view: EditorView, source: Source): Promise<void> {
  const state = view.state;
  const pos = state.selection.main.head;
  const result = await source(new CompletionContext(state, pos, true));
  if (view.state !== state) {
    return;
  }
  const options = result === null ? [] : fitting(result, state.doc.sliceString(result.from, pos));
  const [only] = options;
  if (result !== null && options.length === 1 && only !== undefined) {
    const to = result.to ?? pos;
    if (typeof only.apply === "function") {
      only.apply(view, only, result.from, to);
    } else {
      const text = only.apply ?? only.label;
      view.dispatch({
        changes: { from: result.from, to, insert: text },
        selection: { anchor: result.from + text.length },
      });
    }
  } else if (options.length > 1) {
    startCompletion(view);
  } else {
    indentMore(view);
  }
}

/** Tab: takes the item highlighted, moves to the next placeholder, completes or lists, or indents. */
export function tabForward(source: Source): (view: EditorView) => boolean {
  return (view) => {
    if (completionStatus(view.state) === "active") {
      return acceptCompletion(view);
    }
    if (hasNextSnippetField(view.state)) {
      return nextSnippetField(view);
    }
    if (wordBefore(view) === "") {
      return indentMore(view);
    }
    void completeOrList(view, source);
    return true;
  };
}

/** Shift+Tab: back a placeholder, or outdents. */
export function tabBack(view: EditorView): boolean {
  return hasPrevSnippetField(view.state) ? prevSnippetField(view) : indentLess(view);
}

/** Highlights the list's item at `at`, of the first or the last, while the list is open. */
function jump(last: boolean): (view: EditorView) => boolean {
  return (view) => {
    if (completionStatus(view.state) !== "active") {
      return false;
    }
    const count = currentCompletions(view.state).length;
    view.dispatch({ effects: setSelectedCompletion(last ? Math.max(0, count - 1) : 0) });
    return true;
  };
}

/** The Tab keys, `complete` and `back`, of completions from `source`, and Home and End of the list. */
export function tabKeys(source: Source, keys: { readonly complete: string; readonly back: string }): Extension {
  return Prec.high(
    keymap.of([
      ...(keys.complete === "" ? [] : [{ key: cmKey(keys.complete), run: tabForward(source) }]),
      ...(keys.back === "" ? [] : [{ key: cmKey(keys.back), run: tabBack }]),
      { key: "Home", run: jump(false) },
      { key: "End", run: jump(true) },
    ]),
  );
}
