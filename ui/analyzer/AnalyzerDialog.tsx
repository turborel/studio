/**
 * The analyzer of a schema (RULES.md D50): the findings of its rules, each
 * explained, its fix opened in a worksheet to be read and run; the
 * schema's indexes, each with the constraint it serves and its distinct
 * keys and selectivity, as INDEX_STATISTICS counts them (D72); and the
 * settings that differ from their defaults.
 */
import { TopStatements, Usage } from "./Usage";
import { useEffect, useState } from "react";
import { changeLive } from "../live/live";
import { type Analysis, catalogAnalysis, type Finding } from "../ipc/analyzer";
import { openDdl } from "../data/ddlActions";
import { show } from "../state/actions";
import { useStore, useStudio } from "../state/store";
import { namer } from "../data/ddl";
import { Modal } from "../shell/Modal";
import { thrownText } from "../model/ModelDialogs";
import { selectivity } from "../explorer/selectivity";

/** The tabs of the analyzer. */
export type Tab = "findings" | "indexes" | "statements" | "usage" | "settings";

/** The tabs, each with its name. */
const TABS: readonly (readonly [Tab, string])[] = [
  ["findings", "Findings"],
  ["indexes", "Indexes"],
  ["statements", "Top Statements"],
  ["usage", "Usage and Sizes"],
  ["settings", "Settings"],
];

/** The analysis of `schema` on `connection`, read as it is shown: null until read, or the failure's text. */
function useAnalysis(connection: number, schema: string): Analysis | string | null {
  const [found, setFound] = useState<Analysis | string | null>(null);
  useEffect(() => {
    let current = true;
    catalogAnalysis(connection, schema).then(
      (analysis) => {
        if (current) {
          setFound(analysis);
        }
      },
      (thrown: unknown) => {
        if (current) {
          setFound(thrownText(thrown));
        }
      },
    );
    return () => {
      current = false;
    };
  }, [connection, schema]);
  return found;
}

/** A finding: chosen or not, its rule, object, what it says and its fix. */
function FindingItem(props: { readonly finding: Finding; readonly chosen: boolean; readonly onToggle: () => void }) {
  const f = props.finding;
  return (
    <li>
      <label className="check">
        <input type="checkbox" checked={props.chosen} onChange={props.onToggle} />
        <strong>{f.rule}</strong> <span>{f.object}</span>
      </label>
      <p>{f.says}</p>
      <pre className="definition-text">{f.fix}</pre>
    </li>
  );
}

/** The findings, each chosen at first, their fixes opened together. */
function Findings({
  findings,
  onOpen,
}: {
  readonly findings: readonly Finding[];
  readonly onOpen: (sql: string) => void;
}) {
  const [unchosen, setUnchosen] = useState<ReadonlySet<number>>(new Set());
  if (findings.length === 0) {
    return <p className="hint">No rule finds anything to change.</p>;
  }
  const toggle = (i: number) => () => {
    setUnchosen((now) => {
      const next = new Set(now);
      if (!next.delete(i)) {
        next.add(i);
      }
      return next;
    });
  };
  const chosen = findings.filter((_, i) => !unchosen.has(i));
  return (
    <>
      <ul className="findings" aria-label="Findings">
        {findings.map((f, i) => (
          <FindingItem key={`${f.rule}.${f.object}`} finding={f} chosen={!unchosen.has(i)} onToggle={toggle(i)} />
        ))}
      </ul>
      <div className="dialog-buttons">
        <button
          type="button"
          disabled={chosen.length === 0}
          onClick={() => {
            onOpen(chosen.map((f) => f.fix).join("\n\n"));
          }}
        >
          Open Fixes in Worksheet
        </button>
      </div>
    </>
  );
}

