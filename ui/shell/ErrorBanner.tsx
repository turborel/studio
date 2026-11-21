/**
 * The last failure, shown until dismissed (RULES.md R-ERR-2): its SQLSTATE,
 * SQLCODE and message, as text.
 */
import { dismissError } from "../state/actions";
import { useStore, useStudio } from "../state/store";

/** The notices of files set aside, each until dismissed (RULES.md D49). */
export function NoticeBanner() {
  const store = useStore();
  const notices = useStudio((s) => s.notices);
  if (notices.length === 0) {
    return null;
  }
  return (
    <div className="notice-banner" role="status">
      <ul>
        {notices.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => {
          store.update((now) => ({ ...now, notices: [] }));
        }}
      >
        Dismiss
      </button>
    </div>
  );
}

/** The banner of the last failure, if any. */
export function ErrorBanner() {
  const store = useStore();
  const error = useStudio((s) => s.error);
  if (error === null) {
    return null;
  }
  return (
    <div className="error-banner" role="alert">
      <span>
        SQLSTATE {error.sqlstate} (SQLCODE {error.sqlcode}): {error.message}
      </span>
      <button
        type="button"
        onClick={() => {
          dismissError(store);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
