/**
 * A worksheet's runs' timings compared (RULES.md D39): each run of a
 * statement beside the run of the same text on the same connection
 * before it, how much slower or faster it was.
 */
import type { Timing } from "../state/worksheets";

/** A timing, with the one before it of the same statement and connection. */
export interface Compared {
  readonly timing: Timing;
  readonly before: Timing | null;
  /** Its time's change from the one before's, as a share: 0.5 is half as long again; null with none before. */
  readonly change: number | null;
}

/** The time a timing is compared by: the server's where it tells it, else the window's, in milliseconds. */
export function timeOf(t: Timing): number {
  return t.serverMicros === null ? t.millis : t.serverMicros / 1000;
}

/** `timings` compared, the latest first. */
export function comparedTimings(timings: readonly Timing[]): Compared[] {
  const found = timings.map((timing, i) => {
    const before =
      timings
        .slice(0, i)
        .reverse()
        .find((t) => t.sql === timing.sql && t.connection === timing.connection && !t.failed) ?? null;
    const change =
      before === null || timing.failed || timeOf(before) === 0 ? null : timeOf(timing) / timeOf(before) - 1;
    return { timing, before, change };
  });
  return found.reverse();
}

/** A change as the pane says it: its share, slower or faster. */
export function changeText(change: number | null): string {
  if (change === null) {
    return "";
  }
  const percent = Math.round(Math.abs(change) * 100);
  if (percent === 0) {
    return "the same";
  }
  return `${String(percent)}% ${change > 0 ? "slower" : "faster"}`;
}
