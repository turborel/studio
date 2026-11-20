/**
 * The worksheet's dialogs (RULES.md D29, D36): the guards' question before
 * a run, the values of a statement's parameters and of the script's
 * variables, the history, and a favourite query's name.
 */
import { useEffect, useState } from "react";
import type { Confirm, StatementClass } from "../ipc/connections";
import { clearHistory, type HistoryEntry, searchHistory } from "../ipc/worksheet";
import { show } from "../state/actions";
import { runStatements } from "../state/running";
import { type Given, useStore } from "../state/store";
import { openWorksheet } from "../state/worksheets";
import { Modal } from "../shell/Modal";
import { keepFavourite, runOnFolder, savedFolders } from "./commands";
import { Icon } from "../icons/Icon";

/** What each class of statement is called. */
export const CLASS_NAMES: Readonly<Record<StatementClass, string>> = {
  read: "reads",
  transaction: "ends or shapes a transaction",
  session: "changes the session",
  writeRows: "changes rows",
  changeSchema: "changes definitions",
  security: "changes who may do what",
  administration: "changes the database or the server",
  unclassified: "may do anything: Studio cannot tell",
};

/** A list of statements under `heading`, each `marked` as code or not. */
function Listed({
  heading,
  items,
  className,
  code,
}: {
  readonly heading: string;
  readonly items: readonly string[];
  readonly className?: string;
  readonly code: boolean;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <>
      <p className={className}>{heading}</p>
      <ul>
        {items.map((item, i) => (
          <li key={`${String(i)}.${item}`} className={className}>
            {code ? <code>{item}</code> : item}
          </li>
        ))}
      </ul>
    </>
  );
}

/** The guards' question: what the script does, and whether to run it. */
export function GuardDialog({
  confirm,
  answer,
}: {
  readonly confirm: Confirm;
  readonly answer: (run: boolean) => void;
}) {
  return (
    <Modal
      title="Run this script?"
      onClose={() => {
        answer(false);
      }}
    >
      {confirm.production && (
        <p className="guard-production">This is a production connection, and the script may write.</p>
      )}
      <p>The script {CLASS_NAMES[confirm.class]}.</p>
      <Listed heading="It destroys:" items={confirm.destroys} className="guard-destroys" code={false} />
      <Listed heading="Studio cannot tell what these do:" items={confirm.unclassified} code />
      <div className="dialog-buttons">
        <button
          type="button"
          onClick={() => {
            answer(false);
          }}
        >
          Don't Run
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => {
            answer(true);
          }}
        >
          Run
        </button>
      </div>
    </Modal>
  );
}

/** What the values dialog is given. */
export interface ValuesProps {
  readonly names: readonly string[];
  readonly types: readonly string[];
  readonly remembered: Readonly<Record<string, string | null>>;
  readonly variables: readonly string[];
  readonly answer: (given: Given | null) => void;
}

/** A parameter's value: text, or NULL. */
function ValueField({
  name,
  type,
  value,
  change,
}: {
  readonly name: string;
  readonly type: string;
  readonly value: string | null;
  readonly change: (value: string | null) => void;
}) {
  return (
    <div className="value-row">
      <label className="check">
        <span>
          {name.startsWith("?") ? `Parameter ${name.slice(1)}` : `:${name}`} <span className="hint">{type}</span>
        </span>
        <input
          value={value ?? ""}
          disabled={value === null}
          onChange={(e) => {
            change(e.target.value);
          }}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={value === null}
          onChange={(e) => {
            change(e.target.checked ? null : "");
          }}
        />
        <span>NULL</span>
      </label>
    </div>
  );
}

/** The values of script variables `names`. */
function VariableFields({
  names,
  values,
  change,
}: {
  readonly names: readonly string[];
  readonly values: Readonly<Record<string, string>>;
  readonly change: (name: string, value: string) => void;
}) {
  return (
    <>
      {names.map((name) => (
        <label key={name} className="check value-row">
          <span>{`\${${name}}`}</span>
          <input
            value={values[name] ?? ""}
            onChange={(e) => {
              change(name, e.target.value);
            }}
          />
        </label>
      ))}
    </>
  );
}

/** The values of a statement's parameters, each text or NULL, and of the script's variables; those given last offered first. */
export function ValuesDialog({ names, types, remembered, variables, answer }: ValuesProps) {
  const unique = [...new Set(names)];
  const [binds, setBinds] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(unique.map((n) => [n, remembered[n] ?? ""])),
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(variables.map((n) => [n, remembered[n] ?? ""])),
  );
  const cancel = () => {
    answer(null);
  };
  return (
    <Modal title="Values" onClose={cancel}>
      {unique.map((name) => (
        <ValueField
          key={name}
          name={name}
          type={types[names.indexOf(name)] ?? ""}
          value={binds[name] ?? null}
          change={(value) => {
            setBinds((now) => ({ ...now, [name]: value }));
          }}
        />
      ))}
      <VariableFields
        names={variables}
        values={values}
        change={(name, value) => {
          setValues((now) => ({ ...now, [name]: value }));
        }}
      />
      <div className="dialog-buttons">
        <button type="button" onClick={cancel}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            answer({ binds, variables: values });
          }}
        >
          Run
        </button>
      </div>
    </Modal>
  );
}

