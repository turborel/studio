/**
 * A session's record read back (RULES.md D67): its entries found by a
 * text, the plans of a tab compared between two moments, and a summary
 * for a ticket, as Markdown or HTML, of the entries the presenter picks:
 * each tab's SQL, its plan's first lines, its results as the record holds
 * them, masked columns written masked, a production tab's values left out
 * unless asked; the suggestions; and the presenter's conclusions.
 */
import type { RecordEntry, RecordRead, SharedTab } from "../ipc/live";

/** The lines of a plan a summary writes, at most. */
export const PLAN_LINES = 12;
/** The rows of a result a summary writes, at most. */
export const SUMMARY_ROWS = 20;

/** What a summary holds: the entries picked, by place, whether production's values go in, and the conclusions. */
export interface SummaryChoice {
  readonly picked: ReadonlySet<number>;
  readonly productionValues: boolean;
  readonly conclusions: string;
  readonly format: "markdown" | "html";
}

/** The text `entry` holds, of its tabs' SQL, messages and plans, or its suggestion, for search. */
function textOf(entry: RecordEntry): string {
  switch (entry.kind) {
    case "shared":
      return entry.state.tabs.map((t) => [t.title, t.text, ...t.messages, ...t.plan].join("\n")).join("\n");
    case "suggested":
      return `${entry.by}\n${entry.sql}`;
    case "joined":
    case "left":
      return entry.by;
    case "ended":
      return "";
  }
}

/** The places of the entries of `record` whose text holds `text`, ignoring case; all of an empty text. */
export function found(record: RecordRead, text: string): number[] {
  const wanted = text.trim().toLowerCase();
  return record.entries.flatMap((e, i) => (wanted === "" || textOf(e).toLowerCase().includes(wanted) ? [i] : []));
}

/** The plan of tab `tab` at entry `at` of `record`, or none. */
export function planAt(record: RecordRead, at: number, tab: string): readonly string[] {
  const entry = record.entries[at];
  return entry?.kind === "shared" ? (entry.state.tabs.find((t) => t.id === tab)?.plan ?? []) : [];
}

/** A line of a plan compared: its text at the first moment and the second, and whether they differ. */
export interface PlanLine {
  readonly before: string;
  readonly after: string;
  readonly differs: boolean;
}

/** The plans of tab `tab` at entries `a` and `b`, line by line. */
export function comparedPlans(record: RecordRead, [a, b]: readonly [number, number], tab: string): PlanLine[] {
  const before = planAt(record, a, tab);
  const after = planAt(record, b, tab);
  return Array.from({ length: Math.max(before.length, after.length) }, (_, i) => {
    const x = before[i] ?? "";
    const y = after[i] ?? "";
    return { before: x, after: y, differs: x !== y };
  });
}

