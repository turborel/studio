/**
 * Live Sessions' dialogs (RULES.md D56, D66): Join, of an invitation's
 * code or link, a link opened shown for what it holds;
 * and the settings, on one page: on or off, the name others see, what
 * each environment shares, rows and masked columns, copying and Suggest,
 * viewers and invitations, how a presenter is reached, and the lock; and
 * the log, viewed and cleared.
 */
import { useEffect, useState } from "react";
import type { EnvironmentName, LinkOpened, LinkView, LiveEntry, LiveSettings } from "../ipc/live";
import { clearLiveAudit, liveAudit, liveSettings, saveLiveSettings } from "../ipc/live";
import { show } from "../state/actions";
import { useStore } from "../state/store";
import { Modal } from "../shell/Modal";
import { entries } from "../assistant/AssistantSettings";
import { join, said } from "./live";

/** What an invitation's link holds, shown before Join: the session, the presenter's fingerprint, where it is reached, and until when. */
function LinkHolds({ link }: { readonly link: LinkView }) {
  return (
    <section aria-label="What the link holds">
      <p>The link holds an invitation, and nothing else:</p>
      <dl>
        <dt>Session</dt>
        <dd>
          <code>{link.session}</code>
        </dd>
        <dt>The presenter's fingerprint</dt>
        <dd>
          <code>{link.fingerprint}</code>
        </dd>
        <dt>Reached at</dt>
        <dd>{[...link.direct, ...(link.relay === null ? [] : [`relay ${link.relay}`])].join(", ")}</dd>
        <dt>Until</dt>
        <dd>{new Date(link.expires * 1000).toLocaleTimeString()}</dd>
      </dl>
      <p className="hint">
        Nothing joins until you press Join; the presenter then admits you, and you compare the safety code.
      </p>
    </section>
  );
}

/** The Join dialog: an invitation's code or link, pasted, or a link the platform opened Studio by, shown. */
export function JoinDialog({ opened }: { readonly opened?: LinkOpened | null | undefined }) {
  const store = useStore();
  const [code, setCode] = useState(opened?.kind === "invitation" ? opened.link.link : "");
  const [told, setTold] = useState(opened?.kind === "refused" ? `The link is refused: ${opened.why}.` : "");
  const close = () => {
    show(store, null);
  };
  return (
    <Modal title="Join a Live Session" onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTold("Reaching the presenter…");
          void join(store, code).then((joined) => {
            if (joined) {
              close();
            } else {
              setTold(store.current().live.told ?? "");
            }
          });
        }}
      >
        {opened?.kind === "invitation" && <LinkHolds link={opened.link} />}
        <label className="field">
          <span>Invitation</span>
          <textarea
            aria-label="Invitation"
            value={code}
            rows={4}
            onChange={(e) => {
              setCode(e.target.value);
            }}
          />
        </label>
        {told !== "" && <p role="status">{told}</p>}
        <div className="dialog-buttons">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" disabled={code.trim() === ""}>
            Join
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** A box ticked or not. */
function Tick(props: { readonly label: string; readonly checked: boolean; readonly onChange: (on: boolean) => void }) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => {
          props.onChange(e.target.checked);
        }}
      />
      <span>{props.label}</span>
    </label>
  );
}

/** A field of text or a number. */
function Field(props: {
  readonly label: string;
  readonly value: string | number;
  readonly onChange: (v: string) => void;
  readonly number?: boolean;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type={props.number === true ? "number" : "text"}
        value={props.value}
        onChange={(e) => {
          props.onChange(e.target.value);
        }}
      />
    </label>
  );
}

/** The environments, each with its name. */
const ENVIRONMENTS: readonly (readonly [EnvironmentName, string])[] = [
  ["development", "Development"],
  ["test", "Test"],
  ["production", "Production"],
];

/** What each environment shares. */
function EnvironmentsPart({ s, set }: { readonly s: LiveSettings; readonly set: (s: LiveSettings) => void }) {
  return (
    <fieldset>
      <legend>What each environment shares</legend>
      {ENVIRONMENTS.map(([env, name]) => {
        const sharing = s.environments[env];
        const put = (share: boolean, values: boolean) => {
          set({ ...s, environments: { ...s.environments, [env]: { share, values } } });
        };
        return (
          <div key={env} className="live-env">
            <Tick
              label={`${name}: share its tabs`}
              checked={sharing.share}
              onChange={(on) => {
                put(on, sharing.values);
              }}
            />
            <Tick
              label="and its values"
              checked={sharing.values}
              onChange={(on) => {
                put(sharing.share, on);
              }}
            />
          </div>
        );
      })}
    </fieldset>
  );
}

/** The relay's part of how a presenter is reached. */
function RelayPart({
  s,
  put,
}: {
  readonly s: LiveSettings;
  readonly put: (c: Partial<LiveSettings["connectivity"]>) => void;
}) {
  const c = s.connectivity;
  return (
    <>
      <Tick
        label="Through a relay"
        checked={c.relay}
        onChange={(relay) => {
          put({ relay });
        }}
      />
      <Field
        label="Relay's address"
        value={c.relayAddress}
        onChange={(relayAddress) => {
          put({ relayAddress });
        }}
      />
      <Field
        label="Relay's fingerprint"
        value={c.relayFingerprint}
        onChange={(relayFingerprint) => {
          put({ relayFingerprint });
        }}
      />
    </>
  );
}

