/**
 * A result's rows as a chart (RULES.md D52): a column naming each row,
 * and the numbers of up to eight columns, drawn as bars or lines; the
 * first rows read alone, so a chart of any result stays small. Its
 * scale's ticks are round numbers, written compactly.
 */
import type { Chart } from "../ipc/analyzer";
import type { Cell, ColumnInfo } from "../ipc/connections";

/** The most rows a chart draws. */
export const MAX_CHART_ROWS = 200;
/** The most columns a chart draws, as many as its series have colours. */
export const MAX_CHART_SERIES = 8;

/** The types whose values are numbers. */
const NUMERIC = /^(SMALLINT|INTEGER|INT|BIGINT|NUMERIC|DECIMAL|DEC|REAL|DOUBLE PRECISION|DOUBLE|FLOAT|DECFLOAT)\b/u;

/** A column's name, or its place in parentheses if it has none. */
export function columnName(columns: readonly ColumnInfo[], i: number): string {
  return columns[i]?.name ?? `(${String(i + 1)})`;
}

/** Whether `column`'s values are numbers. */
export function numeric(column: ColumnInfo): boolean {
  return NUMERIC.test(column.typeWritten.toUpperCase());
}

/** The chart first shown of `columns`: the first column not of numbers naming the rows, the others of numbers drawn as bars; null if none is of numbers. */
export function defaultChart(columns: readonly ColumnInfo[]): Chart | null {
  const labelAt = Math.max(
    0,
    columns.findIndex((c) => !numeric(c)),
  );
  const values = columns
    .map((c, i) => [c, i] as const)
    .filter(([c, i]) => i !== labelAt && numeric(c))
    .slice(0, MAX_CHART_SERIES)
    .map(([, i]) => columnName(columns, i));
  return values.length === 0 ? null : { kind: "bar", label: columnName(columns, labelAt), values };
}

/** A series of a chart: its column's name and its numbers, null where a row has none. */
export interface Series {
  readonly name: string;
  readonly values: readonly (number | null)[];
}

/** What a chart draws: each row's label, each series, and the range its scale covers. */
export interface ChartData {
  readonly labels: readonly string[];
  readonly series: readonly Series[];
  readonly low: number;
  readonly high: number;
}

/** The chart of `rows` that `chart` says, or why it cannot be drawn. */
export function chartData(
  columns: readonly ColumnInfo[],
  rows: readonly (readonly Cell[])[],
  chart: Chart,
): ChartData | string {
  const at = (name: string) => columns.findIndex((_, i) => columnName(columns, i) === name);
  const labelAt = at(chart.label);
  if (labelAt === -1) {
    return `The result has no column ${chart.label}.`;
  }
  const missing = chart.values.find((v) => at(v) === -1);
  if (missing !== undefined) {
    return `The result has no column ${missing}.`;
  }
  const shown = rows.slice(0, MAX_CHART_ROWS);
  const series = chart.values.slice(0, MAX_CHART_SERIES).map((name) => {
    const i = at(name);
    return {
      name,
      values: shown.map((r) => {
        const n = Number(r[i] ?? Number.NaN);
        return Number.isFinite(n) ? n : null;
      }),
    };
  });
  const numbers = series.flatMap((s) => s.values.filter((v) => v !== null));
  if (numbers.length === 0) {
    return "No row holds a number of the columns chosen.";
  }
  return {
    labels: shown.map((r) => r[labelAt] ?? "NULL"),
    series,
    low: Math.min(0, ...numbers),
    high: Math.max(0, ...numbers),
  };
}

/** A round step of about `span` / `count`: 1, 2 or 5 of a power of ten. */
function step(span: number, count: number): number {
  const rough = span / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const scaled = rough / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
}

/** The ticks of a scale from `low` to `high`, about `count` of them, round numbers, covering both. */
export function ticks(low: number, high: number, count = 5): number[] {
  if (low === high) {
    return [low];
  }
  const by = step(high - low, count);
  const first = Math.floor(low / by) * by;
  const found: number[] = [];
  for (let t = first; t < high + by; t += by) {
    found.push(Number(t.toPrecision(12)));
    if (t >= high) {
      break;
    }
  }
  return found;
}

/** `n` written compactly: 950, 1.2K, 3.4M, 5.6B; small numbers as they are. */
export function compact(n: number): string {
  const size = Math.abs(n);
  for (const [unit, at] of [
    ["B", 1e9],
    ["M", 1e6],
    ["K", 1e3],
  ] as const) {
    if (size >= at) {
      return `${String(Number((n / at).toPrecision(3)))}${unit}`;
    }
  }
  return String(Number(n.toPrecision(6)));
}
