/**
 * The connection dialog (RULES.md D26, D28, R-SEC-1): a connection's
 * settings, its environment, colour and guards; a password typed, kept in
 * the keychain only when asked, and never shown again. It connects,
 * saves, or both.
 */
import { type ReactNode, useState } from "react";
import type { ConnectionSpec, Environment } from "../ipc/connections";
import type { SavedConnection } from "../ipc/saved";
import { connectSaved, connectSpec, save, show } from "../state/actions";
import { useStore, useStudio } from "../state/store";
import {
  type ConnectionForm,
  formOf,
  invalid,
  passwordChangeOf,
  savedOf,
  type SpecField,
  specOf,
} from "./connectionForm";
import { ENVIRONMENT_NAMES } from "./environment";
import { Modal } from "./Modal";

/** The TLS modes, as turborel-client names them. */
const TLS_MODES = ["verify-full", "verify-ca", "require", "prefer", "disable"] as const;

/** A labelled text field of a setting. */
function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        placeholder={props.hint}
        spellCheck={false}
        onChange={(e) => {
          props.onChange(e.target.value);
        }}
      />
    </label>
  );
}

/** A labelled check box. */
function Check(props: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => {
          props.onChange(e.target.checked);
        }}
      />
      <span>{props.label}</span>
    </label>
  );
}

