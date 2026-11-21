/**
 * The models open in the window (RULES.md D46): each a tab of the dock,
 * its model, its file if it has one, whether it changed since saved, and
 * how its diagram is shown; made new, opened from a file, read from a
 * live schema, saved, and closed.
 */
import { saveTextFile } from "../ipc/catalog";
import { openModelFile } from "../ipc/model";
import { writeSqlFile } from "../ipc/worksheet";
import type { Store, StudioState } from "../state/store";
import { laidOut } from "./layout";
import { emptyModel, type Model, modelText, parseModel } from "./model";

/** A model open in the window. */
export interface ModelDoc {
  readonly id: string;
  readonly model: Model;
  readonly path: string | null;
  readonly modified: boolean;
  /** The open connection it was read from, or is compared with. */
  readonly connection: number | null;
  /** The text the tables shown hold in their names. */
  readonly filter: string;
  /** Whether the tables are drawn in a box of each schema. */
  readonly grouped: boolean;
  /** The table selected, by its schema and name. */
  readonly selected: string | null;
  /** What was last told of the model, as a save. */
  readonly told: string;
}

/** A new identifier. */
function newId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/** Model `id` of `now`. */
export function modelOf(now: StudioState, id: string | null): ModelDoc | undefined {
  return now.models.find((m) => m.id === id);
}

/** Changes model `id` as `change` says. */
export function changeModel(store: Store, id: string, change: (m: ModelDoc) => ModelDoc): void {
  store.update((now) => ({ ...now, models: now.models.map((m) => (m.id === id ? change(m) : m)) }));
}

/** Changes the model of `id`, marked changed. */
export function editModel(store: Store, id: string, change: (m: Model) => Model): void {
  changeModel(store, id, (d) => ({ ...d, model: change(d.model), modified: true }));
}

/** Opens `model` as a model of the window, from `path` if it has one: its identifier. */
export function openModel(
  store: Store,
  model: Model,
  { path = null, connection = null }: { path?: string | null; connection?: number | null } = {},
): string {
  const id = newId();
  const doc: ModelDoc = {
    id,
    model: laidOut(model),
    path,
    modified: path === null && model.tables.length > 0,
    connection,
    filter: "",
    grouped: false,
    selected: null,
    told: "",
  };
  store.update((now) => ({ ...now, models: [...now.models, doc], activeModel: id }));
  return id;
}

/** Opens a new, empty model. */
export function newModel(store: Store): string {
  return openModel(store, emptyModel("Model"), { connection: store.current().active });
}

/** Opens a model's file the platform's dialog chooses: its identifier, or null; a file that is no model refused, with why. */
export async function openModelFrom(store: Store): Promise<string | null> {
  const file = await openModelFile();
  if (file === null) {
    return null;
  }
  return openModel(store, parseModel(file.text), { path: file.path });
}

/** Saves model `id` to its file, or, if it has none or `as`, to one the platform's dialog chooses. */
export async function saveModel(store: Store, id: string, as = false): Promise<void> {
  const doc = modelOf(store.current(), id);
  if (doc === undefined) {
    return;
  }
  const text = modelText(doc.model);
  let path = as ? null : doc.path;
  if (path === null) {
    path = await saveTextFile(`${doc.model.name}.json`, text);
  } else {
    await writeSqlFile(path, text);
  }
  if (path !== null) {
    const saved = path;
    changeModel(store, id, (d) => ({ ...d, path: saved, modified: false, told: `Saved to ${saved}.` }));
  }
}

/** Closes model `id`, its changes not saved let go. */
export function closeModel(store: Store, id: string): void {
  store.update((now) => {
    const models = now.models.filter((m) => m.id !== id);
    return { ...now, models, activeModel: now.activeModel === id ? (models.at(-1)?.id ?? null) : now.activeModel };
  });
}

/** Makes model `id` the active one. */
export function activateModel(store: Store, id: string): void {
  store.update((now) => ({ ...now, activeModel: id }));
}
