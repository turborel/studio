/**
 * Run SQL File (RULES.md D62): a `.sql` file chosen in the platform's
 * dialog, scanned and summed up, its statements counted by class and each
 * destructive one listed, then run on a connection without the editor, as
 * the options say, its progress shown, cancelled if asked, and what it
 * did told at the end, its log saved if wanted.
 */
import { useShortPath } from "../shell/paths";
import { type ReactNode, useEffect, useState } from "react";
import type { Confirm, StatementClass } from "../ipc/connections";
import {
  cancelSqlFile,
  chooseSqlFile,
  type FileOptions,
  type FileProgress,
  type FileReport,
  runSqlFile,
  saveSqlFileLog,
  type Scan,
  scanSqlFile,
} from "../ipc/data";
import { onStudioEvent } from "../ipc/events";
import { isStudioError } from "../state/actions";
import { useStore } from "../state/store";
import { Modal } from "../shell/Modal";
import { CLASS_NAMES, GuardQuestion } from "../worksheet/dialogs";

/** The options a run begins with: a commit every 1000 statements, stopping at the first failure. */
const FIRST_OPTIONS: FileOptions = { transactions: { kind: "every", every: 1000 }, stopOnError: true };

/** The order classes are listed in. */
const CLASS_ORDER: readonly StatementClass[] = [
  "read",
  "transaction",
  "session",
  "writeRows",
  "changeSchema",
  "security",
  "administration",
  "unclassified",
];

/** The encodings, as the summary names them. */
const ENCODING_NAMES = { utf8: "UTF-8", utf16Le: "UTF-16, little-endian", utf16Be: "UTF-16, big-endian" } as const;

/** What a failure says. */
function said(thrown: unknown): string {
  return isStudioError(thrown) ? thrown.message : thrown instanceof Error ? thrown.message : String(thrown);
}

