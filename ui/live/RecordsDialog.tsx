/**
 * Session Records (RULES.md D67): the records of sessions this Studio
 * presented, kept on this machine alone; one read back as a timeline to
 * step through and search, each moment's workspace shown as it was
 * shared, a query opened in a worksheet, a tab's plans compared between
 * two moments, and a summary for a ticket written of the moments picked,
 * previewed exactly as it is saved.
 */
import { useEffect, useState } from "react";
import { saveTextFile } from "../ipc/catalog";
import { liveRecords, type RecordEntry, type RecordInfo, type RecordRead, readLiveRecord } from "../ipc/live";
import { useStore } from "../state/store";
import { openWorksheet } from "../state/worksheets";
import { Modal } from "../shell/Modal";
import { said } from "./live";
import { TabContent } from "./SharedView";
import { comparedPlans, firstPicked, found, summary, type SummaryChoice } from "./summary";

/** `ms` as a time of day. */
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString();
}

/** `entry` as the timeline names it. */
export function entryLabel(entry: RecordEntry): string {
  switch (entry.kind) {
    case "shared":
      return `${clock(entry.at)} Shared${entry.by === null ? "" : ` by ${entry.by}`}: ${entry.state.tabs.map((t) => t.title).join(", ")}`;
    case "suggested":
      return `${clock(entry.at)} ${entry.by} suggested`;
    case "joined":
      return `${clock(entry.at)} ${entry.by} joined`;
    case "left":
      return `${clock(entry.at)} ${entry.by} left`;
    case "ended":
      return `${clock(entry.at)} The record ended`;
  }
}

