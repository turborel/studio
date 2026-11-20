/**
 * What a worksheet's commands do to its editor (RULES.md D36): find the
 * statement at the cursor, bookmark lines and move between them, change
 * the case of a selection, format the script or a selection, and mark a
 * failure's place.
 */
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Piece } from "../../ipc/worksheet";
import { type FormatOptions, formatSql } from "../format";
import { bookmarks, piecesField, setFailure, toggleBookmarkAt } from "./fields";

/** The statement the cursor is in, else the last one before it, else the first after it. */
export function pieceAt(pieces: readonly Piece[], at: number): Piece | undefined {
  return pieces.find((p) => p.from <= at && at <= p.to) ?? pieces.filter((p) => p.to <= at).at(-1) ?? pieces[0];
}

/** The statement at `view`'s cursor, as last split. */
export function statementAtCursor(view: EditorView): Piece | undefined {
  return pieceAt(view.state.field(piecesField), view.state.selection.main.head);
}

/** The text selected in `view`, and where it begins; none if nothing is. */
export function selected(view: EditorView): { text: string; from: number } | null {
  const range = view.state.selection.main;
  return range.empty ? null : { text: view.state.sliceDoc(range.from, range.to), from: range.from };
}

/** Puts a bookmark on the cursor's line, or takes it off. */
export function toggleBookmark(view: EditorView): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  view.dispatch({ effects: toggleBookmarkAt.of(line.from) });
}

/** Moves the cursor to the next bookmark, or the one before if `back`, round from the end. */
export function goToBookmark(view: EditorView, back: boolean): void {
  const marks = bookmarks(view.state);
  const line = view.state.doc.lineAt(view.state.selection.main.head).from;
  const target = back
    ? (marks.filter((m) => m < line).at(-1) ?? marks.at(-1))
    : (marks.find((m) => m > line) ?? marks[0]);
  if (target !== undefined) {
    view.dispatch({ selection: EditorSelection.cursor(target), scrollIntoView: true });
  }
}

/** Writes each selection in upper case, or lower; the word at the cursor where nothing is selected. */
export function changeCase(view: EditorView, upper: boolean): void {
  const change = view.state.changeByRange((range) => {
    const target = range.empty ? (view.state.wordAt(range.head) ?? range) : range;
    const text = view.state.sliceDoc(target.from, target.to);
    const insert = upper ? text.toUpperCase() : text.toLowerCase();
    return {
      changes: { from: target.from, to: target.to, insert },
      range: EditorSelection.range(target.from, target.from + insert.length),
    };
  });
  view.dispatch(change);
}

/** Formats the selection, or the whole script if nothing is selected. */
export function formatScript(view: EditorView, options: FormatOptions): void {
  const range = view.state.selection.main;
  const [from, to] = range.empty ? [0, view.state.doc.length] : [range.from, range.to];
  const formatted = formatSql(view.state.sliceDoc(from, to), options);
  const insert = range.empty ? formatted : formatted.replace(/\n$/u, "");
  view.dispatch({ changes: { from, to, insert }, selection: EditorSelection.cursor(from + insert.length) });
}

/** Underlines the place `at` of a failure, the word there, and moves the cursor to it. */
export function showFailure(view: EditorView, at: number): void {
  const pos = Math.min(Math.max(at, 0), view.state.doc.length);
  const word = view.state.wordAt(pos);
  const to = word === null ? Math.min(pos + 1, view.state.doc.length) : word.to;
  view.dispatch({
    effects: setFailure.of({ from: pos, to }),
    selection: EditorSelection.cursor(pos),
    scrollIntoView: true,
  });
  view.focus();
}

/** Selects the statement from `from` to `to`, and shows it. */
export function selectStatement(view: EditorView, from: number, to: number): void {
  view.dispatch({ selection: EditorSelection.range(from, to), scrollIntoView: true });
  view.focus();
}

/** Inserts `text` at the cursor. */
export function insertText(view: EditorView, text: string): void {
  view.dispatch(view.state.replaceSelection(text));
  view.focus();
}
