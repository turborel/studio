/**
 * The form of an action of ALTER TABLE (RULES.md D44,
 * [DOC sql/statements/alter-table.md SYNOPSIS]): its kind, and the fields
 * it takes.
 */
import { useState } from "react";
import type { TableDetail } from "../ipc/catalog";
import type { AlterAction, Behavior, ColumnSpec, ConstraintSpec } from "./ddl";
import { BLANK, blankConstraint, ColumnFields, ConstraintFields, Text, TypeList } from "./TableForms";

/** Each action of ALTER TABLE, as the alter dialog names it. */
export const ALTER_NAMES: readonly (readonly [AlterAction["kind"], string])[] = [
  ["addColumn", "Add Column"],
  ["dropColumn", "Drop Column"],
  ["renameColumn", "Rename Column"],
  ["setDefault", "Set Default"],
  ["dropDefault", "Drop Default"],
  ["setNotNull", "Set NOT NULL"],
  ["dropNotNull", "Drop NOT NULL"],
  ["setDataType", "Set Data Type"],
  ["addConstraint", "Add Constraint"],
  ["dropConstraint", "Drop Constraint"],
  ["renameTable", "Rename Table"],
];

/** What the alter form holds as an action is chosen. */
interface Draft {
  readonly kind: AlterAction["kind"];
  readonly column: string;
  readonly text: string;
  readonly behavior: Behavior;
  readonly added: ColumnSpec;
  readonly constraint: ConstraintSpec;
  readonly dropped: string;
}

/** The action `draft` stands for. */
export function actionOf(draft: Draft): AlterAction {
  const { column, text, behavior } = draft;
  switch (draft.kind) {
    case "addColumn":
      return { kind: "addColumn", column: draft.added };
    case "dropColumn":
      return { kind: "dropColumn", column, behavior };
    case "renameColumn":
      return { kind: "renameColumn", column, to: text };
    case "setDefault":
      return { kind: "setDefault", column, default: text };
    case "setDataType":
      return { kind: "setDataType", column, type: text };
    case "addConstraint":
      return { kind: "addConstraint", constraint: draft.constraint };
    case "dropConstraint":
      return { kind: "dropConstraint", constraint: draft.dropped, behavior };
    case "renameTable":
      return { kind: "renameTable", to: text };
    case "dropDefault":
    case "setNotNull":
    case "dropNotNull":
      return { kind: draft.kind, column };
  }
}

/** Which of a draft's fields each action takes: a column, a text and its label, a drop's behaviour. */
const TAKES: Readonly<Record<AlterAction["kind"], { column: boolean; text: string | null; behavior: boolean }>> = {
  addColumn: { column: false, text: null, behavior: false },
  dropColumn: { column: true, text: null, behavior: true },
  renameColumn: { column: true, text: "New name", behavior: false },
  setDefault: { column: true, text: "Default", behavior: false },
  dropDefault: { column: true, text: null, behavior: false },
  setNotNull: { column: true, text: null, behavior: false },
  dropNotNull: { column: true, text: null, behavior: false },
  setDataType: { column: true, text: "Type", behavior: false },
  addConstraint: { column: false, text: null, behavior: false },
  dropConstraint: { column: false, text: null, behavior: true },
  renameTable: { column: false, text: "New name", behavior: false },
};

/** A choice of one of `names`. */
function Choice(props: {
  readonly label: string;
  readonly value: string;
  readonly names: readonly string[];
  readonly onValue: (v: string) => void;
}) {
  return (
    <label className="field">
      {props.label}{" "}
      <select
        value={props.value}
        onChange={(e) => {
          props.onValue(e.target.value);
        }}
      >
        {props.names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The text field of the action drafted, if it takes one: a new name, a default or a type. */
function DraftText({ draft, change }: { readonly draft: Draft; readonly change: (d: Partial<Draft>) => void }) {
  const label = TAKES[draft.kind].text;
  if (label === null) {
    return null;
  }
  return (
    <label className="field">
      {label}{" "}
      <Text
        label={label}
        list={draft.kind === "setDataType" ? "studio-types" : undefined}
        value={draft.text}
        onValue={(text) => {
          change({ text });
        }}
      />
    </label>
  );
}

/** The fields of the column or constraint the action drafted adds. */
function DraftAdded({ draft, change }: { readonly draft: Draft; readonly change: (d: Partial<Draft>) => void }) {
  if (draft.kind === "addConstraint") {
    return (
      <ConstraintFields
        c={draft.constraint}
        n={1}
        onConstraint={(constraint) => {
          change({ constraint });
        }}
      />
    );
  }
  if (draft.kind !== "addColumn") {
    return null;
  }
  return (
    <table className="form-table" aria-label="Column added">
      <tbody>
        <tr>
          <ColumnFields
            column={draft.added}
            n={1}
            onColumn={(added) => {
              change({ added });
            }}
          />
        </tr>
      </tbody>
    </table>
  );
}

/** The fields of the action drafted. */
function DraftFields({
  table,
  draft,
  change,
}: {
  readonly table: TableDetail;
  readonly draft: Draft;
  readonly change: (d: Partial<Draft>) => void;
}) {
  const takes = TAKES[draft.kind];
  return (
    <>
      {takes.column && (
        <Choice
          label="Column"
          value={draft.column}
          names={table.columns.map((c) => c.name)}
          onValue={(column) => {
            change({ column });
          }}
        />
      )}
      <DraftText draft={draft} change={change} />
      {draft.kind === "dropConstraint" && (
        <Choice
          label="Constraint"
          value={draft.dropped}
          names={table.constraints.map((c) => c.name)}
          onValue={(dropped) => {
            change({ dropped });
          }}
        />
      )}
      {takes.behavior && (
        <Choice
          label="Behaviour"
          value={draft.behavior}
          names={["RESTRICT", "CASCADE"]}
          onValue={(b) => {
            change({ behavior: b === "CASCADE" ? "CASCADE" : "RESTRICT" });
          }}
        />
      )}
      <DraftAdded draft={draft} change={change} />
    </>
  );
}

/** The form of an action of ALTER TABLE on `table`: its kind, its fields, and Add to Script. */
export function AlterForm({
  table,
  onAction,
}: {
  readonly table: TableDetail;
  readonly onAction: (a: AlterAction) => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    kind: "addColumn",
    column: table.columns[0]?.name ?? "",
    text: "",
    behavior: "RESTRICT",
    added: BLANK,
    constraint: blankConstraint("unique"),
    dropped: table.constraints[0]?.name ?? "",
  });
  const change = (d: Partial<Draft>) => {
    setDraft({ ...draft, ...d });
  };
  return (
    <fieldset className="alter-form">
      <legend>Action</legend>
      <TypeList />
      <label className="field">
        Action{" "}
        <select
          value={draft.kind}
          onChange={(e) => {
            change({ kind: e.target.value as AlterAction["kind"], text: "" });
          }}
        >
          {ALTER_NAMES.map(([kind, name]) => (
            <option key={kind} value={kind}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <DraftFields table={table} draft={draft} change={change} />
      <button
        type="button"
        onClick={() => {
          onAction(actionOf(draft));
        }}
      >
        Add to Script
      </button>
    </fieldset>
  );
}
