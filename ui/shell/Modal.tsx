/**
 * A modal dialog (RULES.md R-UI-1, R-UI-3): its title its accessible name,
 * the control it marks `data-first` focused as it opens, else its first
 * field, Tab kept within it, and Escape closing it.
 */
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";

/** What a modal is given. */
export interface ModalProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly wide?: boolean;
}

/** What can take the focus within a dialog. */
const FOCUSABLE = "input, select, textarea, button, [tabindex]:not([tabindex='-1'])";

/** The elements of `root` that can take the focus, in order. */
function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => !e.hasAttribute("disabled"));
}

/** Keeps Tab within `root`, from its last element to its first and back. */
function trapTab(event: KeyboardEvent, root: HTMLElement): void {
  const all = focusable(root);
  const first = all[0];
  const last = all.at(-1);
  if (first === undefined || last === undefined) {
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** A modal dialog of `title`. */
export function Modal({ title, onClose, children, wide = false }: ModalProps) {
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (root.current !== null) {
      (root.current.querySelector<HTMLElement>("[data-first]") ?? focusable(root.current)[0])?.focus();
    }
  }, []);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    } else if (event.key === "Tab" && root.current !== null) {
      trapTab(event, root.current);
    }
  };
  return (
    <div className="modal-backdrop">
      <div
        ref={root}
        className={wide ? "modal modal-wide" : "modal"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={keyDown}
      >
        <h2 id={titleId} className="modal-title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
