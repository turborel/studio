/**
 * What the table dialogs do with the DDL they write (RULES.md D44): open
 * it in a worksheet of the connection, to be read and run there, or run
 * it there at once, through the worksheet's guards, its messages telling
 * what it did; the explorer reads the catalog again after, as after any
 * statement that changes definitions.
 */
import type { Piece } from "../ipc/worksheet";
import { splitScript } from "../ipc/worksheet";
import { runStatements } from "../state/running";
import type { Store } from "../state/store";
import { changeWorksheet, openWorksheet } from "../state/worksheets";

/** Opens `sql` in a worksheet titled `title` on `connection`, and runs it if `run`: the worksheet. */
export async function openDdl(
  store: Store,
  connection: number,
  { sql, title }: { sql: string; title: string },
  run: boolean,
): Promise<string> {
  store.update((now) => ({ ...now, dialog: null }));
  const id = openWorksheet(store, sql, title);
  changeWorksheet(store, id, (w) => ({ ...w, connection }));
  if (run) {
    const pieces: Piece[] = await splitScript(sql);
    await runStatements(
      store,
      id,
      pieces.map((p) => ({ sql: p.statement.text, from: p.from, to: p.to, class: p.statement.class })),
    );
  }
  return id;
}
