/**
 * EXPLAIN's text read as a plan (Turborel's `sql/statements/explain.md`,
 * RULES.md D36, D54): its stages, each a tree of operators by their
 * indentation, two spaces a level; each operator's figures, of EXPLAIN's
 * estimates and cost and of EXPLAIN ANALYZE's actual rows, loops, probes
 * and time, the batches it gave, what it spilled, what it read of an
 * index, and the rows a data change changed; its parallel degree, and the
 * line it came of; the join order
 * and the algorithm that found it; and the notes after, of rows counted
 * by storage and of rows run. A line it does not know is an operator of
 * its first word, and lines before any stage's header are a stage of
 * their own, so no text fails to be read.
 */

/** An operator of a plan. */
export interface PlanNode {
  /** Its name, as SeqScan. */
  readonly operator: string;
  /** What follows its name: its table, condition or columns. */
  readonly detail: string;
  /** Each parenthesized part after it, as written. */
  readonly notes: readonly string[];
  /** The rows estimated, if told. */
  readonly estimated: number | null;
  /** The rows it gave, of EXPLAIN ANALYZE. */
  readonly actual: number | null;
  /** How many times it was opened, if more than once. */
  readonly loops: number | null;
  /** An index nested loop's probes. */
  readonly probes: number | null;
  /** Its time, in milliseconds, where the clock moved. */
  readonly millis: number | null;
  /** Whether it never ran. */
  readonly neverRun: boolean;
  /** Its cost, as the planner estimated it, if told. */
  readonly cost: number | null;
  /** The threads a part run in parallel takes, of `Parallel`. */
  readonly degree: number | null;
  /** The rows a data change changed, of its line `actual rows changed=N`. */
  readonly changed: number | null;
  /** The batches it gave, and their rows on average, if it ran by batches. */
  readonly batches: { readonly count: number; readonly meanRows: number } | null;
  /** What it spilled past its work area: the bytes, the partitions written, the passes reading them back. */
  readonly spilled: { readonly bytes: number; readonly partitions: number; readonly passes: number } | null;
  /** What it read of an index, or a B-tree's leaves, each of what it told. */
  readonly reads: {
    readonly entries: number | null;
    readonly fetched: number | null;
    readonly rechecked: number | null;
    readonly leafPages: number | null;
  } | null;
  /** The line it came of, its indentation taken off. */
  readonly raw: string;
  /** Its inputs. */
  readonly children: readonly PlanNode[];
}

/** A stage of a plan: bound, optimized or physical, with what its header says after its name. */
export interface Stage {
  readonly name: string;
  readonly said: string;
  readonly roots: readonly PlanNode[];
}

/** A plan. */
export interface Plan {
  readonly stages: readonly Stage[];
  /** The tables a stage's storage counted, by the note `-- counted by storage:`. */
  readonly counted: readonly string[];
  /** The rules the rewrite applied, none if none. */
  readonly rules: readonly string[];
  /** The rows the query gave, or the data change changed, of EXPLAIN ANALYZE. */
  readonly ran: number | null;
  /** Whether those rows were changed, of a data change's `-- ran: N rows changed`. */
  readonly ranChanged: boolean;
  /** The query's time, of EXPLAIN ANALYZE's last line, where the clock moved. */
  readonly ranMillis: number | null;
  /** The join order taken and the algorithm that found it, of the top join's note. */
  readonly joinOrder: { readonly algorithm: string; readonly order: string } | null;
  /** EXPLAIN's lines, as given. */
  readonly lines: readonly string[];
}

/** The ratio past which an estimate is a large misestimate, either way. */
export const MISESTIMATE_RATIO = 10;

/** A header's line: `-- name:` and what follows. */
const HEADER = /^-- ([a-z ]+):\s*(.*)$/u;
/** The figure of `name=value` in a note, a longer name before any it holds. */
const FIGURE =
  /(est\. rows(?: each)?|actual rows changed|actual rows|mean rows|leaf pages|rows|loops|probes|time|cost|degree|batches|spilled|partitions|passes|entries|fetched|rechecked)=([0-9.]+)/gu;
/** The note of a join's order: its algorithm and the order. */
const JOIN_ORDER = /^join order by ([^:]+): (.+)$/u;

/** The figures of an operator's notes. */
function figures(notes: readonly string[]): Omit<PlanNode, "operator" | "detail" | "notes" | "raw" | "children"> {
  const found: Record<string, number> = {};
  for (const note of notes) {
    for (const [, name = "", value = ""] of note.matchAll(FIGURE)) {
      found[name] ??= Number(value);
    }
  }
  return {
    ...done(found),
    estimated: found["est. rows"] ?? found["est. rows each"] ?? found["rows"] ?? null,
    actual: found["actual rows"] ?? null,
    loops: found["loops"] ?? null,
    probes: found["probes"] ?? null,
    millis: found["time"] ?? null,
    neverRun: notes.includes("never run"),
    cost: found["cost"] ?? null,
    degree: found["degree"] ?? null,
  };
}

