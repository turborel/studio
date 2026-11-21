/**
 * The assistant's settings page (RULES.md D55): whether it is on; its
 * model, Claude or the user's own, and its key, saved to the keychain and
 * never shown again; the active saved connection's policy, of its level,
 * lists, limits and login, exported and imported as a file; and the log,
 * viewed and cleared.
 */
import { useEffect, useState } from "react";
import {
  type AssistantSettings,
  assistantAudit,
  assistantPolicy,
  assistantSettings,
  type AuditEntry,
  clearAssistantAudit,
  type ConnectionPolicy,
  exportAssistantPolicy,
  importAssistantPolicy,
  type Level,
  saveAssistantPolicy,
  saveAssistantSettings,
  setAssistantKey,
  setAssistantLoginPassword,
  type SettingsView,
} from "../ipc/assistant";
import { isStudioError, show } from "../state/actions";
import { useStore, useStudio } from "../state/store";
import { Modal } from "../shell/Modal";

/** The failure's message of `thrown`. */
function said(thrown: unknown): string {
  return isStudioError(thrown) ? thrown.message : String(thrown);
}

/** A field of text, or of a password, or of a number. */
function Field(props: {
  readonly label: string;
  readonly value: string | number;
  readonly onChange: (value: string) => void;
  readonly type?: "password" | "number";
  readonly list?: string;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type={props.type ?? "text"}
        autoComplete="off"
        list={props.list}
        value={props.value}
        onChange={(e) => {
          props.onChange(e.target.value);
        }}
      />
    </label>
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

/** A choice of `options`, each its value and name. */
function Choice(props: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly (readonly [string, string])[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <select
        value={props.value}
        onChange={(e) => {
          props.onChange(e.target.value);
        }}
      >
        {props.options.map(([v, name]) => (
          <option key={v} value={v}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The key of the model chosen: saved or not, saved anew, or forgotten. */
function KeyPart(props: {
  readonly view: SettingsView;
  readonly settings: AssistantSettings;
  readonly onTold: (t: string) => void;
}) {
  const [key, setKey] = useState("");
  const [keys, setKeys] = useState(props.view.keys);
  const provider = props.settings.provider;
  const saveKey = (value: string | null) =>
    void setAssistantKey(provider, value).then(
      (now) => {
        setKeys(now);
        setKey("");
        props.onTold(value === null ? "The key is forgotten." : "The key is saved in the keychain.");
      },
      (thrown: unknown) => {
        props.onTold(said(thrown));
      },
    );
  return (
    <>
      <Field
        label={`Key (${(provider === "claude" ? keys.claude : keys.own) ? "saved" : "not saved"})`}
        type="password"
        value={key}
        onChange={setKey}
      />
      <div className="dialog-buttons">
        <button
          type="button"
          onClick={() => {
            saveKey(null);
          }}
        >
          Forget Key
        </button>
        <button
          type="button"
          disabled={key === ""}
          onClick={() => {
            saveKey(key);
          }}
        >
          Save Key
        </button>
      </div>
    </>
  );
}

/** The user's own model's fields. */
function OwnPart({
  settings,
  onSettings,
}: {
  readonly settings: AssistantSettings;
  readonly onSettings: (s: AssistantSettings) => void;
}) {
  const own = settings.own;
  const set = (change: Partial<AssistantSettings["own"]>) => {
    onSettings({ ...settings, own: { ...own, ...change } });
  };
  return (
    <>
      <Field
        label="Endpoint"
        value={own.baseUrl}
        onChange={(baseUrl) => {
          set({ baseUrl });
        }}
      />
      <Field
        label="Model"
        value={own.model}
        onChange={(model) => {
          set({ model });
        }}
      />
      <Choice
        label="Wire format"
        value={own.wire}
        options={[
          ["chatCompletions", "Chat completions"],
          ["anthropic", "Anthropic Messages"],
        ]}
        onChange={(w) => {
          set({ wire: w === "anthropic" ? "anthropic" : "chatCompletions" });
        }}
      />
      <Tick
        label="It calls tools (else it answers questions alone)"
        checked={own.tools}
        onChange={(tools) => {
          set({ tools });
        }}
      />
    </>
  );
}

/** Claude's model, chosen of those known or named. */
function ClaudePart(props: {
  readonly view: SettingsView;
  readonly settings: AssistantSettings;
  readonly onSettings: (s: AssistantSettings) => void;
}) {
  return (
    <>
      <Field
        label="Claude's model"
        list="claude-models"
        value={props.settings.claudeModel}
        onChange={(claudeModel) => {
          props.onSettings({ ...props.settings, claudeModel });
        }}
      />
      <datalist id="claude-models">
        {props.view.claudeModels.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </>
  );
}

/** The model's part: on, the provider, Claude's model or the user's own, and the key. */
function ModelPart(props: {
  readonly view: SettingsView;
  readonly settings: AssistantSettings;
  readonly onSettings: (s: AssistantSettings) => void;
  readonly onTold: (t: string) => void;
}) {
  const { view, settings, onSettings } = props;
  return (
    <fieldset>
      <legend>Model</legend>
      <Tick
        label="Turn the assistant on"
        checked={settings.enabled}
        onChange={(enabled) => {
          onSettings({ ...settings, enabled });
        }}
      />
      <Choice
        label="Model of"
        value={settings.provider}
        options={[
          ["claude", "Claude"],
          ["own", "My own model"],
        ]}
        onChange={(p) => {
          onSettings({ ...settings, provider: p === "own" ? "own" : "claude" });
        }}
      />
      {settings.provider === "claude" ? (
        <ClaudePart view={view} settings={settings} onSettings={onSettings} />
      ) : (
        <OwnPart settings={settings} onSettings={onSettings} />
      )}
      <KeyPart view={view} settings={settings} onTold={props.onTold} />
    </fieldset>
  );
}

/** The entries of `text`, a line each, blank lines left out. */
export function entries(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/** The levels, each with its name. */
const LEVELS: readonly (readonly [Level, string])[] = [
  ["off", "Nothing: off"],
  ["explainOnly", "Explain only"],
  ["read", "Read"],
  ["proposeChanges", "Propose changes"],
];

/** The policy's lists of objects. */
function ListsPart({
  policy,
  onPolicy,
}: {
  readonly policy: ConnectionPolicy;
  readonly onPolicy: (p: ConnectionPolicy) => void;
}) {
  const lists: readonly (readonly ["allowObjects" | "denyObjects" | "hidden", string])[] = [
    ["hidden", "Hidden schemas and tables, a line each"],
    ["denyObjects", "Denied schemas and tables"],
    ["allowObjects", "Allowed schemas and tables (all, if none)"],
  ];
  return (
    <>
      {lists.map(([key, label]) => (
        <label key={key} className="field">
          <span>{label}</span>
          <textarea
            value={policy[key].join("\n")}
            onChange={(e) => {
              onPolicy({ ...policy, [key]: entries(e.target.value) });
            }}
          />
        </label>
      ))}
    </>
  );
}

/** The policy's limits. */
function LimitsPart({
  policy,
  onPolicy,
}: {
  readonly policy: ConnectionPolicy;
  readonly onPolicy: (p: ConnectionPolicy) => void;
}) {
  const limits: readonly (readonly [keyof ConnectionPolicy["limits"], string])[] = [
    ["rows", "Rows returned to the model"],
    ["statementSeconds", "Seconds a query runs"],
    ["toolCalls", "Tool calls of a turn"],
    ["tokens", "Tokens of an answer"],
  ];
  return (
    <>
      {limits.map(([key, label]) => (
        <Field
          key={key}
          label={label}
          type="number"
          value={policy.limits[key]}
          onChange={(v) => {
            onPolicy({ ...policy, limits: { ...policy.limits, [key]: Number(v) } });
          }}
        />
      ))}
    </>
  );
}

/** The assistant's own login, and its password. */
function LoginPart(props: {
  readonly saved: string;
  readonly policy: ConnectionPolicy;
  readonly onPolicy: (p: ConnectionPolicy) => void;
  readonly onTold: (t: string) => void;
}) {
  const [password, setPassword] = useState("");
  const save = () =>
    void setAssistantLoginPassword(props.saved, password).then(
      () => {
        setPassword("");
        props.onTold("The login's password is saved in the keychain.");
      },
      (thrown: unknown) => {
        props.onTold(said(thrown));
      },
    );
  return (
    <>
      <Field
        label="The assistant's own login"
        value={props.policy.login ?? ""}
        onChange={(v) => {
          props.onPolicy({ ...props.policy, login: v === "" ? null : v });
        }}
      />
      <Field label="Its password" type="password" value={password} onChange={setPassword} />
      <button type="button" disabled={password === ""} onClick={save}>
        Save Password
      </button>
    </>
  );
}

/** The policy's part, of saved connection `saved`. */
function PolicyPart(props: {
  readonly saved: string;
  readonly policy: ConnectionPolicy;
  readonly onPolicy: (p: ConnectionPolicy) => void;
  readonly onTold: (t: string) => void;
}) {
  const { policy, onPolicy } = props;
  return (
    <fieldset>
      <legend>This connection&apos;s policy</legend>
      <Choice
        label="The assistant may"
        value={policy.level}
        options={LEVELS}
        onChange={(level) => {
          onPolicy({ ...policy, level: level as Level });
        }}
      />
      <Tick
        label="Show what will be sent before each request"
        checked={policy.preview}
        onChange={(preview) => {
          onPolicy({ ...policy, preview });
        }}
      />
      <Tick
        label="Replace SQL's literals by placeholders"
        checked={policy.redactLiterals}
        onChange={(redactLiterals) => {
          onPolicy({ ...policy, redactLiterals });
        }}
      />
      <ListsPart policy={policy} onPolicy={onPolicy} />
      <LimitsPart policy={policy} onPolicy={onPolicy} />
      <LoginPart {...props} />
    </fieldset>
  );
}

/** A row of the log. */
function AuditRow({ e }: { readonly e: AuditEntry }) {
  return (
    <tr>
      <td>{new Date(e.time * 1000).toLocaleString()}</td>
      <td>{e.model}</td>
      <td>{e.connection}</td>
      <td>{e.sent.join(", ")}</td>
      <td>{e.tools.map((t) => `${t.name}: ${t.outcome}`).join("; ")}</td>
      <td>{e.stop}</td>
      <td>{`${String(e.usage.input)} / ${String(e.usage.output)}`}</td>
    </tr>
  );
}

/** The log of what the assistant was asked and did. */
function AuditPart() {
  const [log, setLog] = useState<readonly AuditEntry[] | null>(null);
  return (
    <fieldset>
      <legend>The log</legend>
      <div className="dialog-buttons">
        <button
          type="button"
          onClick={() =>
            void assistantAudit().then(setLog, () => {
              setLog([]);
            })
          }
        >
          Show the Log
        </button>
        <button
          type="button"
          onClick={() =>
            void clearAssistantAudit().then(() => {
              setLog([]);
            })
          }
        >
          Clear the Log
        </button>
      </div>
      {log?.length === 0 && <p className="hint">Nothing is logged.</p>}
      {log !== null && log.length > 0 && (
        <table className="details-table" aria-label="The assistant's log">
          <thead>
            <tr>
              {["When", "Model", "Connection", "Sent", "Tools", "Stop", "Tokens"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {log.map((e, i) => (
              <AuditRow key={`${String(e.time)}.${String(i)}`} e={e} />
            ))}
          </tbody>
        </table>
      )}
    </fieldset>
  );
}

/** The settings, and the active saved connection's policy, as read. */
function useRead(saved: string | null) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [policy, setPolicy] = useState<ConnectionPolicy | null>(null);
  useEffect(() => {
    let current = true;
    void assistantSettings().then(
      (v) => {
        if (current) {
          setView(v);
        }
      },
      () => undefined,
    );
    if (saved !== null) {
      void assistantPolicy(saved).then(
        (p) => {
          if (current) {
            setPolicy(p);
          }
        },
        () => undefined,
      );
    }
    return () => {
      current = false;
    };
  }, [saved]);
  return { view, policy, setPolicy };
}

/** Export and Import of the policies. */
function PolicyFiles({ onTold }: { readonly onTold: (t: string) => void }) {
  const failed = (t: unknown) => {
    onTold(said(t));
  };
  return (
    <div className="dialog-buttons">
      <button
        type="button"
        onClick={() =>
          void exportAssistantPolicy().then((p) => {
            onTold(p === null ? "" : `Exported to ${p}.`);
          }, failed)
        }
      >
        Export Policies…
      </button>
      <button
        type="button"
        onClick={() =>
          void importAssistantPolicy().then((done) => {
            onTold(done ? "Imported: open the settings again to see them." : "");
          }, failed)
        }
      >
        Import Policies…
      </button>
    </div>
  );
}

/** The assistant's settings page. */
export function AssistantSettingsDialog() {
  const store = useStore();
  const saved = useStudio((s) => s.open.find((c) => c.id === s.active)?.savedId ?? null);
  const { view, policy, setPolicy } = useRead(saved);
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [told, setTold] = useState("");
  const close = () => {
    show(store, null);
  };
  const shown = settings ?? view?.settings;
  const save = async () => {
    try {
      if (shown !== undefined) {
        await saveAssistantSettings(shown);
      }
      if (saved !== null && policy !== null) {
        await saveAssistantPolicy(saved, policy);
      }
      close();
    } catch (thrown: unknown) {
      setTold(said(thrown));
    }
  };
  return (
    <Modal title="Assistant Settings" onClose={close} wide>
      {view === null || shown === undefined ? (
        <p className="hint">Reading the settings…</p>
      ) : (
        <ModelPart view={view} settings={shown} onSettings={setSettings} onTold={setTold} />
      )}
      {saved !== null && policy !== null ? (
        <PolicyPart saved={saved} policy={policy} onPolicy={setPolicy} onTold={setTold} />
      ) : (
        <p className="hint">Open a saved connection to set its policy.</p>
      )}
      <PolicyFiles onTold={setTold} />
      <AuditPart />
      {told !== "" && <p role="status">{told}</p>}
      <div className="dialog-buttons">
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button type="button" onClick={() => void save()}>
          Save
        </button>
      </div>
    </Modal>
  );
}
