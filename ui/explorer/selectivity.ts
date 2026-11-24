/**
 * An index's selectivity (RULES.md D72): of the distinct keys it counts,
 * which the planner estimates an equality on all its columns by
 * (Turborel's INDEX_STATISTICS.DISTINCT_KEYS), the share of its entries
 * such an equality keeps, one key's, and about how many entries that is.
 */
import type { IndexStatistics } from "../ipc/catalog";

/** The significant digits a share is shown to. */
const DIGITS = 2;
/** A share as a percentage. */
const PERCENT = 100;

/** The selectivity of `counted`, as the explorer and the analyzer show it; empty while it has counted no keys. */
export function selectivity(counted: IndexStatistics | null | undefined): string {
  const keys = Number(counted?.distinctKeys ?? Number.NaN);
  if (!Number.isFinite(keys) || keys < 1) {
    return "";
  }
  const percent = (PERCENT / keys).toLocaleString("en", { maximumSignificantDigits: DIGITS });
  const share = `1 in ${keys.toLocaleString("en")} (${percent}%)`;
  const entries = Number(counted?.entries ?? Number.NaN);
  if (!Number.isFinite(entries) || entries <= 0) {
    return share;
  }
  const each = Math.round(entries / keys);
  return `${share}, about ${each.toLocaleString("en")} ${each === 1 ? "entry" : "entries"} a key`;
}
