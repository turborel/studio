/**
 * A result (RULES.md D39): its toolbar, its rows in the view chosen, the
 * viewer of the cell selected beside them, and below, the rows read and
 * the time. The toolbar chooses the view, filters and sorts on the
 * server, copies, exports, pins and compares; the status bar tells of the
 * cells selected.
 */
import { CompactSelection, type GridSelection, type Item } from "@glideapps/glide-data-grid";
import { useEffect, useState } from "react";
import { Icon, type IconName, LARGE } from "../icons/Icon";
import { fetchMore } from "../state/running";
import { type Store, useStore, useStudio } from "../state/store";
import { type RunResult, worksheetOf } from "../state/worksheets";
import { chosenCells, copyCells, exportResult, pinResult, queryOf, requery, requeryable, showSummary } from "./actions";
import { summary, summaryText } from "./aggregate";
import { COPY_FORMATS, type CopyFormat } from "./copy";
import { editCell } from "./edits";
import { stage } from "./editing";
import { EditTools } from "./EditTools";
import { Grid } from "./Grid";
import { nextSort } from "./requery";
import { CompareView, GraphOfResult, PlaneOfResult, RecordView, spatialColumns, TextView } from "./ResultParts";
import { defaultChart } from "./chart";
import { ChartView } from "./ChartView";
import type { Chart } from "../ipc/analyzer";
import { show } from "../state/actions";
import { allOf, chosenOf } from "./selection";
import { cellMenu, headerMenu } from "./menus";
import { type MenuItem, openMenu } from "../shell/ContextMenu";
import { ValueViewer, type Viewed } from "./viewers/ValueViewer";

/** How a result is shown. */
export type ResultMode = "grid" | "text" | "record" | "graph" | "plane" | "chart";

/** Each view: its icon and name. */
const MODES: readonly (readonly [ResultMode, IconName, string])[] = [
  ["grid", "grid", "Grid"],
  ["text", "textView", "Text"],
  ["record", "record", "Record"],
  ["graph", "graph", "Graph"],
  ["plane", "plane", "Plane"],
  ["chart", "chart", "Chart"],
];

/** No selection. */
const NOTHING: GridSelection = { columns: CompactSelection.empty(), rows: CompactSelection.empty() };

/** A button of the toolbar: its icon, and its name as its tooltip and accessible name. */
function Tool(props: {
  readonly icon: IconName;
  readonly name: string;
  readonly onClick: () => void;
  readonly pressed?: boolean;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="tool"
      title={props.name}
      aria-label={props.name}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size={LARGE} />
    </button>
  );
}

/** What `run`'s cell at `col`, `row` is, for the viewer. */
export function viewedAt(run: RunResult, [col, row]: Item): Viewed | null {
  const column = run.columns[col];
  if (column === undefined || run.outcome?.kind !== "rows" || row >= run.rows.length) {
    return null;
  }
  const locator = run.lobs.includes(`${String(row)}:${String(col)}`)
    ? { connection: run.connection, result: run.outcome.result, row, column: col }
    : null;
  return { cell: run.rows[row]?.[col] ?? null, column, locator };
}

/** The filter's bar: a search condition of the result's columns, applied on Enter. */
function FilterBar({ id, run }: { readonly id: string; readonly run: RunResult }) {
  const store = useStore();
  const [text, setText] = useState(queryOf(run).filter);
  return (
    <form
      className="filter-bar"
      onSubmit={(e) => {
        e.preventDefault();
        void requery(store, id, run.id, (q) => ({ ...q, filter: text }));
      }}
    >
      <label>
        <Icon name="filter" /> WHERE{" "}
        <input
          type="text"
          value={text}
          placeholder="a condition of the columns, as NAME LIKE 'A%'"
          aria-label="Filter"
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
      </label>
      <Tool
        icon="clearFilter"
        name="Clear Filter and Sort"
        disabled={run.query === null}
        onClick={() => void requery(store, id, run.id, (q) => ({ ...q, filter: "", sort: [] }))}
      />
    </form>
  );
}

