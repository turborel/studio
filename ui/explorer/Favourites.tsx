/**
 * Favourite objects (RULES.md D33): a saved connection's own, pinned at
 * the top of its catalog, each selected by a click; kept with the saved
 * connection, so they come back with it.
 */
import type { ObjectRef } from "../ipc/catalog";
import type { SavedConnection } from "../ipc/saved";
import { save } from "../state/actions";
import { select } from "../state/catalog";
import { openConnection, type Store, useStore, useStudio } from "../state/store";
import { selectable } from "./CatalogTree";
import { Icon } from "../icons/Icon";

/** No favourites: one list, so the store's readers see no change. */
const NONE: readonly ObjectRef[] = [];

/** The saved connection of open connection `connection`, if it is one. */
export function savedOf(store: Store, connection: number): SavedConnection | undefined {
  const now = store.current();
  const savedId = openConnection(now, connection)?.savedId;
  return now.saved.connections.find((v) => v.connection.id === savedId)?.connection;
}

/** Whether `a` and `b` are the same object. */
export function sameObject(a: ObjectRef, b: ObjectRef): boolean {
  return a.kind === b.kind && a.schema === b.schema && a.name === b.name;
}

/** Adds `object` to connection `connection`'s favourites, or takes it off. */
export async function toggleFavourite(store: Store, connection: number, object: ObjectRef): Promise<void> {
  const saved = savedOf(store, connection);
  if (saved === undefined) {
    return;
  }
  const has = saved.favourites.some((f) => sameObject(f, object));
  const favourites = has ? saved.favourites.filter((f) => !sameObject(f, object)) : [...saved.favourites, object];
  await save(store, { ...saved, favourites }, { kind: "keep" });
}

/** The favourites of connection `connection`, if it is saved. */
export function Favourites({ connection }: { readonly connection: number }) {
  const store = useStore();
  const favourites = useStudio((s) => {
    const savedId = openConnection(s, connection)?.savedId;
    return s.saved.connections.find((v) => v.connection.id === savedId)?.connection.favourites ?? NONE;
  });
  if (favourites.length === 0) {
    return null;
  }
  return (
    <ul className="favourites" aria-label="Favourites">
      {favourites.map((f) => {
        const target = selectable(f);
        return (
          <li key={`${f.kind}.${f.schema}.${f.name}`}>
            <button
              type="button"
              className="link"
              disabled={target === null}
              onClick={() => target !== null && void select(store, connection, target)}
            >
              <Icon name="favourite" emphasis />
              {f.schema}.{f.name}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