/** The records kept, each opened by a click. */
function RecordList({ onOpen }: { readonly onOpen: (r: RecordInfo) => void }) {
  const [records, setRecords] = useState<readonly RecordInfo[] | null>(null);
  const [told, setTold] = useState("");
  useEffect(() => {
    liveRecords().then(setRecords, (thrown: unknown) => {
      setTold(said(thrown));
    });
  }, []);
  if (records === null) {
    return <p className="hint">{told === "" ? "Reading the records…" : told}</p>;
  }
  if (records.length === 0) {
    return <p className="hint">No session has been recorded on this machine.</p>;
  }
  return (
    <ul aria-label="Records">
      {records.map((r) => (
        <li key={r.path}>
          <button
            type="button"
            onClick={() => {
              onOpen(r);
            }}
          >
            {new Date(r.head.started).toLocaleString()}, presented by {r.head.presenter}
            {r.head.sealed ? ", sealed" : ""}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The timeline: the entries found, the one shown chosen. */
function Timeline(props: { readonly record: RecordRead; readonly at: number; readonly onAt: (at: number) => void }) {
  const [text, setText] = useState("");
  const shown = found(props.record, text);
  return (
    <section aria-label="Timeline">
      <input
        type="search"
        aria-label="Find in the record"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      <ol>
        {shown.map((i) => (
          <li key={i}>
            <button
              type="button"
              aria-current={i === props.at}
              onClick={() => {
                props.onAt(i);
              }}
            >
              {entryLabel(props.record.entries[i] ?? { kind: "ended", at: 0 })}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The choice of another moment shared to compare a tab's plan with. */
function CompareWith(props: {
  readonly record: RecordRead;
  readonly at: number;
  readonly against: number | null;
  readonly onAgainst: (a: number | null) => void;
}) {
  const others = props.record.entries.flatMap((e, i) => (e.kind === "shared" && i !== props.at ? [i] : []));
  return (
    <label>
      Compare the plan with{" "}
      <select
        value={props.against === null ? "" : String(props.against)}
        onChange={(e) => {
          props.onAgainst(e.target.value === "" ? null : Number(e.target.value));
        }}
      >
        <option value="">No other moment</option>
        {others.map((i) => (
          <option key={i} value={String(i)}>
            {entryLabel(props.record.entries[i] ?? { kind: "ended", at: 0 })}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A suggestion, opened in a worksheet if asked. */
function SuggestedMoment({ sql, by }: { readonly sql: string; readonly by: string }) {
  const store = useStore();
  return (
    <section aria-label="The moment">
      <pre>{sql}</pre>
      <button type="button" onClick={() => openWorksheet(store, sql, `Suggested by ${by}`)}>
        Open in Worksheet
      </button>
    </section>
  );
}

/** The tabs of a moment shared, one shown, its SQL opened in a worksheet if asked, its plan compared with another moment's. */
function Moment(props: { readonly record: RecordRead; readonly at: number }) {
  const store = useStore();
  const entry = props.record.entries[props.at];
  const [chosen, setChosen] = useState<string | null>(null);
  const [against, setAgainst] = useState<number | null>(null);
  if (entry?.kind === "suggested") {
    return <SuggestedMoment sql={entry.sql} by={entry.by} />;
  }
  if (entry?.kind !== "shared") {
    return (
      <section aria-label="The moment">
        <p className="hint">{entry === undefined ? "" : entryLabel(entry)}</p>
      </section>
    );
  }
  const tabs = entry.state.tabs;
  const tab = tabs.find((t) => t.id === chosen) ?? tabs.find((t) => t.id === entry.state.active) ?? tabs[0];
  return (
    <section aria-label="The moment">
      <div role="tablist" aria-label="Tabs shared">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab?.id}
            onClick={() => {
              setChosen(t.id);
            }}
          >
            {t.title}
          </button>
        ))}
      </div>
      {tab !== undefined && (
        <>
          <TabContent tab={tab} canSuggest={false} />
          {tab.kind === "worksheet" && (
            <button type="button" onClick={() => openWorksheet(store, tab.text, tab.title)}>
              Open in Worksheet
            </button>
          )}
          <CompareWith record={props.record} at={props.at} against={against} onAgainst={setAgainst} />
          {against !== null && <PlanComparison record={props.record} pair={[props.at, against]} tab={tab.id} />}
        </>
      )}
    </section>
  );
}

/** A tab's plan at two moments, line by line, the lines that differ marked. */
function PlanComparison(props: {
  readonly record: RecordRead;
  readonly pair: readonly [number, number];
  readonly tab: string;
}) {
  const lines = comparedPlans(props.record, props.pair, props.tab);
  return (
    <table aria-label="Plans compared">
      <thead>
        <tr>
          <th scope="col">This moment</th>
          <th scope="col">The other</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={String(i)} className={l.differs ? "differs" : undefined}>
            <td>
              <code>{l.before}</code>
            </td>
            <td>
              <code>{l.after}</code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The moments a summary may hold, each picked or not, and whether production's values go in. */
function Picks(props: {
  readonly record: RecordRead;
  readonly choice: SummaryChoice;
  readonly onChoice: (c: SummaryChoice) => void;
}) {
  const { choice, onChoice } = props;
  const pick = (i: number, on: boolean) => {
    const picked = new Set(choice.picked);
    if (on) {
      picked.add(i);
    } else {
      picked.delete(i);
    }
    onChoice({ ...choice, picked });
  };
  return (
    <fieldset>
      <legend>What goes in</legend>
      {props.record.entries.map((e, i) =>
        e.kind === "shared" || e.kind === "suggested" ? (
          <label key={i} className="check">
            <input
              type="checkbox"
              checked={choice.picked.has(i)}
              onChange={(ev) => {
                pick(i, ev.target.checked);
              }}
            />
            <span>{entryLabel(e)}</span>
          </label>
        ) : null,
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={choice.productionValues}
          onChange={(e) => {
            onChoice({ ...choice, productionValues: e.target.checked });
          }}
        />
        <span>Production&apos;s result values</span>
      </label>
    </fieldset>
  );
}

/** The summary's conclusions and format. */
function Writing(props: { readonly choice: SummaryChoice; readonly onChoice: (c: SummaryChoice) => void }) {
  const { choice, onChoice } = props;
  return (
    <>
      <label className="field">
        <span>Conclusions</span>
        <textarea
          rows={3}
          value={choice.conclusions}
          onChange={(e) => {
            onChoice({ ...choice, conclusions: e.target.value });
          }}
        />
      </label>
      <label>
        Format{" "}
        <select
          value={choice.format}
          onChange={(e) => {
            onChoice({ ...choice, format: e.target.value === "html" ? "html" : "markdown" });
          }}
        >
          <option value="markdown">Markdown</option>
          <option value="html">HTML</option>
        </select>
      </label>
    </>
  );
}

/** The summary for a ticket: the moments picked, production's values, the conclusions, and its format; previewed, then saved. */
function Export({ record }: { readonly record: RecordRead }) {
  const [choice, setChoice] = useState<SummaryChoice>(() => ({
    picked: firstPicked(record),
    productionValues: false,
    conclusions: "",
    format: "markdown",
  }));
  const [told, setTold] = useState("");
  const text = summary(record, choice);
  const save = () => {
    const day = new Date(record.head.started).toISOString().slice(0, 10);
    saveTextFile(`live-session-${day}.${choice.format === "markdown" ? "md" : "html"}`, text).then(
      (path) => {
        setTold(path === null ? "" : `Saved as ${path}.`);
      },
      (thrown: unknown) => {
        setTold(said(thrown));
      },
    );
  };
  return (
    <section aria-label="Summary for a ticket">
      <Picks record={record} choice={choice} onChoice={setChoice} />
      <Writing choice={choice} onChoice={setChoice} />
      <pre aria-label="Summary preview">{text}</pre>
      <button type="button" onClick={save}>
        Save Summary…
      </button>
      {told !== "" && <p role="status">{told}</p>}
    </section>
  );
}

/** A record read back: its timeline, the moment shown, and its summary for a ticket. */
function Replay({ record }: { readonly record: RecordRead }) {
  const [at, setAt] = useState(0);
  const [exporting, setExporting] = useState(false);
  const last = record.entries.length - 1;
  return (
    <div className="live-replay">
      <p>
        Presented by {record.head.presenter}, begun {new Date(record.head.started).toLocaleString()}.{" "}
        <button
          type="button"
          disabled={at <= 0}
          onClick={() => {
            setAt(at - 1);
          }}
        >
          Previous
        </button>{" "}
        <button
          type="button"
          disabled={at >= last}
          onClick={() => {
            setAt(at + 1);
          }}
        >
          Next
        </button>{" "}
        <button
          type="button"
          onClick={() => {
            setExporting(!exporting);
          }}
        >
          {exporting ? "Back to the Record" : "Summary for a Ticket…"}
        </button>
      </p>
      {exporting ? (
        <Export record={record} />
      ) : (
        <>
          <Timeline record={record} at={at} onAt={setAt} />
          <Moment key={at} record={record} at={at} />
        </>
      )}
    </div>
  );
}

/** The dialog of the records of sessions kept on this machine. */
export function RecordsDialog() {
  const store = useStore();
  const [record, setRecord] = useState<RecordRead | null>(null);
  const [told, setTold] = useState("");
  const close = () => {
    store.update((now) => ({ ...now, dialog: null }));
  };
  const open = (r: RecordInfo) => {
    setTold("Reading the record…");
    readLiveRecord(r.path).then(
      (read) => {
        setRecord(read);
        setTold("");
      },
      (thrown: unknown) => {
        setTold(said(thrown));
      },
    );
  };
  return (
    <Modal title="Session Records" onClose={close} wide={true}>
      {record === null ? <RecordList onOpen={open} /> : <Replay record={record} />}
      {told !== "" && <p role="status">{told}</p>}
      <div className="dialog-buttons">
        {record !== null && (
          <button
            type="button"
            onClick={() => {
              setRecord(null);
            }}
          >
            All Records
          </button>
        )}
        <button type="button" onClick={close}>
          Close
        </button>
      </div>
    </Modal>
  );
}
