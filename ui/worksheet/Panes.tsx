/**
 * The panes below a worksheet's editor (RULES.md D36): its results, each a
 * run's rows read so far, more read as asked; its messages, a failure's
 * place shown in the editor by a click; and its plan.
 */
import type { Cell } from "../ipc/connections";
import { fetchMore } from "../state/running";
import { useStore, useStudio } from "../state/store";
import { changeWorksheet, type RunResult, worksheetOf } from "../state/worksheets";
import { showFailure } from "./editor/actions";
import { viewOf } from "./editor/views";
import { PlanView } from "./PlanView";
import { Icon } from "../icons/Icon";

/** A cell as the grid shows it: its text, or NULL. */
export function shownCell(cell: Cell): string {
  return cell ?? "NULL";
}

/** A run's rows, read so far. */
function Rows({ id, run }: { readonly id: string; readonly run: RunResult }) {
  const store = useStore();
  if (run.outcome?.kind !== "rows") {
    return <p className="hint">{run.error === null ? "The statement gave no rows." : run.error.message}</p>;
  }
  return (
    <div className="result">
      <table className="result-table" aria-label="Result">
        <thead>
          <tr>
            {run.columns.map((c, i) => (
              <th key={`${String(i)}.${c.name ?? ""}`} scope="col" title={c.typeWritten}>
                {c.name ?? `(${String(i + 1)})`}
                <span className="result-type">{c.typeWritten}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {run.rows.map((row, r) => (
            <tr key={String(r)}>
              {row.map((cell, c) => (
                <td key={String(c)} className={cell === null ? "null" : undefined}>
                  {shownCell(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="result-bar">
        <span className="hint">
          {String(run.rows.length)} rows read{run.complete ? "" : ", more to read"}
        </span>
        {!run.complete && (
          <button type="button" onClick={() => void fetchMore(store, id, run.id)}>
            Read more
          </button>
        )}
      </div>
    </div>
  );
}

/** A result's tab's name: its number, after its connection's name where the results are of several. */
export function resultName(
  run: RunResult,
  i: number,
  results: readonly RunResult[],
  open: readonly { id: number; name: string }[],
): string {
  const several = new Set(results.map((r) => r.connection)).size > 1;
  const name = open.find((c) => c.id === run.connection)?.name ?? `Connection ${String(run.connection)}`;
  return several ? `${name}: Result ${String(i + 1)}` : `Result ${String(i + 1)}`;
}

/** The results of worksheet `id`: a tab of each run that gave rows. */
function Results({ id }: { readonly id: string }) {
  const store = useStore();
  const runs = useStudio((s) => worksheetOf(s, id)?.runs ?? NO_RUNS);
  const shown = useStudio((s) => worksheetOf(s, id)?.shown ?? null);
  const open = useStudio((s) => s.open);
  const results = runs.filter((r) => r.outcome?.kind === "rows" && r.plan === null);
  const run = results.find((r) => r.id === shown) ?? results.at(-1);
  if (run === undefined) {
    return <p className="hint">No result yet: run a statement to see its rows.</p>;
  }
  return (
    <>
      {results.length > 1 && (
        <div role="tablist" className="tabs" aria-label="Results">
          {results.map((r, i) => (
            <button
              key={r.id}
              type="button"
              role="tab"
              aria-selected={r.id === run.id}
              onClick={() => {
                changeWorksheet(store, id, (w) => ({ ...w, shown: r.id }));
              }}
            >
              {resultName(r, i, results, open)}
            </button>
          ))}
        </div>
      )}
      <Rows id={id} run={run} />
    </>
  );
}

/** No runs: one list, so the store's readers see no change. */
const NO_RUNS: readonly RunResult[] = [];

/** The messages of worksheet `id`. */
function Messages({ id }: { readonly id: string }) {
  const messages = useStudio((s) => worksheetOf(s, id)?.messages);
  if (messages === undefined || messages.length === 0) {
    return <p className="hint">No messages yet.</p>;
  }
  return (
    <ol className="messages" aria-label="Messages">
      {messages.map((m, i) => (
        <li key={`${String(i)}.${String(m.at)}`} className={`message message-${m.kind}`}>
          <time>{new Date(m.at).toLocaleTimeString()}</time>{" "}
          {m.position === null ? (
            m.text
          ) : (
            <button
              type="button"
              className="link"
              onClick={() => {
                const view = viewOf(id);
                if (view !== undefined && m.position !== null) {
                  showFailure(view, m.position);
                }
              }}
            >
              {m.text}
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

/** The panes of worksheet `id`, the one chosen shown. */
export function Panes({ id }: { readonly id: string }) {
  const store = useStore();
  const pane = useStudio((s) => worksheetOf(s, id)?.pane ?? "results");
  const plans = useStudio((s) => worksheetOf(s, id)?.plans);
  const choose = (next: "results" | "messages" | "plan") => () => {
    changeWorksheet(store, id, (w) => ({ ...w, pane: next }));
  };
  return (
    <div className="panes">
      <div role="tablist" className="tabs" aria-label="Panes">
        <button type="button" role="tab" aria-selected={pane === "results"} onClick={choose("results")}>
          <Icon name="table" />
          Results
        </button>
        <button type="button" role="tab" aria-selected={pane === "messages"} onClick={choose("messages")}>
          <Icon name="comment" />
          Messages
        </button>
        <button type="button" role="tab" aria-selected={pane === "plan"} onClick={choose("plan")}>
          <Icon name="explain" />
          Plan
        </button>
      </div>
      <div role="tabpanel" className="pane">
        {pane === "results" && <Results id={id} />}
        {pane === "messages" && <Messages id={id} />}
        {pane === "plan" && <PlanView plans={plans ?? []} />}
      </div>
    </div>
  );
}
