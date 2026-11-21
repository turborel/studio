/**
 * The chart view of a result (RULES.md D52): its rows drawn as bars or
 * lines of the columns chosen, named by the column chosen, on one scale
 * of round ticks; each mark tells its row, column and value as the
 * pointer rests on it, a legend names two series or more, and the grid
 * view keeps every value as text.
 */
import type { Chart, ChartKind } from "../ipc/analyzer";
import type { ColumnInfo } from "../ipc/connections";
import type { RunResult } from "../state/worksheets";
import {
  type ChartData,
  chartData,
  columnName,
  compact,
  MAX_CHART_ROWS,
  MAX_CHART_SERIES,
  numeric,
  type Series,
  ticks,
} from "./chart";

/** The chart's size, in the units of its drawing, scaled to its pane. */
const WIDTH = 720;
const HEIGHT = 320;
/** The room for the scale's ticks, the labels below, and air above and right. */
const LEFT = 56;
const BOTTOM = 44;
const TOP = 12;
const RIGHT = 12;
/** The widest a bar is, the gap between bars, and the rounding of a bar's end. */
const BAR = 24;
const GAP = 2;
const ROUND = 4;
/** The most labels written below the rows, and the most characters of each. */
const MAX_LABELS = 12;
const LABEL_CHARS = 12;
/** The most rows whose points are marked on a line. */
const MARKED = 50;

/** The colour of series `i`. */
function colour(i: number): string {
  return `var(--series${String((i % MAX_CHART_SERIES) + 1)})`;
}

/** A bar from `base` to `top` at `x`, `w` wide, its data end rounded and its base square. */
function barPath(x: number, w: number, base: number, top: number): string {
  const r = Math.min(ROUND, w / 2, Math.abs(base - top));
  const n = (v: number) => String(Math.round(v * 100) / 100);
  const end = top <= base ? top + r : top - r;
  return [
    `M${n(x)},${n(base)}V${n(end)}`,
    `Q${n(x)},${n(top)} ${n(x + r)},${n(top)}H${n(x + w - r)}`,
    `Q${n(x + w)},${n(top)} ${n(x + w)},${n(end)}V${n(base)}Z`,
  ].join("");
}

/** The scale of `data`: its ticks, and where a value falls. */
function scaleOf(data: ChartData) {
  const marks = ticks(data.low, data.high);
  const low = marks[0] ?? data.low;
  const high = marks.at(-1) ?? data.high;
  const plot = HEIGHT - TOP - BOTTOM;
  const y = (v: number) => TOP + (high === low ? plot / 2 : ((high - v) / (high - low)) * plot);
  return { marks, y };
}

/** The tooltip of a mark. */
function said(data: ChartData, series: Series, r: number, value: number): string {
  return `${data.labels[r] ?? ""} · ${series.name}: ${String(value)}`;
}

/** The bars of `data`, the series of each row side by side. */
function Bars({ data, y }: { readonly data: ChartData; readonly y: (v: number) => number }) {
  const band = (WIDTH - LEFT - RIGHT) / data.labels.length;
  const k = data.series.length;
  const w = Math.max(1, Math.min(BAR, (band * 0.8 - (k - 1) * GAP) / k));
  const group = k * w + (k - 1) * GAP;
  return (
    <g>
      {data.series.map((s, si) =>
        s.values.map((v, r) =>
          v === null ? null : (
            <path
              key={`${String(si)}.${String(r)}`}
              d={barPath(LEFT + band * r + (band - group) / 2 + si * (w + GAP), w, y(0), y(v))}
              fill={colour(si)}
            >
              <title>{said(data, s, r, v)}</title>
            </path>
          ),
        ),
      )}
    </g>
  );
}

/** The lines of `data`, each through its rows in order, broken where a row has none. */
function Lines({ data, y }: { readonly data: ChartData; readonly y: (v: number) => number }) {
  const band = (WIDTH - LEFT - RIGHT) / data.labels.length;
  const x = (r: number) => LEFT + band * r + band / 2;
  return (
    <g>
      {data.series.map((s, si) => {
        const path = s.values
          .map((v, r) =>
            v === null ? null : `${s.values[r - 1] === null || r === 0 ? "M" : "L"}${String(x(r))},${String(y(v))}`,
          )
          .filter((p) => p !== null)
          .join("");
        return (
          <g key={s.name}>
            <path
              d={path}
              fill="none"
              stroke={colour(si)}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {s.values.map((v, r) =>
              v === null ? null : (
                <circle
                  key={r}
                  cx={x(r)}
                  cy={y(v)}
                  r={data.labels.length <= MARKED ? 4 : 2}
                  fill={colour(si)}
                  stroke="var(--background)"
                  strokeWidth={2}
                >
                  <title>{said(data, s, r, v)}</title>
                </circle>
              ),
            )}
          </g>
        );
      })}
    </g>
  );
}

