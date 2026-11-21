/**
 * Reports (RULES.md D52): the built-in reports and the user's own, listed
 * in the explorer, each opened in a worksheet of its own and run there,
 * its rows shown as a table or its chart; a result's query kept as a
 * report of the user's, with the chart it is shown in.
 */
import { useState } from "react";
import { type Chart, forgetReport, keepReport, type Report } from "../ipc/analyzer";
import { splitScript } from "../ipc/worksheet";
import { isStudioError, show } from "../state/actions";
import { runStatements } from "../state/running";
import { type Store, useStore, useStudio } from "../state/store";
import { changeWorksheet, openWorksheet } from "../state/worksheets";
import { Icon } from "../icons/Icon";
import { Modal } from "../shell/Modal";

/** Runs `work`, keeping its failure as the error shown. */
async function kept(store: Store, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (thrown: unknown) {
    if (isStudioError(thrown)) {
      store.update((now) => ({ ...now, error: thrown }));
    }
  }
}

/** Opens `report` in a worksheet of its own, on the active connection, and runs it. */
export async function openReport(store: Store, report: Report): Promise<void> {
  const id = openWorksheet(store, report.sql, report.name);
  changeWorksheet(store, id, (w) => ({ ...w, chart: report.chart }));
  await kept(store, async () => {
    const pieces = await splitScript(report.sql);
    await runStatements(
      store,
      id,
      pieces.map((p) => ({ sql: p.statement.text, from: p.from, to: p.to, class: p.statement.class })),
    );
  });
}

/** A report of the list: opened by a click; one of the user's forgotten by its button. */
function ReportItem({ report, own }: { readonly report: Report; readonly own: boolean }) {
  const store = useStore();
  return (
    <li>
      <button
        type="button"
        className="link with-icon"
        title={report.sql}
        onClick={() => void openReport(store, report)}
      >
        <Icon name={report.chart === null ? "table" : "chart"} />
        {report.name}
      </button>
      {own && (
        <button
          type="button"
          aria-label={`Forget ${report.name}`}
          onClick={() =>
            void kept(store, async () => {
              const mine = await forgetReport(report.id);
              store.update((now) => ({ ...now, reports: { ...now.reports, own: mine } }));
            })
          }
        >
          Forget
        </button>
      )}
    </li>
  );
}

/** The reports: the built-in, then the user's own. */
export function Reports() {
  const reports = useStudio((s) => s.reports);
  return (
    <>
      <ul className="library" aria-label="Built-in reports">
        {reports.builtIn.map((r) => (
          <ReportItem key={r.id} report={r} own={false} />
        ))}
      </ul>
      {reports.own.length === 0 ? (
        <p className="hint">None of your own yet: a result&apos;s Save as Report keeps one.</p>
      ) : (
        <ul className="library" aria-label="Your reports">
          {reports.own.map((r) => (
            <ReportItem key={r.id} report={r} own />
          ))}
        </ul>
      )}
    </>
  );
}

/** Keeps `sql` as a report of the user's, named, shown in `chart` or as a table. */
export function SaveReportDialog({ sql, chart }: { readonly sql: string; readonly chart: Chart | null }) {
  const store = useStore();
  const [name, setName] = useState("");
  const close = () => {
    show(store, null);
  };
  const save = () =>
    void kept(store, async () => {
      const own = await keepReport({ id: crypto.randomUUID().replaceAll("-", ""), name: name.trim(), sql, chart });
      store.update((now) => ({ ...now, reports: { ...now.reports, own }, dialog: null }));
    });
  return (
    <Modal title="Save as Report" onClose={close}>
      <label className="check">
        <span>Name</span>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </label>
      <p className="hint">
        {chart === null
          ? "Its rows are shown as a table."
          : `Its rows are shown as a ${chart.kind} chart of ${chart.values.join(", ")} by ${chart.label}.`}
      </p>
      <pre className="definition-text">{sql}</pre>
      <div className="dialog-buttons">
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button type="button" disabled={name.trim() === ""} onClick={save}>
          Save
        </button>
      </div>
    </Modal>
  );
}
