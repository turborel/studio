/**
 * The panes below a worksheet's editor (RULES.md D36, D39): its results,
 * a tab of each, a pinned one kept as the worksheet runs again; its
 * messages, a failure's place shown in the editor by a click; its plan;
 * and its runs' timings.
 */
import { closeRun } from "../results/actions";
import { ResultView } from "../results/ResultView";
import { Timings } from "../results/Timings";
import { useStore, useStudio } from "../state/store";
import { changeWorksheet, type Pane, type RunResult, worksheetOf } from "../state/worksheets";
import { showFailure } from "./editor/actions";
import { viewOf } from "./editor/views";
import { PlanView } from "./PlanView";
import { Icon } from "../icons/Icon";

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

/** The tab of result `run`: its name, and, if pinned, its pin and its close button. */
function ResultTab(props: {
  readonly id: string;
  readonly run: RunResult;
  readonly name: string;
  readonly selected: boolean;
}) {
  const store = useStore();
  const { id, run } = props;
  return (
    <span className="result-tab">
      <button
        type="button"
        role="tab"
        aria-selected={props.selected}
        onClick={() => {
          changeWorksheet(store, id, (w) => ({ ...w, shown: run.id }));
        }}
      >
        {run.pinned && <Icon name="pin" />}
        {props.name}
      </button>
      {run.pinned && (
        <button
          type="button"
          className="tool"
          aria-label={`Close ${props.name}`}
          title={`Close ${props.name}`}
          onClick={() => void closeRun(store, id, run.id)}
        >
          <Icon name="close" />
        </button>
      )}
    </span>
  );
}

/** The results of worksheet `id`: a tab of each run that gave rows. */
function Results({ id }: { readonly id: string }) {
  const runs = useStudio((s) => worksheetOf(s, id)?.runs ?? NO_RUNS);
  const shown = useStudio((s) => worksheetOf(s, id)?.shown ?? null);
  const open = useStudio((s) => s.open);
  const results = runs.filter((r) => r.outcome?.kind === "rows" && r.plan === null);
  const run = results.find((r) => r.id === shown) ?? results.at(-1);
  if (run === undefined) {
    return <p className="hint">No result yet: run a statement to see its rows.</p>;
  }
  const names = new Map(results.map((r, i) => [r.id, resultName(r, i, results, open)]));
  return (
    <>
      {results.length > 1 && (
        <div role="tablist" className="tabs" aria-label="Results">
          {results.map((r) => (
            <ResultTab key={r.id} id={id} run={r} name={names.get(r.id) ?? ""} selected={r.id === run.id} />
          ))}
        </div>
      )}
      <ResultView key={run.id} id={id} run={run} names={names} />
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
  const choose = (next: Pane) => () => {
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
        <button type="button" role="tab" aria-selected={pane === "timings"} onClick={choose("timings")}>
          <Icon name="timings" />
          Timings
        </button>
      </div>
      <div role="tabpanel" className="pane">
        {pane === "results" && <Results id={id} />}
        {pane === "messages" && <Messages id={id} />}
        {pane === "plan" && <PlanView plans={plans ?? []} />}
        {pane === "timings" && <Timings id={id} />}
      </div>
    </div>
  );
}
