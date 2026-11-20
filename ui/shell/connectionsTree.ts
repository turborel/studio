/**
 * The saved connections as the explorer shows them (RULES.md D28): the
 * pinned first, then each folder and its connections, folders and names
 * in order, and the recent ones by when they were used.
 */
import type { SavedList, SavedView } from "../ipc/saved";

/** A folder of the tree: its name, its folders and its connections. */
export interface Folder {
  readonly name: string;
  readonly folders: readonly Folder[];
  readonly connections: readonly SavedView[];
}

/** The order of two names, as people read them. */
const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

/** The folder of `views`, named `name`, each at `depth` of its path and below. */
function folderOf(name: string, views: readonly SavedView[], depth: number): Folder {
  const here = views.filter((v) => v.connection.folder.length === depth);
  const below = new Map<string, SavedView[]>();
  for (const view of views.filter((v) => v.connection.folder.length > depth)) {
    const child = view.connection.folder[depth] ?? "";
    below.set(child, [...(below.get(child) ?? []), view]);
  }
  return {
    name,
    folders: [...below.entries()]
      .sort(([a], [b]) => byName(a, b))
      .map(([child, inner]) => folderOf(child, inner, depth + 1)),
    connections: [...here].sort((a, b) => byName(a.connection.name, b.connection.name)),
  };
}

/** The tree of `list`: its pinned connections, its folders, and its recent ones. */
export function tree(list: SavedList): { pinned: SavedView[]; root: Folder; recent: SavedView[] } {
  const pinned = list.connections
    .filter((v) => v.connection.pinned)
    .sort((a, b) => byName(a.connection.name, b.connection.name));
  const recent = list.recent.flatMap((id) => list.connections.filter((v) => v.connection.id === id));
  return { pinned, root: folderOf("", list.connections, 0), recent };
}