/** A group of fields. */
function Group({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="field-group" open={open}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

/** The environment's field. */
function EnvironmentField({ value, onChange }: { value: Environment; onChange: (value: Environment) => void }) {
  return (
    <label className="field">
      <span>Environment</span>
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value as Environment);
        }}
      >
        {Object.entries(ENVIRONMENT_NAMES).map(([environment, name]) => (
          <option key={environment} value={environment}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The fields of the connection itself: name, folder, environment and guards. */
function About({ form, set }: { form: ConnectionForm; set: (change: Partial<ConnectionForm>) => void }) {
  return (
    <Group title="Connection">
      <Field
        label="Name"
        value={form.name}
        onChange={(name) => {
          set({ name });
        }}
      />
      <Field
        label="Folder"
        value={form.folder}
        hint="Team / EU"
        onChange={(folder) => {
          set({ folder });
        }}
      />
      <EnvironmentField
        value={form.environment}
        onChange={(environment) => {
          set({ environment });
        }}
      />
      <Field
        label="Colour"
        value={form.colour}
        hint="#RRGGBB, else the environment's"
        onChange={(colour) => {
          set({ colour });
        }}
      />
      <Check
        label="Read-only: begin each transaction READ ONLY"
        checked={form.readOnly}
        onChange={(readOnly) => {
          set({ readOnly });
        }}
      />
      <Check
        label="Pinned at the top of the explorer"
        checked={form.pinned}
        onChange={(pinned) => {
          set({ pinned });
        }}
      />
    </Group>
  );
}

/** The fields of the server and the user. */
function Server({ form, setSpec, set }: FieldsProps) {
  const keychain = useStudio((s) => s.keychain);
  const field = (label: string, name: SpecField, hint?: string) => (
    <Field
      label={label}
      value={form.spec[name]}
      {...(hint === undefined ? {} : { hint })}
      onChange={(v) => {
        setSpec(name, v);
      }}
    />
  );
  return (
    <Group title="Server">
      {field("URI", "uri", "turborel://user@host:7422/?tls_mode=verify-full")}
      {field("Hosts", "host", "db1.example,db2.example")}
      {field("Port", "port", "7422")}
      {field("User", "user")}
      <Field
        label="Password"
        type="password"
        value={form.password}
        onChange={(password) => {
          set({ password });
        }}
      />
      <Check
        label="Save the password in the keychain"
        checked={form.savePassword}
        disabled={keychain?.available !== true}
        onChange={(savePassword) => {
          set({ savePassword });
        }}
      />
      {keychain?.available === false && <p className="hint">The keychain is not open: {keychain.reason}</p>}
    </Group>
  );
}

/** What a group of setting fields is given. */
interface FieldsProps {
  readonly form: ConnectionForm;
  readonly setSpec: (name: SpecField, value: string) => void;
  readonly set: (change: Partial<ConnectionForm>) => void;
}

/** The fields of TLS and of the rest of turborel-client's settings. */
function Security({ form, setSpec }: FieldsProps) {
  const field = (label: string, name: SpecField) => (
    <Field
      label={label}
      value={form.spec[name]}
      onChange={(v) => {
        setSpec(name, v);
      }}
    />
  );
  return (
    <>
      <Group title="TLS" open={false}>
        <label className="field">
          <span>TLS mode</span>
          <select
            value={form.spec.tlsMode}
            onChange={(e) => {
              setSpec("tlsMode", e.target.value);
            }}
          >
            <option value="">As the service or environment says</option>
            {TLS_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        {field("Authorities (PEM file)", "tlsRoots")}
        {field("Trust the platform's authorities (true or false)", "tlsSystemRoots")}
        {field("Client certificate (PEM file)", "tlsCertificate")}
        {field("Client key (PEM file)", "tlsKey")}
        {field("Server name", "serverName")}
        {field("Channel binding", "channelBinding")}
      </Group>
      <Group title="More" open={false}>
        {field("Service", "service")}
        {field("Service file", "serviceFile")}
        {field("Password file", "passfile")}
        {field("Target (any, read-write or read-only)", "target")}
        {field("Load balance (disable or random)", "loadBalance")}
        {field("Connect timeout (seconds)", "connectTimeout")}
      </Group>
    </>
  );
}

/** What the dialog's buttons do. */
function useActions(form: ConnectionForm) {
  const store = useStore();
  const password = form.password === "" ? null : form.password;
  const saveIt = async (): Promise<SavedConnection | undefined> => save(store, savedOf(form), passwordChangeOf(form));
  return {
    save: async () => {
      if ((await saveIt()) !== undefined) {
        show(store, null);
      }
    },
    saveAndConnect: async () => {
      const saved = await saveIt();
      if (saved !== undefined) {
        await connectSaved(store, saved, password);
      }
    },
    connect: async () => {
      const guards = { environment: form.environment, readOnly: form.readOnly };
      await connectSpec(
        store,
        form.name.trim() === "" ? "Connection" : form.name.trim(),
        specOf(form),
        guards,
        password,
      );
    },
    cancel: () => {
      show(store, null);
    },
  };
}

/** The fields the dialog begins with: of `editing`, or of a new connection given `spec`. */
function beginning(editing: SavedConnection | null, spec: ConnectionSpec | undefined): ConnectionForm {
  const made = formOf(editing);
  return spec === undefined ? made : { ...made, spec: { ...made.spec, ...spec } };
}

/** The connection dialog, of `editing` or of a new connection, which begins with `spec` if given. */
export function ConnectionDialog({
  editing,
  spec,
}: {
  readonly editing: SavedConnection | null;
  readonly spec?: ConnectionSpec;
}) {
  const [form, setForm] = useState<ConnectionForm>(() => beginning(editing, spec));
  const set = (change: Partial<ConnectionForm>) => {
    setForm((now) => ({ ...now, ...change }));
  };
  const setSpec = (name: SpecField, value: string) => {
    setForm((now) => ({ ...now, spec: { ...now.spec, [name]: value } }));
  };
  const actions = useActions(form);
  const why = invalid(form);
  return (
    <Modal title={editing === null ? "New Connection" : `Edit ${editing.name}`} onClose={actions.cancel} wide>
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <About form={form} set={set} />
        <Server form={form} setSpec={setSpec} set={set} />
        <Security form={form} setSpec={setSpec} set={set} />
        {why !== null && <p className="hint">{why}</p>}
        <div className="dialog-buttons">
          <button type="button" onClick={actions.cancel}>
            Cancel
          </button>
          {editing === null && (
            <button type="button" onClick={() => void actions.connect()}>
              Connect without Saving
            </button>
          )}
          <button type="button" disabled={why !== null} onClick={() => void actions.save()}>
            Save
          </button>
          <button type="submit" disabled={why !== null} onClick={() => void actions.saveAndConnect()}>
            Save and Connect
          </button>
        </div>
      </form>
    </Modal>
  );
}