/** The toolbar's copying: a format, with headers or not. */
function CopyTools(props: { readonly onCopy: (format: CopyFormat) => void }) {
  const [format, setFormat] = useState<CopyFormat>("tsv");
  return (
    <span className="tool-group" role="group" aria-label="Copy">
      <select
        aria-label="Copy as"
        className="copy-format"
        value={format}
        onChange={(e) => {
          setFormat(e.target.value as CopyFormat);
        }}
      >
        {COPY_FORMATS.map(([f, name]) => (
          <option key={f} value={f}>
            {name}
          </option>
        ))}
      </select>
      <Tool
        icon="copy"
        name="Copy"
        onClick={() => {
          props.onCopy(format);
        }}
      />
    </span>
  );
}

/** The results a result may be compared with: the worksheet's others that gave rows. */
function others(runs: readonly RunResult[], run: RunResult): RunResult[] {
  return runs.filter((r) => r.id !== run.id && r.outcome?.kind === "rows" && r.plan === null);
}

/** What a result view keeps: how it is shown, the cells selected, the columns frozen, and what it shows besides. */
interface ViewState {
  readonly mode: ResultMode;
  readonly selection: GridSelection;
  readonly freeze: number;
  readonly record: number;
  readonly viewing: boolean;
  /** The columns hidden, by their places. */
  readonly hidden: readonly number[];
  readonly comparing: number | null;
  /** The chart of the chart view, as last chosen; null for the one first shown. */
  readonly chart: Chart | null;
}

/** A result view's state as first shown. */
const FIRST: ViewState = {
  mode: "grid",
  selection: NOTHING,
  freeze: 0,
  record: 0,
  viewing: false,
  hidden: [],
  comparing: null,
  chart: null,
};

/** What a result view's parts are given: the worksheet, the run, its state and the change of it. */
interface Parts {
  readonly id: string;
  readonly run: RunResult;
  readonly view: ViewState;
  readonly change: (next: Partial<ViewState>) => void;
}

/** The cells the selection chooses, each with its column, for the status bar. */
function selectedCells(run: RunResult, selection: GridSelection) {
  const chosen = chosenOf(selection, run.rows.length, run.columns.length);
  if (chosen === null) {
    return null;
  }
  const cells = chosenCells(run, chosen);
  return cells.rows.flatMap((r) =>
    r.flatMap((c, i) => {
      const column = cells.columns[i];
      return column === undefined ? [] : [[c, column] as const];
    }),
  );
}

/** Tells the status bar of the cells selected, and nothing once the view is gone. */
function useSummary(run: RunResult, selection: GridSelection): void {
  const store = useStore();
  useEffect(() => {
    const cells = selectedCells(run, selection);
    showSummary(store, cells === null ? null : summaryText(summary(cells)));
  }, [store, run, selection]);
  useEffect(
    () => () => {
      showSummary(store, null);
    },
    [store],
  );
}

/** The toolbar's choice of view, and the value viewer. */
function ModeTools({ run, view, change }: Parts) {
  const modes = MODES.filter(
    ([m]) => (m !== "plane" || spatialColumns(run).length > 0) && (m !== "chart" || defaultChart(run.columns) !== null),
  );
  return (
    <span className="tool-group" role="group" aria-label="View">
      {modes.map(([m, icon, name]) => (
        <Tool
          key={m}
          icon={icon}
          name={`${name} View`}
          pressed={view.mode === m}
          onClick={() => {
            change({ mode: m });
          }}
        />
      ))}
      <Tool
        icon="details"
        name="Value Viewer"
        pressed={view.viewing}
        onClick={() => {
          change({ viewing: !view.viewing });
        }}
      />
    </span>
  );
}