/** The chart of `data`, of `kind`. */
function Drawing({ data, kind }: { readonly data: ChartData; readonly kind: ChartKind }) {
  const { marks, y } = scaleOf(data);
  const band = (WIDTH - LEFT - RIGHT) / data.labels.length;
  const every = Math.ceil(data.labels.length / MAX_LABELS);
  return (
    <svg className="chart" viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`} role="img" aria-label="Chart">
      {marks.map((t) => (
        <g key={t}>
          <line x1={LEFT} x2={WIDTH - RIGHT} y1={y(t)} y2={y(t)} className="chart-grid" />
          <text x={LEFT - 6} y={y(t)} className="chart-tick" textAnchor="end" dominantBaseline="middle">
            {compact(t)}
          </text>
        </g>
      ))}
      {kind === "bar" ? <Bars data={data} y={y} /> : <Lines data={data} y={y} />}
      {data.labels.map((label, r) =>
        r % every === 0 ? (
          <text
            key={r}
            x={LEFT + band * r + band / 2}
            y={HEIGHT - BOTTOM + 16}
            className="chart-tick"
            textAnchor="middle"
          >
            {label.length > LABEL_CHARS ? `${label.slice(0, LABEL_CHARS - 1)}…` : label}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/** The chart's choices: its kind, the column naming its rows, and the columns it draws. */
function ChartChoices(props: {
  readonly columns: readonly ColumnInfo[];
  readonly chart: Chart;
  readonly onChart: (chart: Chart) => void;
}) {
  const { columns, chart, onChart } = props;
  const names = columns.map((_, i) => columnName(columns, i));
  const toggle = (name: string) => {
    const values = chart.values.includes(name) ? chart.values.filter((v) => v !== name) : [...chart.values, name];
    onChart({ ...chart, values: values.slice(0, MAX_CHART_SERIES) });
  };
  return (
    <div className="chart-choices">
      <select
        aria-label="Chart kind"
        value={chart.kind}
        onChange={(e) => {
          onChart({ ...chart, kind: e.target.value === "line" ? "line" : "bar" });
        }}
      >
        <option value="bar">Bars</option>
        <option value="line">Lines</option>
      </select>
      <label>
        By{" "}
        <select
          aria-label="Rows named by"
          value={chart.label}
          onChange={(e) => {
            onChart({ ...chart, label: e.target.value });
          }}
        >
          {names.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      {columns.map((c, i) => {
        const name = columnName(columns, i);
        return numeric(c) ? (
          <ValueChoice key={name} name={name} chosen={chart.values.includes(name)} onToggle={toggle} />
        ) : null;
      })}
    </div>
  );
}

/** A column of numbers, drawn or not. */
function ValueChoice(props: {
  readonly name: string;
  readonly chosen: boolean;
  readonly onToggle: (name: string) => void;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={props.chosen}
        onChange={() => {
          props.onToggle(props.name);
        }}
      />
      <span>{props.name}</span>
    </label>
  );
}

/** The legend of two series or more: each its colour's mark and its name. */
function Legend({ data }: { readonly data: ChartData }) {
  if (data.series.length < 2) {
    return null;
  }
  return (
    <ul className="chart-legend" aria-label="Legend">
      {data.series.map((s, i) => (
        <li key={s.name}>
          <span className="chart-swatch" style={{ background: colour(i) }} />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

/** The chart view of `run`, as `chart` says, changed by `onChart`; or why it cannot be drawn. */
export function ChartView(props: {
  readonly run: RunResult;
  readonly chart: Chart | null;
  readonly onChart: (chart: Chart) => void;
}) {
  const { run, chart, onChart } = props;
  if (chart === null) {
    return <p className="hint">No column of the result holds numbers to draw.</p>;
  }
  const data = chartData(run.columns, run.rows, chart);
  return (
    <div className="chart-view">
      <ChartChoices columns={run.columns} chart={chart} onChart={onChart} />
      {typeof data === "string" ? (
        <p className="hint">{data}</p>
      ) : (
        <>
          <Legend data={data} />
          <Drawing data={data} kind={chart.kind} />
          {run.rows.length > MAX_CHART_ROWS && (
            <p className="hint">The first {String(MAX_CHART_ROWS)} rows are drawn; the grid shows them all.</p>
          )}
        </>
      )}
    </div>
  );
}
