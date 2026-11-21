/**
 * A worksheet's editor (RULES.md D36): CodeMirror 6 in Turborel's SQL, its
 * completion from the catalog and of snippets, its markers marked, a
 * table described on hover or by a key, a routine's parameters shown as
 * its arguments are written, and a table dropped from the explorer
 * written as a query of its columns.
 */
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { sql } from "@codemirror/lang-sql";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  Decoration,
  type DecorationSet,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  hoverTooltip,
  keymap,
  lineNumbers,
  rectangularSelection,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { TableDetail } from "../../ipc/catalog";
import { sqlName, turborelDialect } from "../dialect";
import { markers } from "../variables";
import { completionSource, iconElement } from "../complete/source";
import type { ItemKind } from "../complete/engine";
import { type Bridge, defaultSchema, tableDetail, tableNamed } from "./catalog";
import { worksheetFields } from "./fields";
import { parameterHints } from "./hints";

/** The data a table dragged from the explorer carries. */
export const TABLE_DRAG = "application/x-turborel-table";
/** The longest text whose markers are marked, in characters: past it, none is. */
const MAX_MARKED = 1_000_000;

/** The marks of the text's markers: parameters and script variables. */
const PARAMETER = Decoration.mark({ class: "cm-parameter" });
const VARIABLE = Decoration.mark({ class: "cm-script-variable" });

/** The markers of `view`'s text, marked. */
function markerDecorations(view: EditorView): DecorationSet {
  const text = view.state.doc.toString();
  if (text.length > MAX_MARKED) {
    return Decoration.none;
  }
  return Decoration.set(markers(text).map((m) => (m.kind === "variable" ? VARIABLE : PARAMETER).range(m.from, m.to)));
}

/** Marks the text's markers as it changes. */
const markerPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = markerDecorations(view);
    }
    update(update: ViewUpdate): void {
      if (update.docChanged) {
        this.decorations = markerDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** A description of `detail`, as a tooltip shows it. */
export function describeTable(detail: TableDetail): HTMLElement {
  const box = document.createElement("div");
  box.className = "cm-describe";
  const title = document.createElement("strong");
  title.textContent = `${detail.schema}.${detail.name} (${detail.kind})`;
  box.append(title);
  for (const c of detail.columns) {
    const line = document.createElement("div");
    line.textContent = `${c.name}  ${c.typeWritten}${c.nullable ? "" : " NOT NULL"}`;
    box.append(line);
  }
  return box;
}

/** The table named at `pos`, described, if one is: the tooltip's source. */
export function describeSource(bridge: Bridge) {
  return async (view: EditorView, pos: number) => {
    const word = view.state.wordAt(pos);
    if (word === null) {
      return null;
    }
    const text = view.state.sliceDoc(word.from, word.to);
    const qualified = /("(?:[^"]|"")+"|[A-Za-z_]\w*)\.$/u.exec(
      view.state.sliceDoc(Math.max(0, word.from - 129), word.from),
    );
    const { schema, table } = tableNamed(view.state.doc.toString(), text);
    const detail = await tableDetail(
      bridge,
      qualified?.[1] === undefined ? schema : qualified[1].replaceAll('"', "").toUpperCase(),
      table,
    );
    if (detail === null) {
      return null;
    }
    return { pos: word.from, end: word.to, above: true, create: () => ({ dom: describeTable(detail) }) };
  };
}

/** The table named at `pos`, described as the pointer rests on it. */
function describeAt(bridge: Bridge) {
  return hoverTooltip(describeSource(bridge));
}

/** A table dropped from the explorer, written at the drop as a SELECT of its columns, or an INSERT with Shift. */
function dropTable(bridge: Bridge): Extension {
  return EditorView.domEventHandlers({
    drop(event, view) {
      const data = event.dataTransfer?.getData(TABLE_DRAG);
      if (data === undefined || data === "") {
        return false;
      }
      event.preventDefault();
      const { schema, name } = JSON.parse(data) as { schema: string; name: string };
      const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
      const insert = event.shiftKey;
      void tableDetail(bridge, schema, name).then((detail) => {
        if (detail !== null) {
          view.dispatch({
            changes: {
              from: at,
              insert: writtenFor(detail, insert, new Set(bridge.store.current().reservedWords), defaultSchema(bridge)),
            },
          });
        }
      });
      return true;
    },
  });
}

/** A SELECT of `detail`'s columns, or an INSERT of them, its name qualified unless of the session's schema. */
export function writtenFor(
  detail: TableDetail,
  insert: boolean,
  reserved: ReadonlySet<string>,
  schema: string | null,
): string {
  const name =
    detail.schema === schema
      ? sqlName(detail.name, reserved)
      : `${sqlName(detail.schema, reserved)}.${sqlName(detail.name, reserved)}`;
  const names = detail.columns.map((c) => sqlName(c.name, reserved));
  if (insert) {
    return `INSERT INTO ${name} (${names.join(", ")})\nVALUES (${names.map(() => "?").join(", ")})`;
  }
  return `SELECT ${names.join(", ")}\nFROM ${name}`;
}

/** The compartment of the language, given the catalog again as it changes. */
export const languageCompartment = new Compartment();

/** The language, its completion of the catalog as `bridge` reads it now. */
export function language(bridge: Bridge): Extension {
  return sql({ dialect: turborelDialect(bridge.store.current().reservedWords) });
}

/** Every extension of a worksheet's editor, `changed` told of each change of its text. */
export function editorExtensions(bridge: Bridge, changed: (text: string) => void): Extension {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion({
      override: [completionSource(bridge)],
      icons: false,
      addToOptions: [{ render: (completion) => iconElement((completion.type ?? "keyword") as ItemKind), position: 20 }],
    }),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
    ]),
    languageCompartment.of(language(bridge)),
    markerPlugin,
    worksheetFields(),
    describeAt(bridge),
    parameterHints(bridge),
    dropTable(bridge),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        changed(update.state.doc.toString());
      }
    }),
  ];
}
