/**
 * The Live Session panel (RULES.md D56): for the presenter, the session's
 * invitation, the guests asking to be admitted with their safety codes,
 * the participants with their hands, grants and roles, the tabs shared,
 * the session's choices, the suggestions made, and the end; for a viewer,
 * the safety code while it waits, its hand, and the workspace shown.
 */
import { useState } from "react";
import type { HostedView, Participant, SessionChoices } from "../ipc/live";
import { liveChoose } from "../ipc/live";
import { show } from "../state/actions";
import { useStore, useStudio } from "../state/store";
import { Icon } from "../icons/Icon";
import {
  answer,
  changeLive,
  dropSuggestion,
  endSession,
  grant,
  handOver,
  invite,
  leave,
  present,
  raiseHand,
  remove,
  said,
  takeSuggestion,
  toggleShared,
} from "./live";
import { SharedView } from "./SharedView";
import "./live.css";

/** The invitation, to be copied and sent. */
function Invitation() {
  const store = useStore();
  const made = useStudio((s) => s.live.invite);
  return (
    <section aria-label="Invitation">
      <button type="button" onClick={() => void invite(store)}>
        <Icon name="present" /> New Invitation
      </button>
      {made !== null && (
        <div className="live-invite">
          <textarea aria-label="Invitation code" readOnly value={made.code} rows={3} />
          <p className="hint">
            For one person, until {new Date(made.expires * 1000).toLocaleTimeString()}. Send it as you send any text; it
            holds no password.
          </p>
          <button type="button" onClick={() => void navigator.clipboard.writeText(made.code)}>
            Copy Invitation
          </button>
        </div>
      )}
    </section>
  );
}

