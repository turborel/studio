/**
 * A failure the window did not handle (RULES.md D49): a failure in
 * drawing it shows a panel in its place, saying what failed, with Copy
 * Details, Reset Layout and Reload, never a blank window; one of a script
 * or a promise is told in the error banner. Each is kept in the failures'
 * log.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { forgetLayout, logFailure } from "../ipc/preferences";
import type { StudioError } from "../ipc/connections";

/** What a failure says: its name, its message and where it was. */
export function failureDetails(failure: unknown, where = ""): string {
  const head = failure instanceof Error ? `${failure.name}: ${failure.message}` : String(failure);
  const stack = failure instanceof Error && failure.stack !== undefined ? `\n${failure.stack}` : "";
  return `${head}${stack}${where === "" ? "" : `\n${where}`}`;
}

/** Keeps `text` in the failures' log, as far as it can. */
export function keep(text: string): void {
  void logFailure(text).catch(() => undefined);
}

/** What the boundary keeps: the failure's details, once one came. */
interface Failed {
  readonly details: string | null;
}

/** The panel of a failure: what failed, and what may be done. */
export function FailurePanel({ details }: { readonly details: string }) {
  return (
    <div className="failure-panel" role="alert">
      <h1>Turborel Studio met a failure</h1>
      <p>The window could not be drawn. The failure is kept in the failures' log; its details follow.</p>
      <pre>{details}</pre>
      <p>
        <button type="button" onClick={() => void navigator.clipboard.writeText(details).catch(() => undefined)}>
          Copy Details
        </button>{" "}
        <button
          type="button"
          onClick={() =>
            void forgetLayout()
              .catch(() => null)
              .then(() => {
                window.location.reload();
              })
          }
        >
          Reset Layout and Reload
        </button>{" "}
        <button
          type="button"
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload
        </button>
      </p>
    </div>
  );
}

/** Shows the failure panel in place of its children, should drawing them fail. */
export class FailureBoundary extends Component<{ readonly children: ReactNode }, Failed> {
  override state: Failed = { details: null };

  /** The state of a failure in drawing. */
  static getDerivedStateFromError(failure: unknown): Failed {
    return { details: failureDetails(failure) };
  }

  /** Keeps the failure, and where in the window it was, in the log. */
  override componentDidCatch(failure: unknown, info: ErrorInfo): void {
    const details = failureDetails(failure, info.componentStack ?? "");
    this.setState({ details });
    keep(details);
  }

  /** The children, or the panel of their failure. */
  override render(): ReactNode {
    return this.state.details === null ? this.props.children : <FailurePanel details={this.state.details} />;
  }
}

/** A failure of a script or promise as Studio's error, for the banner. */
function asStudioError(text: string): StudioError {
  return {
    sqlcode: -910,
    sqlstate: "TB910",
    message: text,
    rule: null,
    position: null,
    active: false,
    diagnostics: null,
  };
}

/** Watches for failures of scripts and promises not handled: each kept, and given `tell` for the banner. What stops it. */
export function watchFailures(tell: (error: StudioError) => void): () => void {
  const failed = (event: ErrorEvent) => {
    const text = failureDetails(event.error ?? event.message);
    keep(text);
    tell(asStudioError(text.split("\n")[0] ?? text));
  };
  const rejected = (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    const text =
      typeof reason === "object" && reason !== null && "message" in reason && !(reason instanceof Error)
        ? String(reason.message)
        : failureDetails(reason);
    keep(text);
    tell(asStudioError(text.split("\n")[0] ?? text));
  };
  window.addEventListener("error", failed);
  window.addEventListener("unhandledrejection", rejected);
  return () => {
    window.removeEventListener("error", failed);
    window.removeEventListener("unhandledrejection", rejected);
  };
}