/** `ms` as a time of day. */
function clock(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

/** A part of a summary: a heading, text, code, a table, or a list. */
type Part =
  | { readonly kind: "heading"; readonly level: number; readonly text: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "table"; readonly head: readonly string[]; readonly rows: readonly (readonly string[])[] };

/** The parts of a worksheet tab, its values as `values` allows. */
function tabParts(tab: SharedTab, values: boolean): Part[] {
  const parts: Part[] = [
    { kind: "heading", level: 3, text: `${tab.title}${tab.environment === null ? "" : ` (${tab.environment})`}` },
  ];
  if (tab.text.trim() !== "") {
    parts.push({ kind: "code", text: tab.text.trim() });
  }
  if (tab.plan.length > 0) {
    const more = tab.plan.length > PLAN_LINES ? [`… ${String(tab.plan.length - PLAN_LINES)} lines more`] : [];
    parts.push({ kind: "code", text: [...tab.plan.slice(0, PLAN_LINES), ...more].join("\n") });
  }
  const results = tab.results;
  if (results !== null) {
    const head = results.columns.map((c) => c.name ?? "");
    if (!values || !tab.values) {
      parts.push({ kind: "text", text: `A result of ${head.join(", ")}: its values are left out.` });
    } else {
      const rows = results.rows
        .slice(0, SUMMARY_ROWS)
        .map((r) => r.map((cell, i) => (results.columns[i]?.masked === true ? "masked" : (cell ?? "NULL"))));
      parts.push({ kind: "table", head, rows });
      if (results.cut || results.rows.length > SUMMARY_ROWS) {
        parts.push({ kind: "text", text: "More rows were read than are written here." });
      }
    }
  }
  return parts;
}

/** The parts of the entries of `record` picked, as `choice` says. */
function parts(record: RecordRead, choice: SummaryChoice): Part[] {
  const head = record.head;
  const all: Part[] = [
    { kind: "heading", level: 1, text: `Live Session of ${head.presenter}` },
    { kind: "text", text: `Begun ${new Date(head.started).toISOString().slice(0, 16).replace("T", " ")} UTC.` },
  ];
  record.entries.forEach((entry, i) => {
    if (!choice.picked.has(i)) {
      return;
    }
    if (entry.kind === "shared") {
      all.push({
        kind: "heading",
        level: 2,
        text: `At ${clock(entry.at)}${entry.by === null ? "" : `, presented by ${entry.by}`}`,
      });
      for (const tab of entry.state.tabs.filter((t) => t.kind === "worksheet")) {
        all.push(...tabParts(tab, tab.environment !== "production" || choice.productionValues));
      }
    } else if (entry.kind === "suggested") {
      all.push(
        { kind: "heading", level: 2, text: `At ${clock(entry.at)}, ${entry.by} suggested` },
        { kind: "code", text: entry.sql },
      );
    }
  });
  if (choice.conclusions.trim() !== "") {
    all.push({ kind: "heading", level: 2, text: "Conclusions" }, { kind: "text", text: choice.conclusions.trim() });
  }
  return all;
}

/** `text` with Markdown's table bars escaped and its lines joined. */
function cellMd(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

/** `part` as Markdown. */
function markdown(part: Part): string {
  switch (part.kind) {
    case "heading":
      return `${"#".repeat(part.level)} ${part.text}`;
    case "text":
      return part.text;
    case "code":
      return `\`\`\`\n${part.text.replaceAll("```", "` ` `")}\n\`\`\``;
    case "table":
      return [
        `| ${part.head.map(cellMd).join(" | ")} |`,
        `|${part.head.map(() => "---").join("|")}|`,
        ...part.rows.map((r) => `| ${r.map(cellMd).join(" | ")} |`),
      ].join("\n");
  }
}

/** `text` escaped for HTML. */
function escaped(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** `part` as HTML. */
function html(part: Part): string {
  switch (part.kind) {
    case "heading":
      return `<h${String(part.level)}>${escaped(part.text)}</h${String(part.level)}>`;
    case "text":
      return `<p>${escaped(part.text)}</p>`;
    case "code":
      return `<pre><code>${escaped(part.text)}</code></pre>`;
    case "table":
      return `<table><tr>${part.head.map((h) => `<th>${escaped(h)}</th>`).join("")}</tr>${part.rows
        .map((r) => `<tr>${r.map((c) => `<td>${escaped(c)}</td>`).join("")}</tr>`)
        .join("")}</table>`;
  }
}

/** The summary of `record` as `choice` says: exactly what is written. */
export function summary(record: RecordRead, choice: SummaryChoice): string {
  const all = parts(record, choice);
  if (choice.format === "markdown") {
    return `${all.map(markdown).join("\n\n")}\n`;
  }
  const title = escaped(`Live Session of ${record.head.presenter}`);
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>${title}</title></head><body>\n${all.map(html).join("\n")}\n</body></html>\n`;
}

/** The entries a summary picks at first: each workspace shared and each suggestion. */
export function firstPicked(record: RecordRead): Set<number> {
  return new Set(record.entries.flatMap((e, i) => (e.kind === "shared" || e.kind === "suggested" ? [i] : [])));
}
