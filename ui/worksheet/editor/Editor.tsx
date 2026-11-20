/**
 * A worksheet's editor (RULES.md D36): CodeMirror 6 over the worksheet's
 * text, its statements split as the text changes, its language given the
 * catalog again as more of it is read; split, a second view of the same
 * text below the first, each change made in one made in the other.
 */
import { Annotation, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { splitScript } from "../../ipc/worksheet";
import { type Store, useStore, useStudio } from "../../state/store";
import { changeWorksheet, setText, worksheetOf } from "../../state/worksheets";
import type { Bridge } from "./catalog";
import { editorExtensions, language, languageCompartment } from "./extensions";
import { setPieces } from "./fields";
import { register } from "./views";

/** How long the text waits, unchanged, before its statements are split again, in milliseconds. */
export const SPLIT_AFTER_MS = 300;

/** A change made in one view, made in the other. */
const mirrored = Annotation.define<boolean>();

/** Makes each change of a view's text in the view `to` gives, unless it came from there. */
function mirror(to: () => EditorView | null) {
  return EditorView.updateListener.of((update) => {
    const other = to();
    for (const tr of update.transactions) {
      if (other !== null && tr.docChanged && tr.annotation(mirrored) !== true) {
        other.dispatch({ changes: tr.changes, annotations: mirrored.of(true) });
      }
    }
  });
}

/** What the language is made of now: when it changes, the language is made again. */
function signature(store: Store, bridge: Bridge): readonly unknown[] {
  const now = store.current();
  const w = worksheetOf(now, bridge.worksheet);
  const open = now.open.find((c) => c.id === w?.connection);
  return [now.reservedWords, now.catalogs[w?.connection ?? -1], open?.session.schema];
}

/** Splits the text's statements, `SPLIT_AFTER_MS` after its last change, and tells `views` and the store. */
function splitter(
  store: Store,
  id: string,
  views: () => readonly EditorView[],
): { split: (text: string) => void; stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const split = (text: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void splitScript(text)
        .then((pieces) => {
          for (const view of views()) {
            view.dispatch({ effects: setPieces.of(pieces) });
          }
          changeWorksheet(store, id, (w) => ({ ...w, pieces }));
        })
        .catch(() => undefined);
    }, SPLIT_AFTER_MS);
  };
  return {
    split,
    stop: () => {
      clearTimeout(timer);
    },
  };
}

/** Makes the language of `views` again whenever what it is made of changes: what stops it. */
function relanguage(store: Store, bridge: Bridge, views: readonly EditorView[]): () => void {
  let last = signature(store, bridge);
  return store.subscribe(() => {
    const now = signature(store, bridge);
    if (now.some((part, i) => part !== last[i])) {
      last = now;
      for (const view of views) {
        view.dispatch({ effects: languageCompartment.reconfigure(language(bridge)) });
      }
    }
  });
}

/** Makes the views of worksheet `id` in `host`, the second in `second` if split: what ends them. */
function mount(store: Store, id: string, [host, second]: readonly [HTMLDivElement, HTMLDivElement | null]): () => void {
  const bridge: Bridge = { store, worksheet: id };
  const views: EditorView[] = [];
  const { split, stop } = splitter(store, id, () => views);
  const text = worksheetOf(store.current(), id)?.text ?? "";
  const make = (parent: HTMLDivElement, primary: boolean, other: () => EditorView | null): EditorView => {
    const changed = (now: string) => {
      if (primary) {
        setText(store, id, now);
        split(now);
      }
    };
    return new EditorView({
      parent,
      state: EditorState.create({ doc: text, extensions: [editorExtensions(bridge, changed), mirror(other)] }),
    });
  };
  views.push(make(host, true, () => views[1] ?? null));
  if (second !== null) {
    views.push(make(second, false, () => views[0] ?? null));
  }
  split(text);
  const [first] = views;
  const unregister = first === undefined ? () => undefined : register(id, first);
  const unsubscribe = relanguage(store, bridge, views);
  return () => {
    stop();
    unsubscribe();
    unregister();
    for (const view of views) {
      view.destroy();
    }
  };
}

/** The editor of worksheet `id`. */
export function Editor({ id }: { readonly id: string }) {
  const store = useStore();
  const split = useStudio((s) => worksheetOf(s, id)?.split === true);
  const host = useRef<HTMLDivElement>(null);
  const second = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (host.current === null) {
      return undefined;
    }
    return mount(store, id, [host.current, split ? second.current : null]);
  }, [store, id, split]);
  return (
    <div className={split ? "editors editors-split" : "editors"}>
      <div ref={host} className="editor" aria-label="SQL editor" />
      {split && <div ref={second} className="editor" aria-label="SQL editor, second view" />}
    </div>
  );
}