/** The guests asking to be admitted, each with its safety code. */
function Asking() {
  const store = useStore();
  const asking = useStudio((s) => s.live.asking);
  if (asking.length === 0) {
    return null;
  }
  return (
    <section aria-label="Asking to join">
      {asking.map((a) => (
        <div key={a.id} className="live-asking">
          <p>
            <strong>{a.name}</strong> asks to join. Safety code <code>{a.code}</code>: admit only if theirs is the same.
          </p>
          <div className="dialog-buttons">
            <button type="button" onClick={() => void answer(store, a.id, false)}>
              Refuse
            </button>
            <button type="button" onClick={() => void answer(store, a.id, true)}>
              Admit
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

/** A participant's row: its name, hand, role and grants, and the presenter's acts on it. */
function ParticipantRow({ p }: { readonly p: Participant }) {
  const store = useStore();
  return (
    <li className="live-participant">
      <span>
        {p.name}
        {p.hand && <span aria-label="hand raised"> ✋</span>}
        {p.role === "presenter" && <span className="hint"> · presenting</span>}
      </span>
      <label className="check">
        <input type="checkbox" checked={p.grants.suggest} onChange={(e) => void grant(store, p.id, e.target.checked)} />
        <span>May suggest</span>
      </label>
      {p.role === "presenter" ? (
        <button type="button" onClick={() => void handOver(store, null)}>
          Take Back
        </button>
      ) : (
        <button type="button" onClick={() => void handOver(store, p.id)}>
          Make Presenter
        </button>
      )}
      <button type="button" className="danger" onClick={() => void remove(store, p.id)}>
        Remove
      </button>
    </li>
  );
}

/** The tabs open, each shared or not. */
function SharedTabs() {
  const store = useStore();
  const worksheets = useStudio((s) => s.worksheets);
  const models = useStudio((s) => s.models);
  const shared = useStudio((s) => s.live.shared);
  const findings = useStudio((s) => s.live.findings);
  const tabs = [
    ...worksheets.map((w) => ({ id: w.id, title: w.title })),
    ...models.map((m) => ({ id: m.id, title: m.model.name })),
  ];
  return (
    <fieldset>
      <legend>Shared tabs</legend>
      {tabs.length === 0 && <p className="hint">Open a worksheet or a model to share it.</p>}
      {tabs.map((t) => (
        <label key={t.id} className="check">
          <input
            type="checkbox"
            checked={shared.includes(t.id)}
            onChange={() => {
              toggleShared(store, t.id);
            }}
          />
          <span>{t.title}</span>
        </label>
      ))}
      {findings !== null && (
        <label className="check">
          <input
            type="checkbox"
            checked
            onChange={() => {
              changeLive(store, (l) => ({ ...l, findings: null }));
            }}
          />
          <span>{findings.title}</span>
        </label>
      )}
    </fieldset>
  );
}

/** The session's choices, within the settings where they are locked. */
function Choices({ choices }: { readonly choices: SessionChoices }) {
  const store = useStore();
  const [rows, setRows] = useState(String(choices.rowLimit));
  const choose = (next: SessionChoices) =>
    void liveChoose(next).then(
      () => undefined,
      (thrown: unknown) => {
        changeLive(store, (l) => ({ ...l, told: said(thrown) }));
      },
    );
  return (
    <fieldset>
      <legend>This session</legend>
      <label className="field">
        <span>Rows of a result shared</span>
        <input
          type="number"
          value={rows}
          onChange={(e) => {
            setRows(e.target.value);
          }}
          onBlur={() => {
            choose({ ...choices, rowLimit: Number(rows) });
          }}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={choices.copy}
          onChange={(e) => {
            choose({ ...choices, copy: e.target.checked });
          }}
        />
        <span>Viewers may copy</span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={choices.productionValues}
          onChange={(e) => {
            choose({ ...choices, productionValues: e.target.checked });
          }}
        />
        <span>Share production&apos;s values</span>
      </label>
    </fieldset>
  );
}

/** The suggestions viewers made, each taken into a worksheet or let go. */
function Suggestions() {
  const store = useStore();
  const suggestions = useStudio((s) => s.live.suggestions);
  if (suggestions.length === 0) {
    return null;
  }
  return (
    <section aria-label="Suggestions">
      {suggestions.map((s) => (
        <div key={`${String(s.at)}.${String(s.id)}`} className="live-suggestion">
          <p>{s.name} suggests:</p>
          <pre className="definition-text">{s.sql}</pre>
          <div className="dialog-buttons">
            <button
              type="button"
              onClick={() => {
                dropSuggestion(store, s);
              }}
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => {
                takeSuggestion(store, s);
              }}
            >
              Open in Worksheet
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

/** The presenter's side of the session hosted. */
function Hosting({ hosted }: { readonly hosted: HostedView }) {
  const store = useStore();
  return (
    <>
      <p className="hint">
        Session {hosted.session.slice(0, 8)}, certificate {hosted.fingerprint.slice(0, 23)}…, reached
        {hosted.direct.length > 0 && ` at ${hosted.direct.join(", ")}`}
        {hosted.relay !== null && ` through ${hosted.relay}`}.
      </p>
      <Invitation />
      <Asking />
      <section aria-label="Participants">
        {hosted.participants.length === 0 ? <p className="hint">No one has joined yet.</p> : null}
        <ul className="live-participants">
          {hosted.participants.map((p) => (
            <ParticipantRow key={p.id} p={p} />
          ))}
        </ul>
      </section>
      <SharedTabs />
      <Choices key={JSON.stringify(hosted.choices)} choices={hosted.choices} />
      <Suggestions />
      {hosted.presenter !== null && <SharedView canSuggest={false} />}
      <button type="button" className="danger" onClick={() => void endSession(store)}>
        End Session
      </button>
    </>
  );
}

/** The viewer's side of the session joined. */
function Joined() {
  const store = useStore();
  const joined = useStudio((s) => s.live.status.joined);
  const waiting = useStudio((s) => s.live.waiting);
  const hand = useStudio((s) => s.live.hand);
  if (joined === null) {
    return null;
  }
  return (
    <>
      {waiting !== null && (
        <p>
          Waiting to be admitted. Safety code <code>{waiting}</code>: the presenter sees the same.
        </p>
      )}
      <div className="dialog-buttons">
        <button type="button" aria-pressed={hand} onClick={() => void raiseHand(store, !hand)}>
          {hand ? "Lower Hand" : "Raise Hand"}
        </button>
        <button type="button" onClick={() => void leave(store)}>
          Leave
        </button>
      </div>
      {joined.role === "presenter" ? (
        <>
          <p className="hint">You present: the tabs you share are shown.</p>
          <SharedTabs />
        </>
      ) : (
        waiting === null && <SharedView canSuggest={joined.grants.suggest} />
      )}
    </>
  );
}

/** Neither hosting nor joined: Present and Join. */
function Idle() {
  const store = useStore();
  return (
    <>
      <p className="hint">
        Present shares the tabs you pick, live, with those you invite; Join watches a session you are invited to.
        Nothing is copied and pasted, and no one but you reaches your connections.
      </p>
      <div className="dialog-buttons">
        <button type="button" onClick={() => void present(store)}>
          <Icon name="present" /> Present
        </button>
        <button
          type="button"
          onClick={() => {
            show(store, { kind: "liveJoin" });
          }}
        >
          <Icon name="joinSession" /> Join…
        </button>
      </div>
    </>
  );
}

/** The Live Session panel. */
export function LivePanel() {
  const store = useStore();
  const status = useStudio((s) => s.live.status);
  const told = useStudio((s) => s.live.told);
  return (
    <div className="panel live-panel" role="region" aria-label="Live Session">
      <div className="assistant-head">
        <button
          type="button"
          className="tool"
          onClick={() => {
            show(store, { kind: "liveSettings" });
          }}
        >
          <Icon name="settings" /> Live Sessions Settings…
        </button>
      </div>
      {told !== null && <p role="status">{told}</p>}
      {status.hosted !== null ? <Hosting hosted={status.hosted} /> : status.joined !== null ? <Joined /> : <Idle />}
    </div>
  );
}