/** The toolbar's pin and comparison. */
function KeepTools({ id, run, view, change, names }: Parts & { readonly names: ReadonlyMap<number, string> }) {
  const store = useStore();
  const runs = useStudio((s) => worksheetOf(s, id)?.runs ?? NO_RUNS);

  return (
    <span className="tool-group" role="group" aria-label="Keep">
      <Tool
        icon={run.pinned ? "unpin" : "pin"}
        name={run.pinned ? "Unpin Result" : "Pin Result"}
        pressed={run.pinned}
        onClick={() => {
          pinResult(store, id, run.id, !run.pinned);
        }}
      />
      <label className="compare-choice">
        <Icon name="compare" />{" "}
        <select
          aria-label="Compare with"
          value={view.comparing === null ? "" : String(view.comparing)}
          onChange={(e) => {
            change({ comparing: e.target.value === "" ? null : Number(e.target.value) });
          }}
        >
          <option value="">Compare with…</option>
          {others(runs, run).map((r) => (
            <option key={r.id} value={String(r.id)}>
              {names.get(r.id) ?? `Result ${String(r.id)}`}
            </option>
          ))}
        </select>
      </label>
    </span>
  );
}

/** The toolbar's less-used items, of its menu "More": the other export, a report, and whether copies hold the headers. */
function moreItems(store: Store, parts: Parts, headers: [boolean, (on: boolean) => void]): MenuItem[] {
  const { id, run, view } = parts;
  const [withHeaders, setHeaders] = headers;
  return [
    { label: "Export as Native Rows…", icon: "save", run: () => exportResult(store, id, run.id, "native") },
    {
      label: "Save as Report…",
      icon: "chart",
      run: () => {
        show(store, {
          kind: "report",
          sql: run.sql,
          chart: view.mode === "chart" ? (view.chart ?? defaultChart(run.columns)) : null,
        });
      },
    },
    "separator",
    {
      label: withHeaders ? "Copy without Headers" : "Copy with Headers",
      icon: "copy",
      run: () => {
        setHeaders(!withHeaders);
      },
    },
  ];
}

/** A result's toolbar, on one row: the views, copying, export, pinning, comparing and editing; the rest of its menu "More". */
function ResultToolbar(parts: Parts & { readonly names: ReadonlyMap<number, string> }) {
  const store = useStore();
  const { id, run, view } = parts;
  const [headers, setHeaders] = useState(true);
  const copy = (format: CopyFormat) => {
    const chosen = chosenOf(view.selection, run.rows.length, run.columns.length);
    void copyCells(store, id, run.id, { format, headers }, chosen ?? allOf(run.rows.length, run.columns.length));
  };
  return (
    <div className="result-toolbar" role="toolbar" aria-label="Result">
      <ModeTools {...parts} />
      <CopyTools onCopy={copy} />
      <span className="tool-group" role="group" aria-label="Export">
        <Tool icon="export" name="Export as CSV…" onClick={() => void exportResult(store, id, run.id, "csv")} />
      </span>
      <KeepTools {...parts} />
      <EditTools id={id} run={run} selection={view.selection} />
      <button
        type="button"
        className="tool"
        title="More"
        aria-label="More of the result"
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          openMenu(store, { x: r.left, y: r.bottom }, moreItems(store, parts, [headers, setHeaders]));
        }}
      >
        ⋯
      </button>
    </div>
  );
}

/** The grid of a result: a click on a header sorts by it on the server, a cell's menu opened by its button. */
function ResultGrid({ id, run, view, change }: Parts) {
  const store = useStore();
  const running = useStudio((s) => worksheetOf(s, id)?.running ?? false);
  return (
    <Grid
      columns={run.columns}
      rows={run.rows}
      complete={run.complete}
      sort={queryOf(run).sort}
      freeze={view.freeze}
      selection={view.selection}
      onSelection={(selection) => {
        change({ selection });
      }}
      onMore={() => void fetchMore(store, id, run.id)}
      onHeader={(column, adding) => {
        if (requeryable(run) && !running) {
          void requery(store, id, run.id, (q) => ({ ...q, sort: nextSort(q.sort, column, adding) }));
        }
      }}
      hidden={view.hidden}
      onCellMenu={(cell, at) => {
        openMenu(store, at, cellMenu(store, { id, run, view, change }, cell));
      }}
      onHeaderMenu={(column, at) => {
        openMenu(store, at, headerMenu(store, { id, run, view, change }, column));
      }}
      editing={run.editing}
      lobs={run.lobs}
      onEdit={(cell, value) => {
        stage(store, id, run.id, (e) => editCell(e, cell, value, run.rows.length));
      }}
    />
  );
}