/** What an operator did beyond its rows, of the figures `found`, each only if told. */
function done(found: Readonly<Record<string, number>>): Pick<PlanNode, "changed" | "batches" | "spilled" | "reads"> {
  const of = (name: string): number | null => found[name] ?? null;
  const [batches, meanRows] = [of("batches"), of("mean rows")];
  const [bytes, partitions, passes] = [of("spilled"), of("partitions"), of("passes")];
  const reads = {
    entries: of("entries"),
    fetched: of("fetched"),
    rechecked: of("rechecked"),
    leafPages: of("leaf pages"),
  };
  return {
    changed: of("actual rows changed"),
    batches: batches === null ? null : { count: batches, meanRows: meanRows ?? 0 },
    spilled: bytes === null ? null : { bytes, partitions: partitions ?? 0, passes: passes ?? 0 },
    reads: Object.values(reads).every((v) => v === null) ? null : reads,
  };
}

/** An operator of the line `text`, its indentation taken off: name, detail and notes. */
function operatorOf(text: string): Omit<PlanNode, "children"> {
  const [main = "", ...rest] = text.split("  (");
  const notes = rest.map((n) => n.replace(/\)$/u, ""));
  const space = main.indexOf(" ");
  const operator = space === -1 ? main : main.slice(0, space);
  const detail = space === -1 ? "" : main.slice(space + 1);
  return { operator, detail, notes, ...figures(notes), raw: text };
}

/** A tree of operators being built. */
interface Building extends Omit<PlanNode, "children"> {
  children: Building[];
}

/** What a header line of a plan says, kept as it is read. */
interface Reading {
  readonly stages: { name: string; said: string; roots: Building[] }[];
  readonly counted: string[];
  rules: string[];
  ran: number | null;
  ranChanged: boolean;
  ranMillis: number | null;
  joinOrder: Plan["joinOrder"];
}

/** Keeps what header `name`, saying `said`, tells: a stage begun, or the rules, tables counted or rows run. */
function header(reading: Reading, name: string, said: string): void {
  if (name === "rules") {
    reading.rules = said === "none" ? [] : said.split(/,\s*/u);
  } else if (name === "counted by storage") {
    reading.counted.push(...said.split(/,\s*/u));
  } else if (name === "ran") {
    const [, rows = "", changed, millis] = /^(\d+) rows?( changed)?(?: in ([0-9.]+) ms)?/u.exec(said) ?? [];
    reading.ran = rows === "" ? null : Number(rows);
    reading.ranChanged = changed !== undefined;
    reading.ranMillis = millis === undefined ? null : Number(millis);
  } else {
    reading.stages.push({ name, said, roots: [] });
  }
}

/** The plan of EXPLAIN's lines, one row of its result each. */
export function parsePlan(lines: readonly string[]): Plan {
  const reading: Reading = {
    stages: [],
    counted: [],
    rules: [],
    ran: null,
    ranChanged: false,
    ranMillis: null,
    joinOrder: null,
  };
  let path: Building[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    const found = HEADER.exec(line.trim());
    if (found !== null) {
      header(reading, found[1] ?? "", found[2] ?? "");
      path = [];
      continue;
    }
    if (line.trim() === "") {
      continue;
    }
    if (reading.stages.length === 0) {
      reading.stages.push({ name: "plan", said: "", roots: [] });
    }
    const stage = reading.stages[reading.stages.length - 1];
    const depth = Math.floor((line.length - line.trimStart().length) / 2);
    const node: Building = { ...operatorOf(line.trimStart()), children: [] };
    const order = node.notes.map((n) => JOIN_ORDER.exec(n)).find((m) => m !== null);
    if (order !== undefined && reading.joinOrder === null) {
      reading.joinOrder = { algorithm: order[1] ?? "", order: order[2] ?? "" };
    }
    path = path.slice(0, depth);
    const parent = path.at(-1);
    (parent === undefined ? stage?.roots : parent.children)?.push(node);
    path.push(node);
  }
  const { stages, counted, rules, ran, ranChanged, ranMillis, joinOrder } = reading;
  return { stages, counted, rules, ran, ranChanged, ranMillis, joinOrder, lines };
}

/** Whether `node`'s estimate is off its actual rows by `MISESTIMATE_RATIO` or more, either way. */
export function misestimated(node: PlanNode): boolean {
  if (node.estimated === null || node.actual === null) {
    return false;
  }
  const [low, high] = [Math.min(node.estimated, node.actual), Math.max(node.estimated, node.actual)];
  return high >= MISESTIMATE_RATIO && high >= low * MISESTIMATE_RATIO;
}

/** The operators of `roots`, each once, depth first. */
export function operators(roots: readonly PlanNode[]): PlanNode[] {
  return roots.flatMap((n) => [n, ...operators(n.children)]);
}
