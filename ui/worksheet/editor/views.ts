/**
 * The editors of the window's worksheets (RULES.md D36): each worksheet's
 * editor by its identifier, so a command reaches the active worksheet's.
 */
import type { EditorView } from "@codemirror/view";

/** Each worksheet's editor, by its identifier. */
const views = new Map<string, EditorView>();

/** Keeps `view` as worksheet `id`'s editor, until the returned function is called. */
export function register(id: string, view: EditorView): () => void {
  views.set(id, view);
  return () => {
    if (views.get(id) === view) {
      views.delete(id);
    }
  };
}

/** Worksheet `id`'s editor, if it is shown. */
export function viewOf(id: string | null): EditorView | undefined {
  return id === null ? undefined : views.get(id);
}
