/**
 * The embedded database dialog (RULES.md D59): Open Database… and New
 * Database…, apart. The folder is chosen by the platform's dialog and
 * looked at before anything is opened or made: Open takes only a folder
 * that holds a database, New only an empty or new one; a folder another
 * process holds is refused, its server offered if one was found. An
 * encrypted database's keys folder is chosen too, and its checksum key
 * named; neither key is ever kept in Studio's files. The database opens,
 * is saved among the connections, or both.
 */
import { useShortPath } from "./paths";
import { useEffect, useState } from "react";
import { chooseDatabaseDirectory, chooseKeysDirectory, defaultOwner, type FoundServer } from "../ipc/embedded";
import type { Environment } from "../ipc/connections";
import type { SavedConnection } from "../ipc/saved";
import { connectEmbedded, connectSaved, save, show } from "../state/actions";
import { type Store, useStore } from "../state/store";
import {
  baseName,
  type EmbeddedForm,
  type EmbeddedMode,
  embeddedFormOf,
  embeddedSpecOf,
  invalidEmbedded,
  type Judged,
  judge,
  savedOfEmbedded,
  serverSpec,
} from "./embeddedForm";
import { ENVIRONMENT_NAMES } from "./environment";
import { Modal } from "./Modal";
import "./embedded.css";

/** A labelled text field. */
function Field(props: { label: string; value: string; onChange: (value: string) => void; hint?: string }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="text"
        value={props.value}
        placeholder={props.hint}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          props.onChange(e.target.value);
        }}
      />
    </label>
  );
}

