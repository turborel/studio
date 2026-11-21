/**
 * How open transactions end before their connections close, or before
 * Studio quits (RULES.md D59): each committed, or rolled back, or the
 * closing cancelled. An embedded database is then closed with a
 * checkpoint, its lock given up.
 */
import { endAndClose, show } from "../state/actions";
import { useStore, useStudio } from "../state/store";
import { Modal } from "./Modal";

/** The dialog of `connections`' open transactions, as they close or Studio quits. */
export function OpenTransactionsDialog(props: { readonly connections: readonly number[]; readonly quitting: boolean }) {
  const store = useStore();
  const open = useStudio((s) => s.open);
  const names = open.filter((c) => props.connections.includes(c.id)).map((c) => c.name);
  const cancel = () => {
    show(store, null);
  };
  const which =
    names.length === 1 ? `${names[0] ?? ""} has a transaction open` : `${names.join(", ")} have transactions open`;
  return (
    <Modal title={props.quitting ? "Quit Turborel Studio" : "Disconnect"} onClose={cancel}>
      <p>
        {which}. {props.quitting ? "Before Studio quits," : "Before disconnecting,"} commit or roll back what it has
        changed?
      </p>
      <div className="dialog-buttons">
        <button type="button" onClick={cancel}>
          Cancel
        </button>
        <button type="button" onClick={() => void endAndClose(store, props, "rollback")}>
          Roll Back
        </button>
        <button type="button" autoFocus onClick={() => void endAndClose(store, props, "commit")}>
          Commit
        </button>
      </div>
    </Modal>
  );
}