/** How a presenter is reached. */
function ConnectivityPart({ s, set }: { readonly s: LiveSettings; readonly set: (s: LiveSettings) => void }) {
  const c = s.connectivity;
  const put = (change: Partial<LiveSettings["connectivity"]>) => {
    set({ ...s, connectivity: { ...c, ...change } });
  };
  return (
    <fieldset>
      <legend>How viewers reach you</legend>
      <Tick
        label="Directly, on this network or by address"
        checked={c.direct}
        onChange={(direct) => {
          put({ direct });
        }}
      />
      <Field
        label="UDP port (0 for any)"
        number
        value={c.port}
        onChange={(v) => {
          put({ port: Number(v) });
        }}
      />
      <Field
        label="Addresses to name (this machine's found, if none)"
        value={c.advertise.join(" ")}
        onChange={(v) => {
          put({ advertise: v.split(/\s+/).filter((a) => a !== "") });
        }}
      />
      <RelayPart s={s} put={put} />
    </fieldset>
  );
}

/** What viewers may do, and how many. */
function AllowedPart({ s, set }: { readonly s: LiveSettings; readonly set: (s: LiveSettings) => void }) {
  return (
    <>
      <Tick
        label="Viewers may copy text out"
        checked={s.allowCopy}
        onChange={(allowCopy) => {
          set({ ...s, allowCopy });
        }}
      />
      <Tick
        label="A viewer may be let suggest SQL"
        checked={s.allowSuggest}
        onChange={(allowSuggest) => {
          set({ ...s, allowSuggest });
        }}
      />
      <Field
        label="Viewers at most"
        number
        value={s.maxViewers}
        onChange={(v) => {
          set({ ...s, maxViewers: Number(v) });
        }}
      />
      <Field
        label="Minutes an invitation lasts"
        number
        value={s.inviteMinutes}
        onChange={(v) => {
          set({ ...s, inviteMinutes: Number(v) });
        }}
      />
      <Tick
        label="Lock: a session may not widen these"
        checked={s.locked}
        onChange={(locked) => {
          set({ ...s, locked });
        }}
      />
    </>
  );
}

/** What sessions share and allow. */
function SharingPart({ s, set }: { readonly s: LiveSettings; readonly set: (s: LiveSettings) => void }) {
  return (
    <fieldset>
      <legend>Sharing</legend>
      <Field
        label="Rows of a result shared"
        number
        value={s.rowLimit}
        onChange={(v) => {
          set({ ...s, rowLimit: Number(v) });
        }}
      />
      <label className="field">
        <span>Masked columns, a name a line</span>
        <textarea
          value={s.maskedColumns.join("\n")}
          onChange={(e) => {
            set({ ...s, maskedColumns: entries(e.target.value) });
          }}
        />
      </label>
      <AllowedPart s={s} set={set} />
    </fieldset>
  );
}

/** The log of Live Sessions. */
function LogPart() {
  const [log, setLog] = useState<readonly LiveEntry[] | null>(null);
  return (
    <fieldset>
      <legend>The log</legend>
      <div className="dialog-buttons">
        <button
          type="button"
          onClick={() =>
            void liveAudit().then(setLog, () => {
              setLog([]);
            })
          }
        >
          Show the Log
        </button>
        <button
          type="button"
          onClick={() =>
            void clearLiveAudit().then(() => {
              setLog([]);
            })
          }
        >
          Clear the Log
        </button>
      </div>
      {log?.length === 0 && <p className="hint">Nothing is logged.</p>}
      {log !== null && log.length > 0 && (
        <ul className="live-log" aria-label="Live Sessions' log">
          {log.map((e, i) => (
            <li key={`${String(e.time)}.${String(i)}`}>
              {new Date(e.time * 1000).toLocaleString()}: {e.what}
              {e.who !== null && ` · ${e.who}`}
              {e.detail !== null && ` · ${e.detail}`}
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/** The settings as read, and what reading them told. */
function useSettings(): [LiveSettings | null, (s: LiveSettings) => void, string, (t: string) => void] {
  const [s, set] = useState<LiveSettings | null>(null);
  const [told, setTold] = useState("");
  useEffect(() => {
    let current = true;
    void liveSettings().then(
      (read) => {
        if (current) {
          set(read);
        }
      },
      (thrown: unknown) => {
        setTold(said(thrown));
      },
    );
    return () => {
      current = false;
    };
  }, []);
  return [s, set, told, setTold];
}

/** Live Sessions' settings page. */
export function LiveSettingsDialog() {
  const store = useStore();
  const [s, set, told, setTold] = useSettings();
  const close = () => {
    show(store, null);
  };
  const save = () =>
    s !== null &&
    void saveLiveSettings(s).then(close, (thrown: unknown) => {
      setTold(said(thrown));
    });
  return (
    <Modal title="Live Sessions Settings" onClose={close} wide>
      {s === null ? (
        <p className="hint">Reading the settings…</p>
      ) : (
        <>
          <Tick
            label="Live Sessions are on"
            checked={s.enabled}
            onChange={(enabled) => {
              set({ ...s, enabled });
            }}
          />
          <Field
            label="Your name, as others see it"
            value={s.name}
            onChange={(name) => {
              set({ ...s, name });
            }}
          />
          <EnvironmentsPart s={s} set={set} />
          <SharingPart s={s} set={set} />
          <ConnectivityPart s={s} set={set} />
        </>
      )}
      <LogPart />
      {told !== "" && <p role="status">{told}</p>}
      <div className="dialog-buttons">
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button type="button" disabled={s === null} onClick={save}>
          Save
        </button>
      </div>
    </Modal>
  );
}
