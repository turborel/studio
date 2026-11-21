/**
 * The workspace shown in a session (RULES.md D56), drawn by this Studio
 * from what the presenter shares: each tab's SQL with the presenter's
 * selection marked, its result, messages and plan; a schema's diagram;
 * the analyzer's findings; and where the presenter points. The view
 * follows the presenter's tab, or the viewer's own choice. Where the
 * presenter allows no copying, the text cannot be selected, copied or cut.
 * It is held in memory alone, and let go as the session ends.
 */
import type { ClipboardEvent, MouseEvent, ReactNode } from "react";
import { useMemo, useState } from "react";
import type { Finding } from "../ipc/analyzer";
import type { SharedTab, SharedWorkspace } from "../ipc/live";
import type { Model } from "../model/model";
import type { ModelDoc } from "../model/models";
import { Diagram } from "../model/Diagram";
import { parsePlan } from "../plan/plan";
import { PlanTable } from "../plan/PlanTable";
import { physicalRoots, summarize } from "../plan/summary";
import { useStore, useStudio } from "../state/store";
import { changeLive, suggest } from "./live";

/** The SQL of `tab`, the presenter's selection marked. */
function SqlText({ tab }: { readonly tab: SharedTab }) {
  const text = tab.text;
  const from = Math.min(tab.selection?.from ?? 0, text.length);
  const to = Math.min(Math.max(tab.selection?.to ?? 0, from), text.length);
  return (
    <pre className="live-sql" aria-label="SQL">
      {text.slice(0, from)}
      {to > from ? (
        <mark className="live-selection">{text.slice(from, to)}</mark>
      ) : (
        <span className="live-cursor" aria-hidden="true" />
      )}
      {text.slice(to)}
    </pre>
  );
}

