/**
 * Completion in the editor (RULES.md D40): CodeMirror's list, as typed and
 * by Ctrl+Space, of what the engine offers at the cursor, the statement's
 * sources read by Turborel's parser through the backend, or by its words
 * where it does not parse; the catalog from the window's cache, read
 * further only while the worksheet runs nothing; each item with its
 * kind's icon, its type and a popup.
 */
import { type Completion, type CompletionContext, type CompletionResult, snippet } from "@codemirror/autocomplete";
import { renderToStaticMarkup } from "react-dom/server";
import { catalogRoutine } from "../../ipc/catalog";
import { statementScope } from "../../ipc/worksheet";
import { Icon, type IconName } from "../../icons/Icon";
import { tableKey } from "../../explorer/catalogState";
import { ensureObjects } from "../../state/catalog";
import { worksheetOf } from "../../state/worksheets";
import { type Bridge, connectionOf, defaultSchema, tableDetail } from "../editor/catalog";
import { SNIPPETS } from "../editor/snippets";
import { signature } from "../editor/hints";
import { contextAt, statementStart } from "./context";
import { type CompletionCatalog, complete, type Item, type ItemKind, type ScopeSource } from "./engine";
import { builtIns } from "./functions";
import { wordScope } from "./words";

/** How often each item was chosen, by its label, this session. */
const chosen = new Map<string, number>();
/** The signatures of routines read, by connection, schema and specific name. */
const signatures = new Map<string, Promise<string | null>>();
/** The built-in functions, read once. */
let functions: ReturnType<typeof builtIns> | null = null;

/** The icon of each kind of item. */
const ICONS: Readonly<Record<ItemKind, IconName>> = {
  keyword: "other",
  schema: "schema",
  table: "table",
  view: "view",
  sequence: "sequence",
  cte: "table",
  column: "column",
  function: "routine",
  routine: "routine",
  join: "foreignKey",
  columns: "column",
  snippet: "worksheet",
};

/** Each kind's icon, as markup, made once. */
const iconMarkup = new Map<ItemKind, string>();

/** The icon of an item of `kind`, as an element of the list. */
export function iconElement(kind: ItemKind): HTMLElement {
  let markup = iconMarkup.get(kind);
  if (markup === undefined) {
    markup = renderToStaticMarkup(<Icon name={ICONS[kind]} />);
    iconMarkup.set(kind, markup);
  }
  const box = document.createElement("span");
  box.className = "cm-completion-kind";
  box.innerHTML = markup;
  return box;
}

/** Whether worksheet `bridge`'s run holds its connection, so the catalog is read from the cache alone. */
function busy(bridge: Bridge): boolean {
  return worksheetOf(bridge.store.current(), bridge.worksheet)?.running === true;
}

/** The catalog as completion reads it: the window's cache, read further while nothing runs. */
export function storeCatalog(bridge: Bridge): CompletionCatalog {
  const now = bridge.store.current();
  const id = connectionOf(bridge);
  const catalog = id === null ? undefined : now.catalogs[id];
  const schema = defaultSchema(bridge);
  return {
    defaultSchema: schema,
    reserved: now.reservedWords,
    keyWords: now.settings.formatKeyWords,
    schemas: () => (catalog?.schemas ?? []).map((s) => s.name),
    objects: (s) => {
      const objects = catalog?.objects[s];
      return [
        ...(objects?.tables ?? []).map((t) => ({
          name: t.name,
          kind: t.kind === "VIEW" ? ("view" as const) : ("table" as const),
        })),
        ...(objects?.sequences ?? []).map((q) => ({ name: q.name, kind: "sequence" as const })),
      ];
    },
    routines: (s) => catalog?.objects[s]?.routines ?? [],
    table: async (s, name) => {
      if (busy(bridge)) {
        return catalog?.tables[tableKey(s ?? schema ?? "", name)] ?? null;
      }
      return tableDetail(bridge, s, name);
    },
    signature: (s, specific) => {
      const key = `${String(id)}\u0000${s}\u0000${specific}`;
      let found = signatures.get(key);
      if (found === undefined) {
        if (id === null || busy(bridge)) {
          return Promise.resolve(null);
        }
        found = catalogRoutine(id, s, specific).then(signature, () => null);
        signatures.set(key, found);
      }
      return found;
    },
    builtIns: (functions ??= builtIns()),
    snippets: SNIPPETS,
    recent: (label) => chosen.get(label) ?? 0,
  };
}

/** A completion of `item`, its choice remembered for its rank. */
export function toCompletion(item: Item): Completion {
  const remember = () => {
    chosen.set(item.label, (chosen.get(item.label) ?? 0) + 1);
  };
  const base: Completion = {
    label: item.label,
    type: item.kind,
    boost: Math.min(99, item.boost),
    ...(item.detail === undefined ? {} : { detail: item.detail }),
    ...(item.info === undefined ? {} : { info: item.info }),
  };
  if (item.kind === "snippet" && item.apply !== undefined) {
    const expand = snippet(item.apply);
    return {
      ...base,
      apply: (view, completion, from, to) => {
        remember();
        expand(view, completion, from, to);
      },
    };
  }
  const text = item.apply ?? item.label;
  return {
    ...base,
    apply: (view, _completion, from, to) => {
      remember();
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
    },
  };
}

/** The statement's sources: read by Turborel's parser where it parses, else by its words. */
async function sourcesOf(statement: string, cursor: number): Promise<ScopeSource[]> {
  const parsed = await statementScope(statement, cursor).catch(() => null);
  return parsed?.parsed === true ? [...parsed.sources] : wordScope(statement);
}

/** Where the statement the cursor is in ends: at the next `;` of code, or the text's end. */
function statementEnd(text: string, cursor: number): number {
  const rest = text.slice(cursor);
  const end = rest.search(/;/u);
  return end === -1 ? text.length : cursor + end;
}

/** The completion source of worksheet `bridge`'s editor. */
export function completionSource(bridge: Bridge): (context: CompletionContext) => Promise<CompletionResult | null> {
  return async (cm) => {
    const text = cm.state.doc.toString();
    const at = contextAt(text, cm.pos);
    const before = text[cm.pos - 1] ?? "";
    const asked =
      cm.explicit ||
      at.word !== "" ||
      at.star !== null ||
      before === "." ||
      (before === "(" && at.place.kind === "insertColumns");
    if (!asked || at.place.kind === "none") {
      return null;
    }
    const id = connectionOf(bridge);
    const schema = defaultSchema(bridge);
    if (id !== null && schema !== null && !busy(bridge)) {
      await ensureObjects(bridge.store, id, schema);
    }
    const start = statementStart(text, cm.pos);
    const sources = await sourcesOf(text.slice(start, statementEnd(text, cm.pos)), cm.pos - start);
    const offer = await complete(at, sources, storeCatalog(bridge));
    return { from: offer.from, options: offer.items.map(toCompletion), validFor: /^[\w$"]*$/u };
  };
}