/** The schema's indexes, each with its table, method, columns, options, the constraint it serves, and what it counts. */
function Indexes({ analysis }: { readonly analysis: Analysis }) {
  if (analysis.indexes.length === 0) {
    return <p className="hint">No table of the schema has an index.</p>;
  }
  return (
    <table className="details-table" aria-label="Indexes">
      <thead>
        <tr>
          <th>Table</th>
          <th>Index</th>
          <th>Method</th>
          <th>Unique</th>
          <th>Columns</th>
          <th>Options</th>
          <th>Serves</th>
          <th>Distinct keys</th>
          <th>Selectivity</th>
        </tr>
      </thead>
      <tbody>
        {analysis.indexes.map((r) => (
          <tr key={r.index.name}>
            <td>{r.table}</td>
            <td>{r.index.name}</td>
            <td>{r.index.method}</td>
            <td>{r.index.unique ? "yes" : "no"}</td>
            <td>{r.index.columns.join(", ")}</td>
            <td>{r.index.options.map(([k, v]) => `${k} = ${v}`).join(", ")}</td>
            <td>{r.serves ?? ""}</td>
            <td>{r.counted?.distinctKeys ?? ""}</td>
            <td>{selectivity(r.counted)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The settings that differ from their defaults. */
function Settings({ analysis }: { readonly analysis: Analysis }) {
  if (analysis.settings.length === 0) {
    return <p className="hint">Every setting has its default.</p>;
  }
  return (
    <table className="details-table" aria-label="Settings">
      <thead>
        <tr>
          <th>Setting</th>
          <th>Value</th>
          <th>Default</th>
          <th>From</th>
          <th>Takes effect</th>
        </tr>
      </thead>
      <tbody>
        {analysis.settings.map((s) => (
          <tr key={s.name} title={s.description}>
            <td>{s.name}</td>
            <td>{s.value}</td>
            <td>{s.default}</td>
            <td>{s.source}</td>
            <td>{s.takesEffect}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** `analysis` of table `table` alone, where one is given: its findings, those of its indexes, and its indexes. */
export function ofTable(analysis: Analysis, table: string | undefined, name: (n: string) => string): Analysis {
  if (table === undefined) {
    return analysis;
  }
  const indexes = analysis.indexes.filter((r) => r.table === table);
  const names = new Set(indexes.map((r) => name(r.index.name)));
  const findings = analysis.findings.filter(
    (f) => f.object.split(" ")[0]?.endsWith(`.${name(table)}`) === true || names.has(f.object),
  );
  return { ...analysis, indexes, findings };
}

/** The tab `tab` of the analysis `found`: read, or why not, or reading. */
function AnalyzerBody(props: {
  readonly found: Analysis | string | null;
  readonly tab: Tab;
  readonly onOpen: (sql: string) => void;
  readonly of: { readonly connection: number; readonly schema: string };
}) {
  const { found, tab } = props;
  switch (tab) {
    case "statements":
      return <TopStatements connection={props.of.connection} />;
    case "usage":
      return <Usage connection={props.of.connection} schema={props.of.schema} />;
    default:
      break;
  }
  if (found === null) {
    return <p className="hint">Reading the schema…</p>;
  }
  if (typeof found === "string") {
    return <p className="error">{found}</p>;
  }
  switch (tab) {
    case "findings":
      return <Findings findings={found.findings} onOpen={props.onOpen} />;
    case "indexes":
      return <Indexes analysis={found} />;
    case "settings":
      return <Settings analysis={found} />;
  }
}

/** Shares the findings of `found`, titled `title`, of `connection`, in the Live Session hosted. */
function ShareFindings(props: {
  readonly connection: number;
  readonly title: string;
  readonly found: Analysis | string | null;
}) {
  const store = useStore();
  const hosting = useStudio((s) => s.live.status.hosted !== null);
  const found = props.found;
  if (!hosting || typeof found !== "object" || found === null) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={() => {
        changeLive(store, (l) => ({
          ...l,
          findings: { title: props.title, connection: props.connection, findings: found.findings },
        }));
      }}
    >
      Share in Live Session
    </button>
  );
}

/** The analyzer of `schema` on `connection`, or of its table `table`, its tab `tab` shown first. */
export function AnalyzerDialog(props: {
  readonly connection: number;
  readonly schema: string;
  readonly table?: string;
  readonly tab?: Tab;
}) {
  const { connection, schema, table } = props;
  const store = useStore();
  const read = useAnalysis(connection, schema);
  const reserved = useStudio((s) => s.reservedWords);
  const found = typeof read === "object" && read !== null ? ofTable(read, table, namer(reserved)) : read;
  const [tab, setTab] = useState<Tab>(props.tab ?? "findings");
  const close = () => {
    show(store, null);
  };
  const open = (sql: string) => void openDdl(store, connection, { sql, title: `Fixes of ${schema}` }, false);
  const of = table === undefined ? schema : `${schema}.${table}`;
  return (
    <Modal title={`Analyze ${table === undefined ? "Schema" : "Table"} ${of}`} onClose={close} wide>
      <div role="tablist" className="tabs">
        {TABS.map(([t, name]) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <AnalyzerBody found={found} tab={tab} onOpen={open} of={{ connection, schema }} />
      <div className="dialog-buttons">
        <ShareFindings connection={connection} title={`Findings of ${of}`} found={found} />
        <button type="button" onClick={close}>
          Close
        </button>
      </div>
    </Modal>
  );
}