/** How many entries the history dialog lists. */
export const HISTORY_SHOWN = 200;

/** The history's entries holding `text`, read as it changes. */
function useHistory(text: string): readonly [HistoryEntry[], (entries: HistoryEntry[]) => void] {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    let current = true;
    searchHistory(text, HISTORY_SHOWN).then(
      (found) => {
        if (current) {
          setEntries(found);
        }
      },
      () => {
        if (current) {
          setEntries([]);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [text]);
  return [entries, setEntries];
}

/** An entry of the history, opened or run again in a worksheet of its own. */
function HistoryRow({
  entry,
  open,
}: {
  readonly entry: HistoryEntry;
  readonly open: (entry: HistoryEntry, run: boolean) => void;
}) {
  return (
    <tr>
      <td>{new Date(entry.at).toLocaleString()}</td>
      <td>{entry.connection}</td>
      <td>{String(entry.millis)} ms</td>
      <td>{entry.rows === null ? "" : String(entry.rows)}</td>
      <td>{entry.sqlstate}</td>
      <td>
        <code>{entry.sql.length > 120 ? `${entry.sql.slice(0, 120)}…` : entry.sql}</code>
      </td>
      <td>
        <button
          type="button"
          onClick={() => {
            open(entry, false);
          }}
        >
          Open
        </button>
        <button
          type="button"
          onClick={() => {
            open(entry, true);
          }}
        >
          Run
        </button>
      </td>
    </tr>
  );
}

/** The history's entries, each opened or run again. */
function HistoryTable({
  entries,
  open,
}: {
  readonly entries: readonly HistoryEntry[];
  readonly open: (entry: HistoryEntry, run: boolean) => void;
}) {
  return (
    <table className="details-table" aria-label="History">
      <thead>
        <tr>
          {["When", "Connection", "Time", "Rows", "SQLSTATE", "Statement", "Open or run"].map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <HistoryRow key={`${String(e.at)}.${e.sql}`} entry={e} open={open} />
        ))}
      </tbody>
    </table>
  );
}

/** The history: searched as typed, each entry opened in a worksheet or run again there. */
export function HistoryDialog() {
  const store = useStore();
  const [text, setText] = useState("");
  const [entries, setEntries] = useHistory(text);
  const close = () => {
    show(store, null);
  };
  const open = (entry: HistoryEntry, run: boolean) => {
    close();
    const id = openWorksheet(store, entry.sql, "History");
    if (run) {
      void runStatements(store, id, [{ sql: entry.sql, from: 0, to: entry.sql.length }]);
    }
  };
  return (
    <Modal title="History" onClose={close} wide>
      <input
        aria-label="Search the history"
        placeholder="Search"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      <HistoryTable entries={entries} open={open} />
      {entries.length === 0 && <p className="hint">Nothing in the history{text === "" ? "" : " holds that"}.</p>}
      <div className="dialog-buttons">
        <button
          type="button"
          onClick={() =>
            void clearHistory().then(() => {
              setEntries([]);
            })
          }
        >
          Clear History
        </button>
        <button type="button" onClick={close}>
          Close
        </button>
      </div>
    </Modal>
  );
}

/** A favourite query's name, asked as it is kept. */
export function FavouriteDialog({ sql }: { readonly sql: string }) {
  const store = useStore();
  const [name, setName] = useState("");
  const close = () => {
    show(store, null);
  };
  return (
    <Modal title="Add to Favourite Queries" onClose={close}>
      <label className="check">
        <span>Name</span>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </label>
      <pre className="definition-text">{sql}</pre>
      <div className="dialog-buttons">
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button type="button" disabled={name.trim() === ""} onClick={() => void keepFavourite(store, name.trim(), sql)}>
          Add
        </button>
      </div>
    </Modal>
  );
}

/** The folders of the saved connections, the active worksheet's script run on each connection of the one chosen. */
export function FoldersDialog() {
  const store = useStore();
  const folders = savedFolders(store);
  const close = () => {
    show(store, null);
  };
  const count = (path: readonly string[]) =>
    store.current().saved.connections.filter((v) => path.every((name, i) => v.connection.folder[i] === name)).length;
  return (
    <Modal title="Run Script on a Folder's Connections" onClose={close}>
      {folders.length === 0 && <p className="hint">No saved connection is in a folder.</p>}
      <ul className="library" aria-label="Folders">
        {folders.map((path) => (
          <li key={path.join("/")}>
            <button
              type="button"
              className="link with-icon"
              onClick={() => {
                close();
                void runOnFolder(store, path);
              }}
            >
              <Icon name="folder" />
              {path.join(" / ")} ({String(count(path))})
            </button>
          </li>
        ))}
      </ul>
      <div className="dialog-buttons">
        <button type="button" onClick={close}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
