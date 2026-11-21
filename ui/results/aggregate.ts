/**
 * What the status bar tells of the cells selected (RULES.md D39): how
 * many hold a value, and, of numbers, their sum, average, least and
 * greatest. Exact numbers are summed exactly, as decimals, never through
 * a float (R-NUM-1); approximate ones as floats.
 */
import type { Cell, ColumnInfo } from "../ipc/connections";
import { typeKind } from "./literals";

/** A decimal: its digits as an integer, and how many of them are after the point. */
interface Decimal {
  readonly units: bigint;
  readonly scale: number;
}

/** The digits an average keeps past its numbers' scale. */
const AVERAGE_DIGITS = 6;

/** `text`, an exact number as Turborel writes one, as a decimal; null if it is none. */
export function decimal(text: string): Decimal | null {
  const found = /^([-+]?)(\d*)(?:\.(\d*))?$/u.exec(text.trim());
  if (found === null || `${found[2] ?? ""}${found[3] ?? ""}` === "") {
    return null;
  }
  const fraction = found[3] ?? "";
  const units = BigInt(`${found[2] ?? ""}${fraction}` || "0");
  return { units: found[1] === "-" ? -units : units, scale: fraction.length };
}

/** `d` at scale `scale`, which is no less than its own. */
function scaled(d: Decimal, scale: number): bigint {
  return d.units * 10n ** BigInt(scale - d.scale);
}

/** `d` as text. */
export function decimalText(d: Decimal): string {
  const negative = d.units < 0n;
  const digits = (negative ? -d.units : d.units).toString().padStart(d.scale + 1, "0");
  const whole = digits.slice(0, digits.length - d.scale);
  const fraction = d.scale === 0 ? "" : `.${digits.slice(digits.length - d.scale)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** `a` compared with `b`: negative, zero or positive. */
function compared(a: Decimal, b: Decimal): number {
  const scale = Math.max(a.scale, b.scale);
  const difference = scaled(a, scale) - scaled(b, scale);
  return difference === 0n ? 0 : difference < 0n ? -1 : 1;
}

/** `sum` divided by `count`, rounded half away from zero to `AVERAGE_DIGITS` more digits, its trailing zeros let go. */
function average(sum: Decimal, count: number): Decimal {
  const scale = sum.scale + AVERAGE_DIGITS;
  const numerator = scaled(sum, scale) * 2n;
  const denominator = BigInt(count) * 2n;
  const half = numerator < 0n ? -BigInt(count) : BigInt(count);
  let units = (numerator + half) / denominator;
  let kept = scale;
  while (kept > sum.scale && units % 10n === 0n) {
    units /= 10n;
    kept -= 1;
  }
  return { units, scale: kept };
}

/** What the status bar tells of cells. */
export interface Summary {
  /** The cells selected. */
  readonly cells: number;
  /** The cells that hold a value. */
  readonly count: number;
  /** Of numbers alone, as text; null where the cells are not all numbers. */
  readonly sum: string | null;
  readonly average: string | null;
  readonly minimum: string | null;
  readonly maximum: string | null;
}

/** The figures of the exact numbers `values`. */
function exact(values: readonly string[]): Pick<Summary, "sum" | "average" | "minimum" | "maximum"> | null {
  const parsed = values.map(decimal);
  if (parsed.some((d) => d === null) || parsed.length === 0) {
    return null;
  }
  const numbers = parsed as Decimal[];
  const scale = Math.max(...numbers.map((d) => d.scale));
  const sum = { units: numbers.reduce((total, d) => total + scaled(d, scale), 0n), scale };
  return {
    sum: decimalText(sum),
    average: decimalText(average(sum, numbers.length)),
    minimum: decimalText(numbers.reduce((a, b) => (compared(a, b) <= 0 ? a : b))),
    maximum: decimalText(numbers.reduce((a, b) => (compared(a, b) >= 0 ? a : b))),
  };
}

/** The figures of the approximate numbers `values`. */
function approximate(values: readonly string[]): Pick<Summary, "sum" | "average" | "minimum" | "maximum"> | null {
  const numbers = values.map(Number);
  if (numbers.some(Number.isNaN) || numbers.length === 0) {
    return null;
  }
  const sum = numbers.reduce((total, n) => total + n, 0);
  return {
    sum: String(sum),
    average: String(sum / numbers.length),
    minimum: String(Math.min(...numbers)),
    maximum: String(Math.max(...numbers)),
  };
}

/** What the status bar tells of `cells`, each with its column. */
export function summary(cells: readonly (readonly [Cell, ColumnInfo])[]): Summary {
  const values = cells.filter((c): c is readonly [string, ColumnInfo] => c[0] !== null);
  const kinds = new Set(values.map(([, column]) => typeKind(column)));
  const texts = values.map(([text]) => text);
  const figures =
    kinds.size === 1 && kinds.has("exact")
      ? exact(texts)
      : [...kinds].every((k) => k === "exact" || k === "approximate") && kinds.size > 0
        ? approximate(texts)
        : null;
  return {
    cells: cells.length,
    count: values.length,
    sum: figures?.sum ?? null,
    average: figures?.average ?? null,
    minimum: figures?.minimum ?? null,
    maximum: figures?.maximum ?? null,
  };
}

/** `s` as the status bar says it. */
export function summaryText(s: Summary): string {
  const parts = [`Count ${String(s.count)} of ${String(s.cells)}`];
  if (s.sum !== null) {
    parts.push(`Sum ${s.sum}`, `Average ${s.average ?? ""}`, `Min ${s.minimum ?? ""}`, `Max ${s.maximum ?? ""}`);
  }
  return parts.join(" · ");
}