/** `n` with its noun, singular for one. */
function counted(n: number, noun: string): string {
  return `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;
}

/** `text` with its first letter in upper case. */
function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** The run's state: the file, its scan, the options, what the guards ask, its progress and report, and what was said. */
interface FileRunState {
  readonly path: string | null;
  readonly scan: Scan | null;
  readonly guarded: Confirm | null;
  readonly options: FileOptions;
  readonly asking: Confirm | null;
  readonly running: boolean;
  readonly progress: FileProgress | null;
  readonly report: FileReport | null;
  readonly told: string;
}

/** The run's state as the dialog opens. */
const FIRST: FileRunState = {
  path: null,
  scan: null,
  guarded: null,
  options: FIRST_OPTIONS,
  asking: null,
  running: false,
  progress: null,
  report: null,
  told: "",
};

/** What the scan found: the file's size and encoding, its statements by class, and those listed. */
function ScanSummary({ scan, guarded }: { readonly scan: Scan; readonly guarded: Confirm | null }) {
  return (
    <section aria-label="What the file holds">
      <p>
        {counted(scan.statements, "statement")} in {counted(scan.bytes, "byte")}, {ENCODING_NAMES[scan.encoding]}.
      </p>
      <ul>
        {CLASS_ORDER.filter((c) => (scan.classes[c] ?? 0) > 0).map((c) => (
          <li key={c}>
            {capitalized(CLASS_NAMES[c])}: {counted(scan.classes[c] ?? 0, "statement")}
          </li>
        ))}
      </ul>
      {scan.destroysCount > 0 && (
        <>
          <p className="guard-destroys">Destroys: {counted(scan.destroysCount, "statement")}</p>
          <ul aria-label="Destructive statements">
            {scan.destroys.map((d) => (
              <li key={`${String(d.line)}.${d.what}`}>
                Line {String(d.line)}: {d.what}
              </li>
            ))}
            {scan.destroysCount > scan.destroys.length && (
              <li>and {(scan.destroysCount - scan.destroys.length).toLocaleString()} more</li>
            )}
          </ul>
        </>
      )}
      {guarded?.production === true && (
        <p className="guard-production">This is a production connection, and the file may write.</p>
      )}
    </section>
  );
}

/** A radio button of the group `name`, labelled by its children. */
function Radio(props: {
  readonly name: string;
  readonly checked: boolean;
  readonly onChoose: () => void;
  readonly children: ReactNode;
}) {
  return (
    <label>
      <input type="radio" name={props.name} checked={props.checked} onChange={props.onChoose} /> {props.children}
    </label>
  );
}

/** The choice of how the file's statements are made transactions. */
function TransactionChoices(props: { readonly options: FileOptions; readonly onOptions: (o: FileOptions) => void }) {
  const { options, onOptions } = props;
  const kind = options.transactions.kind;
  const every = options.transactions.kind === "every" ? options.transactions.every : 1000;
  const choose = (transactions: FileOptions["transactions"]) => () => {
    onOptions({ ...options, transactions });
  };
  return (
    <fieldset>
      <legend>Transactions</legend>
      <Radio name="transactions" checked={kind === "whole"} onChoose={choose({ kind: "whole" })}>
        One transaction for the whole file
      </Radio>
      <Radio name="transactions" checked={kind === "every"} onChoose={choose({ kind: "every", every })}>
        Commit every{" "}
        <input
          type="number"
          min={1}
          aria-label="Statements a commit follows"
          value={every}
          onChange={(e) => {
            choose({ kind: "every", every: Math.max(1, Math.trunc(Number(e.target.value)) || 1) })();
          }}
        />{" "}
        statements
      </Radio>
      <Radio name="transactions" checked={kind === "autocommit"} onChoose={choose({ kind: "autocommit" })}>
        Autocommit: each statement its own
      </Radio>
    </fieldset>
  );
}

/** The choice of what a failure does. */
function ErrorChoices(props: { readonly options: FileOptions; readonly onOptions: (o: FileOptions) => void }) {
  const { options, onOptions } = props;
  const choose = (stopOnError: boolean) => () => {
    onOptions({ ...options, stopOnError });
  };
  return (
    <fieldset>
      <legend>When a statement fails</legend>
      <Radio name="failure" checked={options.stopOnError} onChoose={choose(true)}>
        Stop, rolling back what ran since the last commit
      </Radio>
      <Radio name="failure" checked={!options.stopOnError} onChoose={choose(false)}>
        Go on, logging its line and SQLSTATE
      </Radio>
    </fieldset>
  );
}

/** How far the run has come: statements, bytes and failures, and a bar of the bytes. */
function Progress({ progress }: { readonly progress: FileProgress | null }) {
  const done = progress === null || progress.total === 0 ? 0 : progress.bytes / progress.total;
  return (
    <div role="status" aria-label="Progress">
      <progress max={1} value={done} />
      <p>
        {progress === null
          ? "Starting…"
          : `${counted(progress.statements, "statement")} run, ${progress.bytes.toLocaleString()} of ${counted(progress.total, "byte")} read, ${progress.failed.toLocaleString()} failed.`}
      </p>
    </div>
  );
}

/** What the run did, and its log. */
function ReportView({ report, onSave }: { readonly report: FileReport; readonly onSave: () => void }) {
  const ending = { finished: "Finished", stopped: "Stopped at a failure", cancelled: "Cancelled" }[report.ending];
  return (
    <section role="status" aria-label="What the run did">
      <p>
        {ending}: {counted(report.statements, "statement")} run, {counted(report.rowsAffected, "row")} affected,{" "}
        {report.failed.toLocaleString()} failed, in {(report.millis / 1000).toFixed(1)} s.
        {report.rolledBack ? " What ran since the last commit was rolled back." : ""}
      </p>
      {report.log.length > 0 && (
        <>
          <ol aria-label="Failures" className="file-log">
            {report.log.map((f) => (
              <li key={f.number}>
                Line {String(f.line)}: {f.sqlstate} ({String(f.sqlcode)}): {f.message}
                <br />
                <code>{f.statement}</code>
              </li>
            ))}
          </ol>
          {report.failed > report.log.length && (
            <p>and {(report.failed - report.log.length).toLocaleString()} more failures, not kept.</p>
          )}
          <button type="button" onClick={onSave}>
            Save Log…
          </button>
        </>
      )}
    </section>
  );
}

/** Takes in the progress the backend tells of the file running on `connection`. */
function useProgress(connection: number, setState: (change: (s: FileRunState) => FileRunState) => void): void {
  useEffect(() => {
    const stop = onStudioEvent((event) => {
      if (event.kind === "sqlFile" && event.connection === connection) {
        setState((s) => (s.running ? { ...s, progress: event.progress } : s));
      }
    });
    return () => {
      void stop.then((unlisten) => {
        unlisten();
      });
    };
  }, [connection, setState]);
}

/** Saves the log of the run `state` tells of, and says where. */
function saveLog(state: FileRunState, change: (next: Partial<FileRunState>) => void): void {
  if (state.path !== null && state.report !== null) {
    saveSqlFileLog(state.path, state.report).then(
      (saved) => {
        change({ told: saved === null ? "" : `The log is saved as ${saved}.` });
      },
      (thrown: unknown) => {
        change({ told: said(thrown) });
      },
    );
  }
}

/** The run of a file on `connection`: its state, its change, choosing and scanning, running and cancelling. */
function useFileRun(connection: number) {
  const [state, setState] = useState<FileRunState>(FIRST);
  const change = (next: Partial<FileRunState>) => {
    setState((s) => ({ ...s, ...next }));
  };
  useProgress(connection, setState);
  const choose = async () => {
    const path = await chooseSqlFile();
    if (path === null) {
      return;
    }
    change({ ...FIRST, options: state.options, path, told: "Scanning the file…" });
    try {
      const [scan, guarded] = await scanSqlFile(connection, path);
      change({ scan, guarded, told: "" });
    } catch (thrown: unknown) {
      change({ told: said(thrown) });
    }
  };
  const run = async (confirmed: boolean) => {
    if (state.path === null) {
      return;
    }
    change({ asking: null, running: true, progress: null, report: null, told: "" });
    try {
      const answer = await runSqlFile(connection, state.path, state.options, confirmed);
      change(
        answer.kind === "confirm"
          ? { asking: answer.confirm, running: false }
          : { report: answer.report, running: false },
      );
    } catch (thrown: unknown) {
      change({ running: false, told: said(thrown) });
    }
  };
  const cancel = () => {
    cancelSqlFile(connection).catch((thrown: unknown) => {
      change({ told: said(thrown) });
    });
  };
  const save = () => {
    saveLog(state, change);
  };
  return { state, change, choose, run, cancel, save };
}

/** The dialog's form: the file, its summary, the options, the run's progress or report. */
function FileRunForm(props: { readonly close: () => void } & ReturnType<typeof useFileRun>) {
  const short = useShortPath();
  const { state, change, choose, run, cancel, save } = props;
  const onOptions = (options: FileOptions) => {
    change({ options });
  };
  return (
    <>
      <p>
        <button type="button" data-first="" disabled={state.running} onClick={() => void choose()}>
          Choose File…
        </button>{" "}
        <span className="hint" title={state.path ?? undefined}>
          {state.path === null ? "No file chosen." : short(state.path)}
        </span>
      </p>
      {state.scan !== null && <ScanSummary scan={state.scan} guarded={state.guarded} />}
      {state.scan !== null && state.report === null && !state.running && (
        <>
          <TransactionChoices options={state.options} onOptions={onOptions} />
          <ErrorChoices options={state.options} onOptions={onOptions} />
        </>
      )}
      {state.running && <Progress progress={state.progress} />}
      {state.report !== null && <ReportView report={state.report} onSave={save} />}
      {state.told !== "" && <p className={state.scan === null ? "error" : "hint"}>{state.told}</p>}
      <div className="dialog-buttons">
        {state.running ? (
          <button type="button" onClick={cancel}>
            Cancel Run
          </button>
        ) : (
          <button type="button" onClick={props.close}>
            Close
          </button>
        )}
        <button type="button" disabled={state.scan === null || state.running} onClick={() => void run(false)}>
          {state.report === null ? "Run" : "Run Again"}
        </button>
      </div>
    </>
  );
}

/** The dialog that runs a `.sql` file on `connection`. */
export function RunSqlFileDialog({ connection }: { readonly connection: number }) {
  const store = useStore();
  const fileRun = useFileRun(connection);
  const name = store.current().open.find((c) => c.id === connection)?.name ?? "the connection";
  const close = () => {
    store.update((now) => ({ ...now, dialog: null }));
  };
  const asking = fileRun.state.asking;
  return (
    <Modal title={`Run SQL File on ${name}`} onClose={fileRun.state.running ? () => undefined : close} wide={true}>
      {asking === null ? (
        <FileRunForm {...fileRun} close={close} />
      ) : (
        <GuardQuestion
          confirm={asking}
          labels={["Run File", "Don't Run"]}
          answer={(yes) => {
            if (yes) {
              void fileRun.run(true);
            } else {
              fileRun.change({ asking: null, told: "Not run: the file was not confirmed." });
            }
          }}
        />
      )}
    </Modal>
  );
}
