/**
 * A question of one line of text (RULES.md D53), as a new name: asked
 * by a dialog, answered by OK or Return, or let go by Cancel or Escape.
 */
import { useState } from "react";
import type { Store } from "../state/store";
import { Modal } from "./Modal";

/** Asks `label` of `title`, `initial` given first: the text answered, or null if let go. */
export function prompted(store: Store, title: string, label: string, initial = ""): Promise<string | null> {
  return new Promise((answer) => {
    store.update((now) => ({
      ...now,
      dialog: {
        kind: "prompt",
        title,
        label,
        initial,
        answer: (value) => {
          store.update((then) => ({ ...then, dialog: null }));
          answer(value);
        },
      },
    }));
  });
}

/** The dialog of a question. */
export function PromptDialog(props: {
  readonly title: string;
  readonly label: string;
  readonly initial: string;
  readonly answer: (value: string | null) => void;
}) {
  const [value, setValue] = useState(props.initial);
  const ok = value.trim() !== "";
  return (
    <Modal
      title={props.title}
      onClose={() => {
        props.answer(null);
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) {
            props.answer(value.trim());
          }
        }}
      >
        <label className="check">
          <span>{props.label}</span>
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
            }}
          />
        </label>
        <div className="dialog-buttons">
          <button
            type="button"
            onClick={() => {
              props.answer(null);
            }}
          >
            Cancel
          </button>
          <button type="submit" disabled={!ok}>
            OK
          </button>
        </div>
      </form>
    </Modal>
  );
}