/** The view of a result chosen: or the comparison, if one is chosen. */
function ResultMain(parts: Parts) {
  const { id, run, view, change } = parts;
  const runs = useStudio((s) => worksheetOf(s, id)?.runs ?? NO_RUNS);
  const other = others(runs, run).find((r) => r.id === view.comparing);
  if (other !== undefined) {
    return <CompareView left={run} right={other} />;
  }
  switch (view.mode) {
    case "grid":
      return <ResultGrid {...parts} />;
    case "text":
      return <TextView run={run} />;
    case "record":
      return (
        <RecordView
          run={run}
          row={view.record}
          onRow={(record) => {
            change({ record });
          }}
        />
      );
    case "graph":
      return <GraphOfResult run={run} />;
    case "plane":
      return <PlaneOfResult run={run} row={view.selection.current?.cell[1] ?? null} />;
    case "chart":
      return (
        <ChartView
          run={run}
          chart={view.chart ?? defaultChart(run.columns)}
          onChart={(chart) => {
            change({ chart });
          }}
        />
      );
  }
}

/** The bar below a result: the rows read, its time, and whether more may be read. */
function ResultBar({ id, run, view }: Parts) {
  const store = useStore();
  return (
    <div className="result-bar">
      <span className="hint">
        {String(run.rows.length)} rows read{run.complete ? "" : ", more to read"}
        {run.millis === null ? "" : `; ${String(Math.round(run.millis))} ms`}
        {run.query === null ? "" : "; sorted or filtered"}
        {view.freeze > 0 ? `; ${String(view.freeze)} columns frozen` : ""}
      </span>
      {!run.complete && (
        <button type="button" onClick={() => void fetchMore(store, id, run.id)}>
          Read more
        </button>
      )}
    </div>
  );
}

/** The viewer of the cell selected, beside the rows. */
function ValuePanel({ run, current }: { readonly run: RunResult; readonly current: Item | null }) {
  const viewed = current === null ? null : viewedAt(run, current);
  const result = run.outcome?.kind === "rows" ? run.outcome.result : 0;
  return (
    <aside className="result-viewer" aria-label="Value">
      {viewed === null || current === null ? (
        <p className="hint">Select a cell to view its value.</p>
      ) : (
        <ValueViewer key={`${String(result)}.${String(current[0])}.${String(current[1])}`} viewed={viewed} />
      )}
    </aside>
  );
}

/** No runs. */
const NO_RUNS: readonly RunResult[] = [];

/** A result of worksheet `id`, `names` naming the worksheet's results. */
export function ResultView({
  id,
  run,
  names,
}: {
  readonly id: string;
  readonly run: RunResult;
  readonly names: ReadonlyMap<number, string>;
}) {
  const reported = useStudio((s) => worksheetOf(s, id)?.chart ?? null);
  const [view, setView] = useState<ViewState>(() =>
    reported === null ? FIRST : { ...FIRST, mode: "chart", chart: reported },
  );
  const change = (next: Partial<ViewState>) => {
    setView((v) => ({ ...v, ...next }));
  };
  const parts: Parts = { id, run, view, change };
  useSummary(run, view.selection);
  const current = view.selection.current?.cell ?? null;
  return (
    <div className="result">
      <ResultToolbar {...parts} names={names} />
      {requeryable(run) && <FilterBar key={queryOf(run).filter} id={id} run={run} />}
      <div className="result-body">
        <div className="result-main">
          <ResultMain {...parts} />
        </div>
        {view.viewing && <ValuePanel run={run} current={current} />}
      </div>
      <ResultBar {...parts} />
    </div>
  );
}
