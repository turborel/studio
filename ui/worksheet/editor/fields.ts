/**
 * What a worksheet's editor holds besides its text (RULES.md D36): the
 * statements of its script as last split, which fold, the place of the
 * last failure, underlined, and its bookmarked lines, marked in the
 * gutter.
 */
import { foldService } from "@codemirror/language";
import { type EditorState, type Extension, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, GutterMarker, gutter } from "@codemirror/view";
import type { Piece } from "../../ipc/worksheet";

/** The statements of the script, as split. */
export const setPieces = StateEffect.define<readonly Piece[]>();

/** The statements of the script, as last split; their places follow the text's changes. */
export const piecesField = StateField.define<readonly Piece[]>({
  create: () => [],
  update(pieces, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setPieces)) {
        return effect.value;
      }
    }
    if (!tr.docChanged) {
      return pieces;
    }
    return pieces.map((p) => ({ ...p, from: tr.changes.mapPos(p.from, 1), to: tr.changes.mapPos(p.to, -1) }));
  },
});

/** A statement of more than one line folds from its first line's end to its own end. */
function foldStatement(state: EditorState, lineStart: number, lineEnd: number): { from: number; to: number } | null {
  const piece = state.field(piecesField).find((p) => p.from >= lineStart && p.from <= lineEnd && p.to > lineEnd);
  return piece === undefined ? null : { from: lineEnd, to: piece.to };
}

/** The place of the last failure, or none. */
export const setFailure = StateEffect.define<{ from: number; to: number } | null>();

/** The mark of a failure's place. */
const FAILURE = Decoration.mark({ class: "cm-failure" });

/** The failure's place, underlined until the text changes. */
export const failureField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFailure)) {
        const at = effect.value;
        return at === null || at.from >= at.to ? Decoration.none : Decoration.set([FAILURE.range(at.from, at.to)]);
      }
    }
    return tr.docChanged ? Decoration.none : marks;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** A bookmark's mark in the gutter. */
class BookmarkMarker extends GutterMarker {
  override toDOM(): Node {
    const mark = document.createElement("span");
    mark.className = "cm-bookmark";
    mark.textContent = "◆";
    mark.setAttribute("aria-label", "Bookmark");
    return mark;
  }
}

/** The one bookmark marker. */
const BOOKMARK = new BookmarkMarker();

/** Puts a bookmark at the line beginning at `pos`, or takes it off. */
export const toggleBookmarkAt = StateEffect.define<number>();

/** The bookmarked lines, by where each begins, following the text's changes. */
export const bookmarkField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(marks, tr) {
    let next = marks.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(toggleBookmarkAt)) {
        const at = next.iter(effect.value);
        const has = at.value !== null && at.from === effect.value;
        next = has
          ? next.update({ filter: (from) => from !== effect.value })
          : next.update({ add: [BOOKMARK.range(effect.value)], sort: true });
      }
    }
    return next;
  },
});

/** Where each bookmarked line begins, in order. */
export function bookmarks(state: EditorState): number[] {
  const found: number[] = [];
  const cursor = state.field(bookmarkField).iter();
  while (cursor.value !== null) {
    found.push(cursor.from);
    cursor.next();
  }
  return found;
}

/** The fields, their gutter and their folding. */
export function worksheetFields(): Extension {
  return [
    piecesField,
    failureField,
    bookmarkField,
    foldService.of(foldStatement),
    gutter({ class: "cm-bookmarks", markers: (view) => view.state.field(bookmarkField) }),
  ];
}
