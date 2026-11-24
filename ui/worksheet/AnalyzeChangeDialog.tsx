/**
 * What Explain Analyze of a data change does, said before it runs (RULES.md
 * D61): EXPLAIN ANALYZE runs an INSERT, UPDATE, DELETE or MERGE for real.
 * Analyze, Then Roll Back undoes its changes after; Analyze and Keep
 * Changes keeps them in the transaction; the setting chooses which is
 * first. Explain Without Running shows plain EXPLAIN instead, which runs
 * nothing (D70).
 */
import { useStudio } from "../state/store";
import { Modal } from "../shell/Modal";

/** What Explain Analyze of a data change was answered: roll back, keep, plain EXPLAIN instead, or nothing. */
export type AnalyzeChoice = "rollBack" | "keep" | "explain" | null;

/** The dialog's choices, the setting's first. */
function Choices(props: { readonly keeps: boolean; readonly answer: (choice: AnalyzeChoice) => void }) {
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
        onClick={() => {
          props.answer("explain");
        }}
      >
        Explain Without Running
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
export function AnalyzeChangeDialog(props: { readonly sql: string; readonly answer: (choice: AnalyzeChoice) => void }) {
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
        them in the transaction, for Commit or Rollback. Explain Without Running shows its plan and what it would do,
        the indexes it would write, the actions that would cascade and the triggers that would fire, running nothing.
      </p>
      <Choices answer={props.answer} keeps={keeps} />
    </Modal>
  );
}
