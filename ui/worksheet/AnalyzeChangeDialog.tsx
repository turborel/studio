/**
 * What Explain Analyze of a data change does, said before it runs (RULES.md
 * D61): EXPLAIN ANALYZE runs an INSERT, UPDATE, DELETE or MERGE for real.
 * Analyze, Then Roll Back undoes its changes after; Analyze and Keep
 * Changes keeps them in the transaction; the setting chooses which is
 * first.
 */
import { useStudio } from "../state/store";
import { Modal } from "../shell/Modal";

/** The dialog's choices, the setting's first. */
function Choices(props: { readonly keeps: boolean; readonly answer: (choice: "rollBack" | "keep" | null) => void }) {
  const first = (choice: "rollBack" | "keep") => (props.keeps ? choice === "keep" : choice === "rollBack");
  return (
    <div className="dialog-buttons">
      <button
        type="button"
        onClick={() => {
          props.answer(null);
        }}
      >
        Cancel
      </button>
      <button
        type="button"
        data-first={first("keep") ? "" : undefined}
        onClick={() => {
          props.answer("keep");
        }}
      >
        Analyze and Keep Changes
      </button>
      <button
        type="button"
        data-first={first("rollBack") ? "" : undefined}
        onClick={() => {
          props.answer("rollBack");
        }}
      >
        Analyze, Then Roll Back
      </button>
    </div>
  );
}

/** The dialog of Explain Analyze of data change `sql`, its choice given to `answer`. */
export function AnalyzeChangeDialog(props: {
  readonly sql: string;
  readonly answer: (choice: "rollBack" | "keep" | null) => void;
}) {
  const keeps = useStudio((s) => s.settings.analyzeKeepsChanges);
  return (
    <Modal
      title="Explain Analyze changes data"
      onClose={() => {
        props.answer(null);
      }}
    >
      <p>
        EXPLAIN ANALYZE runs this statement for real, in the session&apos;s transaction, and shows its plan and what
        each operator did:
      </p>
      <pre className="analyze-change">{props.sql}</pre>
      <p>
        Analyze, Then Roll Back undoes its changes after, to a savepoint set before it. Analyze and Keep Changes leaves
        them in the transaction, for Commit or Rollback.
      </p>
      <Choices answer={props.answer} keeps={keeps} />
    </Modal>
  );
}
