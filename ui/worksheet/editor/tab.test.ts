import {
  autocompletion,
  type CompletionContext,
  completionStatus,
  currentCompletions,
  snippet,
} from "@codemirror/autocomplete";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { cmKey, fitting, tabKeys, wordBefore } from "./tab";

/** The words the test's source offers, each of the word before the cursor. */
const WORDS = ["SELECT", "SET", "SEQUENCE", "STAFF"];

/** A source of `WORDS`, and of a snippet `loop`. */
function source(context: CompletionContext) {
  const word = context.matchBefore(/[\w$]+/u);
  if (word === null && !context.explicit) {
    return null;
  }
  return {
    from: word?.from ?? context.pos,
    options: [
      ...WORDS.map((label) => ({ label, type: "keyword" })),
      { label: "loopy", type: "snippet", apply: snippet("FOR ${a} IN ${b} DO ${c}") },
    ],
  };
}

/** An editor of `doc`, the cursor at its end, its Tab keys `complete` and `back`. */
function editor(doc: string, keys = { complete: "Tab", back: "Shift+Tab" }): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [autocompletion({ override: [source], activateOnTyping: false }), tabKeys(source, keys)],
    }),
  });
  document.body.append(view.dom);
  return view;
}

/** Presses `key` in `view`, as its keymaps take it: whether one did. */
function press(view: EditorView, key: string, shift = false): boolean {
  return runScopeHandlers(view, new KeyboardEvent("keydown", { key, shiftKey: shift }), "editor");
}

/** Lets the completion's source answer and the list open. */
async function settled(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("Tab in the editor", () => {
  it("takes the item the arrows highlight: type, Down twice, Tab, and the third is in [DESIGN] D40", async () => {
    const view = editor("SE");
    expect(press(view, "Tab")).toBe(true);
    await settled();
    expect(completionStatus(view.state)).toBe("active");
    const listed = currentCompletions(view.state).map((c) => c.label);
    press(view, "ArrowDown");
    press(view, "ArrowDown");
    press(view, "Tab");
    expect(view.state.doc.toString()).toBe(listed[2]);
    expect(completionStatus(view.state)).toBeNull();
    view.destroy();
  });

  it("completes in place where one candidate alone fits, and indents where none does [DESIGN] D40", async () => {
    const one = editor("SELECT * FROM st");
    press(one, "Tab");
    await settled();
    expect(one.state.doc.toString()).toBe("SELECT * FROM STAFF");
    one.destroy();
    const none = editor("xyz");
    press(none, "Tab");
    await settled();
    expect(none.state.doc.toString()).toBe("  xyz");
    none.destroy();
    const blank = editor("SELECT\n");
    press(blank, "Tab");
    expect(blank.state.doc.toString()).toBe("SELECT\n  ");
    press(blank, "Tab", true);
    expect(blank.state.doc.toString()).toBe("SELECT\n");
    blank.destroy();
  });

  it("jumps the list's highlight to its first and last, takes it by Enter, and closes it by Escape [DESIGN] D40", async () => {
    const view = editor("S");
    press(view, "Tab");
    await settled();
    expect(completionStatus(view.state)).toBe("active");
    expect(press(view, "End")).toBe(true);
    press(view, "Enter");
    expect(view.state.doc.toString()).toBe("STAFF");
    view.dispatch({ changes: { from: 5, insert: " SE" }, selection: EditorSelection.cursor(8) });
    press(view, "Tab");
    await settled();
    expect(press(view, "Home")).toBe(true);
    press(view, "Escape");
    expect(completionStatus(view.state)).toBeNull();
    expect(press(view, "Home")).toBe(false);
    view.destroy();
  });

  it("moves through a snippet's placeholders, forward and back [DESIGN] D40", async () => {
    const view = editor("loop");
    press(view, "Tab");
    await settled();
    expect(view.state.doc.toString()).toBe("FOR a IN b DO c");
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("a");
    press(view, "Tab");
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("b");
    press(view, "Tab", true);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("a");
    view.destroy();
  });

  it("is bound to the keys the settings give, or to none [DESIGN] D40", () => {
    const view = editor("SELECT * FROM st", { complete: "Mod+J", back: "" });
    expect(press(view, "Tab")).toBe(false);
    view.destroy();
    expect(cmKey("Mod+Shift+P")).toBe("Mod-Shift-p");
    expect(cmKey("Tab")).toBe("Tab");
    const chosen = editor("x");
    chosen.dispatch({ selection: EditorSelection.range(0, 1) });
    expect(wordBefore(chosen)).toBe("");
    chosen.destroy();
    expect(fitting({ from: 0, options: [{ label: "Staff" }, { label: "SET" }] }, "st").map((o) => o.label)).toEqual([
      "Staff",
    ]);
  });

  it("leaves the editor after Escape, so the keyboard alone moves the focus on [DESIGN] D40", () => {
    const view = editor("x\n");
    const key = (name: string, code: number) => {
      const event = new KeyboardEvent("keydown", { key: name, keyCode: code, bubbles: true, cancelable: true });
      view.contentDOM.dispatchEvent(event);
      return event;
    };
    expect(key("Tab", 9).defaultPrevented).toBe(true);
    key("Escape", 27);
    expect(key("Tab", 9).defaultPrevented).toBe(false);
    view.destroy();
  });

  it("moves through placeholders by keys bound anew, lets a word go that changed meanwhile, and indents of no candidates [DESIGN] D40", async () => {
    const view = editor("loop", { complete: "Mod+J", back: "Mod+K" });
    const mod = (key: string) => runScopeHandlers(view, new KeyboardEvent("keydown", { key, ctrlKey: true }), "editor");
    mod("j");
    await settled();
    expect(view.state.doc.toString()).toBe("FOR a IN b DO c");
    mod("j");
    mod("k");
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("a");
    view.destroy();
    const changing = editor("SE");
    press(changing, "Tab");
    changing.dispatch({ changes: { from: 2, insert: "L" }, selection: EditorSelection.cursor(3) });
    await settled();
    expect(changing.state.doc.toString()).toBe("SEL");
    changing.destroy();
    const nothing = new EditorView({
      state: EditorState.create({
        doc: "zz",
        selection: EditorSelection.cursor(2),
        extensions: [tabKeys(() => null, { complete: "Tab", back: "" })],
      }),
    });
    press(nothing, "Tab");
    await settled();
    expect(nothing.state.doc.toString()).toBe("  zz");
    expect(press(nothing, "Tab", true)).toBe(false);
    nothing.destroy();
  });
});
