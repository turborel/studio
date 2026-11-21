/**
 * The plan's findings (RULES.md D50, D51): those of SCAN-NO-INDEX of its
 * physical stage, of the tables it scans read of the catalog, each with
 * its fix, and the dialog that asks before a what-if of the index one
 * proposes.
 */
import { useEffect, useState } from "react";
import { namer } from "../data/ddl";
import { catalogTable, type TableDetail } from "../ipc/catalog";
import { show } from "../state/actions";
import { useStore, useStudio } from "../state/store";
import { worksheetOf } from "../state/worksheets";
import type { Plan } from "../plan/plan";
import { type ScanFinding, scanFindings, scannedTables } from "./planRules";
import { Modal } from "../shell/Modal";
import type { WhatIf } from "./whatIf";
import { runWhatIf } from "./whatIf";

/** The tables `plan` reads whole under a filter, read of `connection`'s catalog; none of a table that cannot be. */
function useScanned(connection: number | null, plan: Plan | undefined): readonly TableDetail[] {
  const [read, setRead] = useState<{ readonly of: Plan | undefined; readonly tables: readonly TableDetail[] }>({
    of: undefined,
    tables: [],
  });
  useEffect(() => {
    let current = true;
    const scanned = plan === undefined ? [] : scannedTables(plan);
    if (connection !== null && scanned.length > 0) {
      void Promise.allSettled(scanned.map((s) => catalogTable(connection, s.schema, s.table))).then((found) => {
        if (current) {
          setRead({ of: plan, tables: found.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])) });
        }
      });
    }
    return () => {
      current = false;
    };
  }, [connection, plan]);
  return read.of === plan ? read.tables : [];
}

/** The findings of SCAN-NO-INDEX of `plan`, of worksheet `id`'s connection's catalog. */
export function usePlanFindings(id: string, plan: Plan | undefined): readonly ScanFinding[] {
  const connection = useStudio((s) => worksheetOf(s, id)?.connection ?? null);
  const reserved = useStudio((s) => s.reservedWords);
  const tables = useScanned(connection, plan);
  return plan === undefined || connection === null ? [] : scanFindings(plan, tables, namer(reserved));
}

/** Asks before what-if `whatIf` runs, saying what it does. */
export function WhatIfDialog({ whatIf }: { readonly whatIf: WhatIf }) {
  const store = useStore();
  const close = () => {
    show(store, null);
  };
  return (
    <Modal title="What If" onClose={close}>
      <p>
        Studio makes the index for real, explains the statement, then drops the index. The index is built of the
        table&apos;s rows apart from any transaction, and other sessions see it, and may use it, while it stands. It
        runs outside a transaction: one open must be ended first.
      </p>
      <pre className="definition-text">{`${whatIf.create};\nEXPLAIN ${whatIf.statement.sql};\n${whatIf.drop};`}</pre>
      <div className="dialog-buttons">
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button type="button" onClick={() => void runWhatIf(store, whatIf)}>
          Make, Explain and Drop
        </button>
      </div>
    </Modal>
  );
}
