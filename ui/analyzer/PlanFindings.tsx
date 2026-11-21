/**
 * The plan pane (RULES.md D36, D50, D51): the plan view, and below it the
 * findings of SCAN-NO-INDEX of its physical stage, each with its fix,
 * opened in a worksheet, and a what-if of the index it proposes.
 */
import { useEffect, useState } from "react";
import { namer } from "../data/ddl";
import { openDdl } from "../data/ddlActions";
import { catalogTable, type TableDetail } from "../ipc/catalog";
import { show } from "../state/actions";
import { useStore, useStudio } from "../state/store";
import { worksheetOf } from "../state/worksheets";
import type { Plan } from "../worksheet/plan";
import { PlanView } from "../worksheet/PlanView";
import { scanFindings, scannedTables } from "./planRules";
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

/** The findings of the latest plan of worksheet `id`. */
function Findings({ id, plan }: { readonly id: string; readonly plan: Plan | undefined }) {
  const store = useStore();
  const connection = useStudio((s) => worksheetOf(s, id)?.connection ?? null);
  const explained = useStudio((s) => worksheetOf(s, id)?.explained ?? null);
  const reserved = useStudio((s) => s.reservedWords);
  const tables = useScanned(connection, plan);
  const found = plan === undefined ? [] : scanFindings(plan, tables, namer(reserved));
  if (found.length === 0 || connection === null) {
    return null;
  }
  return (
    <section className="plan-findings" aria-label="Findings of the plan">
      <h4>Findings</h4>
      <ul className="findings">
        {found.map((f) => (
          <li key={`${f.schema}.${f.table}.${f.column}`}>
            <strong>{f.rule}</strong> {f.schema}.{f.table}
            <p>{f.says}</p>
            <pre className="definition-text">{`${f.create};`}</pre>
            <button
              type="button"
              onClick={() =>
                void openDdl(store, connection, { sql: `${f.create};`, title: `Index of ${f.table}` }, false)
              }
            >
              Open Fix in Worksheet
            </button>
            {explained !== null && (
              <button
                type="button"
                onClick={() => {
                  show(store, {
                    kind: "whatIf",
                    whatIf: { worksheet: id, statement: explained, index: f.index, create: f.create, drop: f.drop },
                  });
                }}
              >
                What If…
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The plan pane of worksheet `id`. */
export function PlanPane({ id, plans }: { readonly id: string; readonly plans: readonly Plan[] }) {
  const whatIf = useStudio((s) => worksheetOf(s, id)?.whatIf ?? null);
  return (
    <>
      <PlanView key={`${String(plans.length)}.${whatIf ?? ""}`} plans={plans} whatIf={whatIf} />
      <Findings id={id} plan={plans.at(-1)} />
    </>
  );
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
