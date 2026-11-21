/**
 * The assistant's panel (RULES.md D55): the conversation, each turn's
 * text, tool calls and drafts as they come; the questions waiting for the
 * user, a request to send shown whole first and a query to run with its
 * class and objects; and the question asked, with what the user ticks to
 * send. A draft blocked for the assistant is marked in the colour of
 * danger, with the rule that holds it.
 */
import { useEffect, useState } from "react";
import { assistantSettings, type Question, type SettingsView, type Verdict } from "../ipc/assistant";
import { show } from "../state/actions";
import { useStore, useStudio } from "../state/store";
import { Icon } from "../icons/Icon";
import "./assistant.css";
import { answer, ask, type ChatItem, type Include, openDraft, startOver } from "./chat";

/** What a verdict says of a statement: its class, objects, whether it is blocked, and EXPLAIN's estimate. */
function VerdictLine({ verdict, estimate }: { readonly verdict: Verdict; readonly estimate: string | null }) {
  const floor = verdict.statements.find((s) => s.floor !== null)?.floor ?? null;
  const destroys = verdict.statements.find((s) => s.destroys !== null)?.destroys ?? null;
  return (
    <p className={verdict.blocked || destroys !== null ? "assistant-verdict assistant-danger" : "assistant-verdict"}>
      Class {verdict.class}
      {verdict.objects.length > 0 && ` · of ${verdict.objects.slice(0, 8).join(", ")}`}
      {destroys !== null && ` · destroys: ${destroys}`}
      {verdict.blocked &&
        ` · blocked for the assistant${floor === null ? ", as it is not known what it does" : `: ${floor}`}`}
      {verdict.rule !== null && ` · stopped by ${verdict.rule}: ${verdict.why ?? ""}`}
      <br />
      {estimate === null ? "No estimate: EXPLAIN plans a query alone." : `EXPLAIN estimates: ${estimate}`}
    </p>
  );
}

/** An item of the conversation. */
function Item({ item }: { readonly item: ChatItem }) {
  const store = useStore();
  switch (item.kind) {
    case "user":
      return (
        <li className="assistant-user">
          <p>{item.text}</p>
          <p className="hint">Sent: {item.sent.join(", ")}</p>
        </li>
      );
    case "assistant":
      return <li className="assistant-reply">{item.text}</li>;
    case "tool":
      return (
        <li className={item.outcome.startsWith("blocked") ? "assistant-tool assistant-danger" : "assistant-tool"}>
          <Icon name="tool" /> {item.name}: {item.outcome}
        </li>
      );
    case "draft":
      return (
        <li className="assistant-draft">
          <strong>{item.title}</strong>
          <p>{item.why}</p>
          <pre className="definition-text">{item.sql}</pre>
          <VerdictLine verdict={item.verdict} estimate={item.estimate} />
          <button type="button" onClick={() => openDraft(store, item)}>
            Open in Worksheet
          </button>
        </li>
      );
    case "refused":
      return (
        <li className="assistant-danger">
          The model declined{item.category === null ? "" : ` (${item.category})`}
          {item.explanation === null ? "." : `: ${item.explanation}`}
        </li>
      );
    case "ended":
      return item.stop.kind === "endTurn" ? (
        <li className="hint">
          {String(item.usage.input)} tokens in, {String(item.usage.output)} out
          {item.usage.cacheRead > 0 && `, ${String(item.usage.cacheRead)} of the cache`}
        </li>
      ) : (
        <li className="hint">Stopped: {item.stop.kind === "other" ? item.stop.reason : item.stop.kind}</li>
      );
    case "error":
      return <li className="assistant-danger">{item.message}</li>;
  }
}

