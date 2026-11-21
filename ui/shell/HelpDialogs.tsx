/**
 * The About box and the list of keyboard shortcuts (RULES.md D5, D30):
 * Studio's version and the Turborel commit its client and its embedded
 * engine are built from, and
 * each command's key as it is bound now.
 */
import { useEffect, useState } from "react";
import { COMMANDS } from "../commands/commands";
import { shown } from "../commands/keys";
import { Icon } from "../icons/Icon";
import { type AppInfo, appInfo } from "../ipc/commands";
import { show } from "../state/actions";
import { useStore, useStudio } from "../state/store";
import { Modal } from "./Modal";

/** The About box. */
export function AboutDialog() {
  const store = useStore();
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    void appInfo().then(setInfo);
  }, []);
  const close = () => {
    show(store, null);
  };
  return (
    <Modal title="About Turborel Studio" onClose={close}>
      <p>Turborel Studio, the desktop database IDE for Turborel, its servers and its embedded databases.</p>
      <dl className="about">
        <dt>Version</dt>
        <dd>{info?.version ?? "…"}</dd>
        <dt>Turborel commit, of its client and engine</dt>
        <dd>
          <code>{info?.turborelCommit ?? "…"}</code>
        </dd>
      </dl>
      <div className="dialog-buttons">
        <button type="button" onClick={close}>
          Close
        </button>
      </div>
    </Modal>
  );
}

/** The list of every command and its key. */
export function ShortcutsDialog() {
  const store = useStore();
  const keys = useStudio((s) => s.settings.keyBindings);
  const close = () => {
    show(store, null);
  };
  return (
    <Modal title="Keyboard Shortcuts" onClose={close} wide>
      <table className="shortcuts">
        <thead>
          <tr>
            <th scope="col">Command</th>
            <th scope="col">Key</th>
          </tr>
        </thead>
        <tbody>
          {COMMANDS.map((c) => {
            const key = keys[c.id] ?? c.key ?? "";
            return (
              <tr key={c.id}>
                <td className="with-icon">
                  {c.icon !== undefined && <Icon name={c.icon} />}
                  {c.category}: {c.title}
                </td>
                <td>{key === "" ? "—" : <kbd>{shown(key)}</kbd>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="dialog-buttons">
        <button type="button" onClick={close}>
          Close
        </button>
      </div>
    </Modal>
  );
}
