/**
 * A worksheet's timings (RULES.md D39): each statement run, its time in
 * the window and on the server, its rows, and how it compares with the
 * run of the same statement before it.
 */
import { useStore, useStudio } from "../state/store";
import { changeWorksheet, type Timing, worksheetOf } from "../state/worksheets";
import { changeText, comparedTimings } from "./runTimes";

/** No timings. */
const NONE: readonly Timing[] = [];
/** The characters of a statement the pane shows. */
const SHOWN = 80;

/** A statement as the pane shows it: its first line, cut short. */
function shortened(sql: string): string {
  const line = sql.trim().split("\n")[0] ?? "";
  return line.length > SHOWN ? `${line.slice(0, SHOWN - 1)}…` : line;
}

/** The timings of worksheet `id`. */
export function Timings({ id }: { readonly id: string }) {
  const store = useStore();
  const timings = useStudio((s) => worksheetOf(s, id)?.timings ?? NONE);
  const open = useStudio((s) => s.open);
  if (timings.length === 0) {
    return <p className="hint">No run yet: each statement run is timed here.</p>;
  }
  return (
    <div className="timings">
      <button
        type="button"
        onClick={() => {
          changeWorksheet(store, id, (w) => ({ ...w, timings: [] }));
        }}
      >
        Clear Timings
      </button>
      <table className="result-table" aria-label="Timings">
        <thead>
          <tr>
            <th scope="col">At</th>
            <th scope="col">Connection</th>
            <th scope="col">Statement</th>
            <th scope="col">Rows</th>
            <th scope="col">Window ms</th>
            <th scope="col">Server ms</th>
            <th scope="col">Against the run before</th>
          </tr>
        </thead>
        <tbody>
          {comparedTimings(timings).map(({ timing, change }) => (
            <tr key={`${String(timing.at)}.${timing.sql}`} className={timing.failed ? "timing-failed" : undefined}>
              <td>{new Date(timing.at).toLocaleTimeString()}</td>
              <td>{open.find((c) => c.id === timing.connection)?.name ?? String(timing.connection)}</td>
              <td title={timing.sql}>
                <code>{shortened(timing.sql)}</code>
              </td>
              <td>{timing.rows === null ? "" : String(timing.rows)}</td>
              <td>{String(Math.round(timing.millis))}</td>
              <td>{timing.serverMicros === null ? "" : (timing.serverMicros / 1000).toFixed(1)}</td>
              <td>{timing.failed ? "failed" : changeText(change)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