/** A labelled check box. */
function Check(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
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

/** A folder shown, and the button that chooses it. */
function FolderField(props: { label: string; value: string; choose: () => void; clear?: () => void }) {
  const short = useShortPath();
  return (
    <div className="field">
      <span>{props.label.charAt(0).toUpperCase() + props.label.slice(1)}</span>
      <span className="folder-chosen">
        <output title={props.value}>{props.value === "" ? "None chosen" : short(props.value)}</output>
        <button type="button" aria-label={`Choose the ${props.label}`} onClick={props.choose}>
          Choose…
        </button>
        {props.clear !== undefined && props.value !== "" && (
          <button type="button" aria-label={`Clear the ${props.label}`} onClick={props.clear}>
            Clear
          </button>
        )}
      </span>
    </div>
  );
}

/** What the folder looked at says, and its server offered, if one was found. */
function Verdict({ judged, store }: { readonly judged: Judged | null; readonly store: Store }) {
  if (judged?.message === null || judged === null) {
    return null;
  }
  const server: FoundServer | null = judged.server;
  return (
    <div role="alert" className="hint">
      <p>{judged.message}</p>
      {server !== null && (
        <button
          type="button"
          onClick={() => {
            show(store, { kind: "connection", editing: null, spec: serverSpec(server) });
          }}
        >
          Connect to Its Server…
        </button>
      )}
    </div>
  );
}

/** The fields of the connection: name, folder, environment and colour. */
function About({ form, set }: { form: EmbeddedForm; set: (change: Partial<EmbeddedForm>) => void }) {
  return (
    <>
      <Field
        label="Name"
        value={form.name}
        onChange={(name) => {
          set({ name });
        }}
      />
      <Field
        label="Folder in the explorer"
        value={form.folder}
        hint="Team / EU"
        onChange={(folder) => {
          set({ folder });
        }}
      />
      <label className="field">
        <span>Environment</span>
        <select
          value={form.environment}
          onChange={(e) => {
            set({ environment: e.target.value as Environment });
          }}
        >
          {Object.entries(ENVIRONMENT_NAMES).map(([environment, name]) => (
            <option key={environment} value={environment}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <Guards form={form} set={set} />
    </>
  );
}

/** The fields of the connection's colour and guards. */
function Guards({ form, set }: { form: EmbeddedForm; set: (change: Partial<EmbeddedForm>) => void }) {
  return (
    <>
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
    </>
  );
}

/** The fields of the database's keys, its owner and its plug-ins. */
function Database({ form, set }: { form: EmbeddedForm; set: (change: Partial<EmbeddedForm>) => void }) {
  return (
    <details className="field-group" open={form.mode === "new" || form.keys !== ""}>
      <summary>Database</summary>
      <Field
        label={form.mode === "new" ? "Owner" : "Act as (else its owner)"}
        value={form.user}
        onChange={(user) => {
          set({ user });
        }}
      />
      <p className="hint">
        An encrypted database&apos;s keys stay in the keys directory chosen: Studio keeps only its path.
      </p>
      <FolderField
        label="keys directory"
        value={form.keys}
        choose={() =>
          void chooseKeysDirectory().then((keys) => {
            if (keys !== null) {
              set({ keys });
            }
          })
        }
        clear={() => {
          set({ keys: "" });
        }}
      />
      <Field
        label="Checksum key, by its name in the keys directory"
        value={form.checksumKey}
        onChange={(checksumKey) => {
          set({ checksumKey });
        }}
      />
      <Field
        label="Plug-in directories, separated by ;"
        value={form.pluginDirectories}
        onChange={(pluginDirectories) => {
          set({ pluginDirectories });
        }}
      />
    </details>
  );
}

/** The title of the dialog of `mode`, or of `editing`. */
function titleOf(mode: EmbeddedMode, editing: SavedConnection | null): string {
  if (editing !== null) {
    return `Edit ${editing.name}`;
  }
  return mode === "new" ? "New Database" : "Open Database";
}

/** What the dialog's buttons do with `form`. */
function useActions(form: EmbeddedForm) {
  const store = useStore();
  const guards = { environment: form.environment, readOnly: form.readOnly };
  const about = { name: form.name.trim(), savedId: null, guards, colour: form.colour === "" ? null : form.colour };
  return {
    cancel: () => {
      show(store, null);
    },
    /** Opens or makes it, saved nowhere. */
    open: () => connectEmbedded(store, embeddedSpecOf(form), about).then(() => undefined),
    /** Saves it, and closes the dialog. */
    save: async () => {
      if ((await save(store, savedOfEmbedded(form), { kind: "keep" })) !== undefined) {
        show(store, null);
      }
    },
    /** Saves it, then opens it as saved. */
    saveAndOpen: async () => {
      const saved = await save(store, savedOfEmbedded(form), { kind: "keep" });
      if (saved !== undefined) {
        await connectSaved(store, saved, null);
      }
    },
    /** Makes it, then saves it, to be opened, never made, again. */
    createAndSave: async () => {
      if (await connectEmbedded(store, embeddedSpecOf(form), about)) {
        const saved = await save(store, savedOfEmbedded({ ...form, mode: "open" }), { kind: "keep" });
        const id = store.current().open.at(-1)?.id;
        if (saved !== undefined && id !== undefined) {
          store.update((now) => ({
            ...now,
            open: now.open.map((c) => (c.id === id ? { ...c, savedId: saved.id } : c)),
          }));
        }
      }
    },
  };
}

/** The embedded database dialog, of `mode`, or of the saved `editing`. */
export function EmbeddedDialog({
  mode,
  editing,
}: {
  readonly mode: EmbeddedMode;
  readonly editing: SavedConnection | null;
}) {
  const store = useStore();
  const [form, setForm] = useState<EmbeddedForm>(() => embeddedFormOf(editing, mode, ""));
  const [judged, setJudged] = useState<Judged | null>(null);
  const set = (change: Partial<EmbeddedForm>) => {
    setForm((now) => ({ ...now, ...change }));
  };
  useEffect(() => {
    if (form.mode === "new" && form.user === "") {
      void defaultOwner().then((user) => {
        setForm((now) => (now.user === "" ? { ...now, user } : now));
      });
    }
  }, [form.mode, form.user]);
  const choose = async () => {
    const chosen = await chooseDatabaseDirectory(titleOf(form.mode, null));
    if (chosen !== null) {
      setForm((now) => ({ ...now, directory: chosen.path, name: now.name === "" ? baseName(chosen.path) : now.name }));
      setJudged(judge(form.mode, chosen.path, chosen.check));
    }
  };
  const refused = judged !== null && !judged.ok;
  const why = invalidEmbedded(form);
  const blocked = why !== null || refused;
  const actions = useActions(form);
  return (
    <Modal title={titleOf(form.mode, editing)} onClose={actions.cancel} wide>
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <FolderField label="database folder" value={form.directory} choose={() => void choose()} />
        <Verdict judged={judged} store={store} />
        <About form={form} set={set} />
        <Database form={form} set={set} />
        {why !== null && <p className="hint">{why}</p>}
        <Buttons actions={actions} making={form.mode === "new"} editing={editing !== null} blocked={blocked} />
      </form>
    </Modal>
  );
}

/** The dialog's buttons: those that make a database, or those that open one. */
function Buttons(props: {
  readonly actions: ReturnType<typeof useActions>;
  readonly making: boolean;
  readonly editing: boolean;
  readonly blocked: boolean;
}) {
  const { actions, making, blocked } = props;
  return (
    <div className="dialog-buttons">
      <button type="button" onClick={actions.cancel}>
        Cancel
      </button>
      {!props.editing && (
        <button type="button" disabled={blocked} onClick={() => void actions.open()}>
          {making ? "Create without Saving" : "Open without Saving"}
        </button>
      )}
      {!making && (
        <button type="button" disabled={blocked} onClick={() => void actions.save()}>
          Save
        </button>
      )}
      <button
        type="submit"
        disabled={blocked}
        onClick={() => void (making ? actions.createAndSave() : actions.saveAndOpen())}
      >
        {making ? "Create and Save" : "Save and Open"}
      </button>
    </div>
  );
}