/** The result of `tab`, of its values where they are shared. */
function SharedResults({ tab }: { readonly tab: SharedTab }) {
  const results = tab.results;
  if (results === null) {
    return null;
  }
  return (
    <div className="live-results">
      <table className="details-table" aria-label="Result">
        <thead>
          <tr>
            {results.columns.map((c, i) => (
              <th key={`${String(i)}.${c.name ?? ""}`} scope="col">
                {c.name ?? `(${String(i + 1)})`} <span className="hint">{c.typeName}</span>
                {c.masked && <span className="hint"> · masked</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.rows.map((row, r) => (
            <tr key={`r${String(r)}`}>
              {row.map((cell, c) => (
                <td key={`c${String(c)}`}>{results.columns[c]?.masked === true ? "•••" : (cell ?? "NULL")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!tab.values && (
        <p className="hint">The presenter shares this connection&apos;s SQL and schema, not its values.</p>
      )}
      {tab.values && results.cut && <p className="hint">The first {String(results.rows.length)} rows are shared.</p>}
    </div>
  );
}

/** The latest plan of `tab`, as a tree-table, with its rows and time. */
function SharedPlan({ lines }: { readonly lines: readonly string[] }) {
  const plan = useMemo(() => parsePlan(lines), [lines]);
  const summary = useMemo(() => summarize(plan, []), [plan]);
  return (
    <section aria-label="Plan">
      <p className="hint">
        {summary.rows === null ? "" : `${String(summary.rows)} rows`}
        {summary.millis === null ? "" : ` in ${String(summary.millis)} ms`}
        {summary.warnings.map((w) => ` · ${w.rule}`).join("")}
      </p>
      <PlanTable roots={physicalRoots(plan)} label="Shared plan" />
    </section>
  );
}

/** A worksheet tab: its SQL, result, messages and plan, and a suggestion where granted. */
function SharedWorksheet({ tab, canSuggest }: { readonly tab: SharedTab; readonly canSuggest: boolean }) {
  const store = useStore();
  const [text, setText] = useState("");
  return (
    <>
      <SqlText tab={tab} />
      <SharedResults tab={tab} />
      {tab.messages.length > 0 && (
        <ul className="live-messages" aria-label="Messages">
          {tab.messages.map((m, i) => (
            <li key={`m${String(i)}`}>{m}</li>
          ))}
        </ul>
      )}
      {tab.plan.length > 0 && <SharedPlan lines={tab.plan} />}
      {canSuggest && (
        <form
          className="live-suggest"
          onSubmit={(e) => {
            e.preventDefault();
            void suggest(store, tab.id, text).then((sent) => {
              if (sent) {
                setText("");
              }
            });
          }}
        >
          <textarea
            aria-label="SQL to suggest"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
          <button type="submit" disabled={text.trim() === ""}>
            Suggest
          </button>
        </form>
      )}
    </>
  );
}

/** Whether `document` is a model's, as a presenter shares it. */
function modelDocOf(id: string, document: unknown): ModelDoc | null {
  const d = document as { model?: Model | null; grouped?: boolean; hidden?: readonly string[] } | null;
  const model = d?.model;
  if (model === undefined || model === null || !Array.isArray(model.tables)) {
    return null;
  }
  return {
    id,
    model,
    path: null,
    modified: false,
    connection: null,
    filter: "",
    grouped: d?.grouped === true,
    selected: null,
    hidden: Array.isArray(d?.hidden) ? d.hidden : [],
    told: "",
  };
}

/** Nothing, as the view changes nothing. */
const nothing = (): void => undefined;

/** The analyzer's findings shared. */
function SharedFindings({ document }: { readonly document: unknown }) {
  const findings = Array.isArray(document) ? (document as readonly Finding[]) : [];
  return (
    <table className="details-table" aria-label="Findings">
      <thead>
        <tr>
          <th scope="col">Rule</th>
          <th scope="col">Of</th>
          <th scope="col">Finding</th>
        </tr>
      </thead>
      <tbody>
        {findings.map((f, i) => (
          <tr key={`f${String(i)}`}>
            <td>{f.rule}</td>
            <td>{f.object}</td>
            <td>{f.says}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Tab `tab`'s content. */
function TabContent({ tab, canSuggest }: { readonly tab: SharedTab; readonly canSuggest: boolean }): ReactNode {
  switch (tab.kind) {
    case "worksheet":
      return <SharedWorksheet tab={tab} canSuggest={canSuggest} />;
    case "model": {
      const doc = modelDocOf(tab.id, tab.document);
      return doc === null ? (
        <p className="hint">This diagram cannot be drawn.</p>
      ) : (
        <Diagram doc={doc} search="" onMove={nothing} onSelect={nothing} />
      );
    }
    case "findings":
      return <SharedFindings document={tab.document} />;
  }
}

/** Stops `e`, as copying is not allowed. */
function stop(e: ClipboardEvent | MouseEvent): void {
  e.preventDefault();
}

/** The tab shown of `workspace`: the presenter's while following, else the one chosen. */
export function shownTab(workspace: SharedWorkspace, follow: boolean, chosen: string | null): SharedTab | undefined {
  const id = follow ? workspace.active : chosen;
  return workspace.tabs.find((t) => t.id === id) ?? workspace.tabs[0];
}

/** The view's head: who presents, and whether the view follows them. */
function ViewHead({ presenter, tab }: { readonly presenter: string; readonly tab: SharedTab | undefined }) {
  const store = useStore();
  const follow = useStudio((s) => s.live.follow);
  return (
    <div className="live-view-head">
      <span>Presented by {presenter}</span>
      <label className="check">
        <input
          type="checkbox"
          checked={follow}
          onChange={(e) => {
            changeLive(store, (l) => ({ ...l, follow: e.target.checked, chosen: tab?.id ?? null }));
          }}
        />
        <span>Follow the presenter</span>
      </label>
    </div>
  );
}

/** The shared tabs, the one shown chosen. */
function TabStrip({ workspace, tab }: { readonly workspace: SharedWorkspace; readonly tab: SharedTab | undefined }) {
  const store = useStore();
  return (
    <div className="live-tabs" role="tablist" aria-label="Shared tabs">
      {workspace.tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t === tab}
          className={t.environment === null ? "live-tab" : `live-tab env-${t.environment}`}
          onClick={() => {
            changeLive(store, (l) => ({ ...l, follow: false, chosen: t.id }));
          }}
        >
          {t.title}
        </button>
      ))}
    </div>
  );
}

/** The workspace shown in the session. */
export function SharedView({ canSuggest }: { readonly canSuggest: boolean }) {
  const shown = useStudio((s) => s.live.shown);
  const follow = useStudio((s) => s.live.follow);
  const chosen = useStudio((s) => s.live.chosen);
  if (shown === null) {
    return <p className="hint">Waiting for the presenter&apos;s workspace…</p>;
  }
  const { workspace, presenter } = shown;
  const tab = shownTab(workspace, follow, chosen);
  const place = tab === undefined ? -1 : workspace.tabs.indexOf(tab);
  const pointer = workspace.pointer?.tab === place ? workspace.pointer : null;
  const copy = workspace.copy;
  return (
    <section className="live-view" aria-label="Shared workspace">
      <ViewHead presenter={presenter} tab={tab} />
      <TabStrip workspace={workspace} tab={tab} />
      {workspace.tabs.length === 0 && <p className="hint">The presenter shares no tab now.</p>}
      {tab !== undefined && (
        <div
          role="tabpanel"
          className={copy ? "live-content" : "live-content live-nocopy"}
          onCopy={copy ? undefined : stop}
          onCut={copy ? undefined : stop}
          onContextMenu={copy ? undefined : stop}
        >
          <TabContent tab={tab} canSuggest={canSuggest} />
          {pointer !== null && (
            <span
              className="live-pointer"
              aria-hidden="true"
              style={{ left: `${String(pointer.x * 100)}%`, top: `${String(pointer.y * 100)}%` }}
            />
          )}
        </div>
      )}
    </section>
  );
}
