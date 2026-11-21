/**
 * The tools of a result's rows being edited (RULES.md D42): begin and end
 * editing; add a row, remove the rows selected; set a cell to NULL; how
 * many changes are staged; review their statements; revert them; apply
 * them in a transaction.
 */
import type { GridSelection } from "@glideapps/glide-data-grid";
import { useState } from "react";
import { Icon, type IconName, LARGE } from "../icons/Icon";
import { Modal } from "../shell/Modal";
import { useStore, useStudio } from "../state/store";
import { type RunResult, worksheetOf } from "../state/worksheets";
import { requeryable } from "./actions";
import { addRow, NO_EDITS, removeRows, staged } from "./edits";
import { applyEdits, beginEditing, endEditing, reviewText, stage } from "./editing";
import { chosenOf } from "./selection";

/** A button of the tools: its icon, and its name as its tooltip and accessible name. */
function EditTool(props: {
  readonly icon: IconName;
  readonly name: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="tool"
      title={props.name}
      aria-label={props.name}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size={LARGE} />
    </button>
  );
}

/** The statements the edits make, to be read before they run. */
function Review({ run, onClose }: { readonly run: RunResult; readonly onClose: () => void }) {
  return (
    <Modal title="Review Changes" onClose={onClose} wide={true}>
      <pre className="value-text" aria-label="Statements">
        {reviewText(run)}
      </pre>
      <div className="dialog-buttons">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

/** The rows selected, of the rows read and added. */
function selectedRows(run: RunResult, selection: GridSelection): readonly number[] {
  const total = run.rows.length + (run.editing?.edits.added.length ?? 0);
  return chosenOf(selection, total, run.columns.length)?.rows ?? [];
}

/** The tools of the edits staged of run `run`: their count, review, revert and application. */
function StagedTools({ id, run, count }: { readonly id: string; readonly run: RunResult; readonly count: number }) {
  const store = useStore();
  const running = useStudio((s) => worksheetOf(s, id)?.running ?? false);
  const [reviewing, setReviewing] = useState(false);
  return (
    <>
      <span className="hint">{count === 1 ? "1 change staged" : `${String(count)} changes staged`}</span>
      <EditTool
        icon="review"
        name="Review Changes…"
        disabled={count === 0}
        onClick={() => {
          setReviewing(true);
        }}
      />
      <EditTool
        icon="rollback"
        name="Revert Changes"
        disabled={count === 0}
        onClick={() => {
          stage(store, id, run.id, () => NO_EDITS);
        }}
      />
      <EditTool
        icon="commit"
        name="Apply Changes"
        disabled={count === 0 || running}
        onClick={() => void applyEdits(store, id, run.id)}
      />
      {reviewing && (
        <Review
          run={run}
          onClose={() => {
            setReviewing(false);
          }}
        />
      )}
    </>
  );
}

/** The tool that begins editing run `run`'s rows. */
function BeginEditing({ id, run }: { readonly id: string; readonly run: RunResult }) {
  const store = useStore();
  const running = useStudio((s) => worksheetOf(s, id)?.running ?? false);
  return (
    <span className="tool-group" role="group" aria-label="Edit">
      <EditTool
        icon="edit"
        name="Edit Rows"
        disabled={!requeryable(run) || running}
        onClick={() => void beginEditing(store, id, run.id)}
      />
    </span>
  );
}

/** The tools of editing run `run` of worksheet `id`, the grid's selection `selection`. */
export function EditTools({
  id,
  run,
  selection,
}: {
  readonly id: string;
  readonly run: RunResult;
  readonly selection: GridSelection;
}) {
  const store = useStore();
  if (run.editing === null) {
    return <BeginEditing id={id} run={run} />;
  }
  const rows = selectedRows(run, selection);
  return (
    <span className="tool-group edit-tools" role="group" aria-label="Edit">
      <EditTool
        icon="addRow"
        name="Add Row"
        onClick={() => {
          stage(store, id, run.id, addRow);
        }}
      />
      <EditTool
        icon="remove"
        name="Remove Rows Selected"
        disabled={rows.length === 0}
        onClick={() => {
          stage(store, id, run.id, (e) => removeRows(e, rows, run.rows.length));
        }}
      />
      <StagedTools id={id} run={run} count={staged(run.editing.edits)} />
      <EditTool
        icon="close"
        name="Stop Editing"
        onClick={() => {
          endEditing(store, id, run.id);
        }}
      />
    </span>
  );
}