/** A question waiting for the user. */
function QuestionCard({ id, question }: { readonly id: number; readonly question: Question }) {
  const store = useStore();
  const yes = question.kind === "send" ? "Send" : "Run";
  return (
    <div
      className="assistant-question"
      role="group"
      aria-label={question.kind === "send" ? "What will be sent" : "Run the query?"}
    >
      {question.kind === "send" ? (
        <>
          <p>What will be sent, no key among it:</p>
          <pre className="definition-text assistant-body">{question.body}</pre>
        </>
      ) : (
        <>
          <p>
            The assistant asks to run this query, READ ONLY, and to be told its rows, up to the connection&apos;s limit:{" "}
            {question.purpose}
          </p>
          <pre className="definition-text">{question.sql}</pre>
          <VerdictLine verdict={question.verdict} estimate={question.estimate} />
        </>
      )}
      <div className="dialog-buttons">
        <button type="button" onClick={() => void answer(store, id, false)}>
          Don&apos;t {yes}
        </button>
        <button type="button" onClick={() => void answer(store, id, true)}>
          {yes}
        </button>
      </div>
    </div>
  );
}

/** The boxes ticked of what to send with the question. */
function Ticks({ include, onInclude }: { readonly include: Include; readonly onInclude: (i: Include) => void }) {
  const ticks: readonly (readonly [keyof Include, string])[] = [
    ["sql", "Send the worksheet's SQL"],
    ["plan", "Send its plan"],
    ["rows", "Include its result's first rows"],
  ];
  return (
    <div className="assistant-ticks">
      {ticks.map(([key, label]) => (
        <label key={key} className="check">
          <input
            type="checkbox"
            checked={include[key]}
            onChange={(e) => {
              onInclude({ ...include, [key]: e.target.checked });
            }}
          />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

/** The question being written, and what is ticked to send with it. */
function Composer() {
  const store = useStore();
  const busy = useStudio((s) => s.chat.busy);
  const [text, setText] = useState("");
  const [include, setInclude] = useState<Include>({ sql: true, plan: false, rows: false });
  return (
    <form
      className="assistant-composer"
      onSubmit={(e) => {
        e.preventDefault();
        const question = text.trim();
        setText("");
        void ask(store, question, include);
      }}
    >
      <textarea
        aria-label="Ask the assistant"
        value={text}
        placeholder="Ask about the schema, a query or its plan"
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      <Ticks include={include} onInclude={setInclude} />
      <div className="dialog-buttons">
        <button type="button" onClick={() => void startOver(store)}>
          New Conversation
        </button>
        <button type="submit" disabled={busy || text.trim() === ""}>
          Ask
        </button>
      </div>
    </form>
  );
}

/** What the settings say of the assistant: off, or of a model that calls no tools. */
export function standing(view: SettingsView | null): string | null {
  if (view?.settings.enabled !== true) {
    return "The assistant is off until it is turned on in its settings.";
  }
  if (view.settings.provider === "own" && !view.settings.own.tools) {
    return "This model calls no tools: it answers questions alone, and reads, explains and drafts nothing.";
  }
  return null;
}

/** The line of what the settings say, read as the panel opens and as its dialog closes. */
function Standing() {
  const dialog = useStudio((s) => s.dialog);
  const [view, setView] = useState<SettingsView | null>(null);
  useEffect(() => {
    let current = true;
    if (dialog === null) {
      void assistantSettings().then(
        (v) => {
          if (current) {
            setView(v);
          }
        },
        () => undefined,
      );
    }
    return () => {
      current = false;
    };
  }, [dialog]);
  const said = standing(view);
  return said === null ? null : <p className="hint">{said}</p>;
}

/** The assistant's panel. */
export function AssistantPanel() {
  const store = useStore();
  const items = useStudio((s) => s.chat.items);
  const questions = useStudio((s) => s.chat.questions);
  const busy = useStudio((s) => s.chat.busy);
  return (
    <div className="panel assistant-panel" role="region" aria-label="Assistant">
      <div className="assistant-head">
        <button
          type="button"
          className="tool"
          onClick={() => {
            show(store, { kind: "assistantSettings" });
          }}
        >
          <Icon name="settings" /> Assistant Settings…
        </button>
      </div>
      <Standing />
      <ul className="assistant-items" aria-label="Conversation">
        {items.map((item, i) => (
          <Item key={`${String(i)}.${item.kind}`} item={item} />
        ))}
      </ul>
      {busy && <p className="hint">Working…</p>}
      {questions.map((q) => (
        <QuestionCard key={q.id} id={q.id} question={q.question} />
      ))}
      <Composer />
    </div>
  );
}
