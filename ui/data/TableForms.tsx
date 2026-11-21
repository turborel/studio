/**
 * The forms of the table dialogs (RULES.md D44): the columns of a table
 * made, and its constraints.
 */
import { TYPE_CHOICES } from "./typeChoices";
import type { Action, ColumnSpec, ConstraintSpec } from "./ddl";

/** A column as it is added: of no name, INTEGER, taking null. */
export const BLANK: ColumnSpec = {
  name: "",
  type: "INTEGER",
  notNull: false,
  default: "",
  primaryKey: false,
  unique: false,
};

/** The types offered as a column's type is written. */
export function TypeList() {
  return (
    <datalist id="studio-types">
      {TYPE_CHOICES.map((t) => (
        <option key={t} value={t} />
      ))}
    </datalist>
  );
}

/** A text field named `label`. */
export function Text(props: {
  readonly label: string;
  readonly value: string;
  readonly onValue: (v: string) => void;
  readonly list?: string | undefined;
  readonly placeholder?: string;
}) {
  return (
    <input
      aria-label={props.label}
      list={props.list}
      placeholder={props.placeholder}
      value={props.value}
      onChange={(e) => {
        props.onValue(e.target.value);
      }}
    />
  );
}

/** The fields of one column, `n` its place from 1. */
export function ColumnFields({
  column,
  n,
  onColumn,
}: {
  readonly column: ColumnSpec;
  readonly n: number;
  readonly onColumn: (c: ColumnSpec) => void;
}) {
  const of = ` of column ${String(n)}`;
  return (
    <>
      <td>
        <Text
          label={`Name${of}`}
          value={column.name}
          onValue={(name) => {
            onColumn({ ...column, name });
          }}
        />
      </td>
      <td>
        <Text
          label={`Type${of}`}
          list="studio-types"
          value={column.type}
          onValue={(type) => {
            onColumn({ ...column, type });
          }}
        />
      </td>
      <NotNullCell column={column} n={n} onColumn={onColumn} />
      <td>
        <Text
          label={`Default${of}`}
          value={column.default}
          onValue={(d) => {
            onColumn({ ...column, default: d });
          }}
        />
      </td>
      <KeyCell column={column} n={n} onColumn={onColumn} />
    </>
  );
}

/** The choice of whether a column is NOT NULL. */
function NotNullCell({
  column,
  n,
  onColumn,
}: {
  readonly column: ColumnSpec;
  readonly n: number;
  readonly onColumn: (c: ColumnSpec) => void;
}) {
  return (
    <td>
      <input
        type="checkbox"
        aria-label={`Column ${String(n)} is NOT NULL`}
        checked={column.notNull}
        onChange={(e) => {
          onColumn({ ...column, notNull: e.target.checked });
        }}
      />
    </td>
  );
}

/** The choice of a column's key: none, the primary key, or unique. */
function KeyCell({
  column,
  n,
  onColumn,
}: {
  readonly column: ColumnSpec;
  readonly n: number;
  readonly onColumn: (c: ColumnSpec) => void;
}) {
  const key = column.primaryKey ? "primary" : column.unique ? "unique" : "";
  return (
    <td>
      <select
        aria-label={`Key of column ${String(n)}`}
        value={key}
        onChange={(e) => {
          onColumn({ ...column, primaryKey: e.target.value === "primary", unique: e.target.value === "unique" });
        }}
      >
        <option value="">None</option>
        <option value="primary">Primary key</option>
        <option value="unique">Unique</option>
      </select>
    </td>
  );
}

/** The headings of the columns' table. */
const COLUMN_HEADINGS = ["Name", "Type", "NOT NULL", "Default", "Key", ""];

/** The head of the columns' table. */
function ColumnsHead() {
  return (
    <thead>
      <tr>
        {COLUMN_HEADINGS.map((h) => (
          <th key={h} scope="col">
            {h}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/** A column's row: its fields, and its buttons that move it up and remove it. */
function ColumnRow(props: {
  readonly column: ColumnSpec;
  readonly n: number;
  readonly onColumn: (c: ColumnSpec) => void;
  readonly onUp: () => void;
  readonly onRemove: () => void;
}) {
  return (
    <tr>
      <ColumnFields column={props.column} n={props.n} onColumn={props.onColumn} />
      <td>
        <button
          type="button"
          aria-label={`Move column ${String(props.n)} up`}
          disabled={props.n === 1}
          onClick={props.onUp}
        >
          ↑
        </button>
        <button type="button" aria-label={`Remove column ${String(props.n)}`} onClick={props.onRemove}>
          ×
        </button>
      </td>
    </tr>
  );
}

/** The columns of a table made: each its fields, moved up or removed; a column added. */
export function ColumnsEditor({
  columns,
  onColumns,
}: {
  readonly columns: readonly ColumnSpec[];
  readonly onColumns: (c: readonly ColumnSpec[]) => void;
}) {
  const up = (i: number) => () => {
    const next = [...columns];
    const [moved] = next.splice(i, 1);
    next.splice(i - 1, 0, ...(moved === undefined ? [] : [moved]));
    onColumns(next);
  };
  return (
    <fieldset>
      <legend>Columns</legend>
      <TypeList />
      <table className="form-table" aria-label="Columns">
        <ColumnsHead />
        <tbody>
          {columns.map((c, i) => (
            <ColumnRow
              key={String(i)}
              column={c}
              n={i + 1}
              onColumn={(d) => {
                onColumns(columns.map((e, j) => (j === i ? d : e)));
              }}
              onUp={up(i)}
              onRemove={() => {
                onColumns(columns.filter((_, j) => j !== i));
              }}
            />
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={() => {
          onColumns([...columns, BLANK]);
        }}
      >
        Add Column
      </button>
    </fieldset>
  );
}

/** Names written as a list, between commas. */
function listed(text: string): string[] {
  return text
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n !== "");
}

/** The constraint of `kind`, empty. */
export function blankConstraint(kind: ConstraintSpec["kind"]): ConstraintSpec {
  switch (kind) {
    case "primaryKey":
    case "unique":
      return { kind, name: "", columns: [] };
    case "check":
      return { kind, name: "", condition: "" };
    case "foreignKey":
      return { kind, name: "", columns: [], table: "", references: [], onDelete: "NO ACTION" };
  }
}

/** The fields of a foreign key: its table, the columns it references, and its delete rule. */
function ForeignFields({
  c,
  onConstraint,
  n,
}: {
  readonly c: Extract<ConstraintSpec, { kind: "foreignKey" }>;
  readonly onConstraint: (c: ConstraintSpec) => void;
  readonly n: number;
}) {
  const actions: readonly Action[] = ["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"];
  return (
    <>
      <input
        aria-label={`Table referenced by constraint ${String(n)}`}
        placeholder="SCHEMA.TABLE"
        value={c.table}
        onChange={(e) => {
          onConstraint({ ...c, table: e.target.value });
        }}
      />
      <input
        aria-label={`Columns referenced by constraint ${String(n)}`}
        placeholder="its key, or columns"
        value={c.references.join(", ")}
        onChange={(e) => {
          onConstraint({ ...c, references: listed(e.target.value) });
        }}
      />
      <select
        aria-label={`On delete of constraint ${String(n)}`}
        value={c.onDelete}
        onChange={(e) => {
          onConstraint({ ...c, onDelete: e.target.value as Action });
        }}
      >
        {actions.map((a) => (
          <option key={a} value={a}>
            ON DELETE {a}
          </option>
        ))}
      </select>
    </>
  );
}

/** The choice of a constraint's kind. */
function KindChoice({
  c,
  n,
  onConstraint,
}: {
  readonly c: ConstraintSpec;
  readonly n: number;
  readonly onConstraint: (c: ConstraintSpec) => void;
}) {
  return (
    <select
      aria-label={`Kind of constraint ${String(n)}`}
      value={c.kind}
      onChange={(e) => {
        onConstraint({ ...blankConstraint(e.target.value as ConstraintSpec["kind"]), name: c.name });
      }}
    >
      <option value="primaryKey">Primary key</option>
      <option value="unique">Unique</option>
      <option value="check">Check</option>
      <option value="foreignKey">Foreign key</option>
    </select>
  );
}

/** The fields of one constraint, `n` its place from 1. */
export function ConstraintFields({
  c,
  n,
  onConstraint,
}: {
  readonly c: ConstraintSpec;
  readonly n: number;
  readonly onConstraint: (c: ConstraintSpec) => void;
}) {
  const of = ` of constraint ${String(n)}`;
  return (
    <span className="constraint-fields">
      <KindChoice c={c} n={n} onConstraint={onConstraint} />
      <Text
        label={`Name${of}`}
        placeholder="its name, or none"
        value={c.name}
        onValue={(name) => {
          onConstraint({ ...c, name });
        }}
      />
      {c.kind === "check" ? (
        <Text
          label={`Condition${of}`}
          placeholder="a search condition"
          value={c.condition}
          onValue={(condition) => {
            onConstraint({ ...c, condition });
          }}
        />
      ) : (
        <Text
          label={`Columns${of}`}
          placeholder="A, B"
          value={c.columns.join(", ")}
          onValue={(v) => {
            onConstraint({ ...c, columns: listed(v) });
          }}
        />
      )}
      {c.kind === "foreignKey" && <ForeignFields c={c} n={n} onConstraint={onConstraint} />}
    </span>
  );
}

/** The constraints of a table made: each its fields, or removed; one added. */
export function ConstraintsEditor(props: {
  readonly columns: readonly string[];
  readonly constraints: readonly ConstraintSpec[];
  readonly onConstraints: (c: readonly ConstraintSpec[]) => void;
}) {
  const { constraints, onConstraints } = props;
  return (
    <fieldset>
      <legend>Constraints of the table</legend>
      <ol>
        {constraints.map((c, i) => (
          <li key={String(i)}>
            <ConstraintFields
              c={c}
              n={i + 1}
              onConstraint={(d) => {
                onConstraints(constraints.map((e, j) => (j === i ? d : e)));
              }}
            />
            <button
              type="button"
              aria-label={`Remove constraint ${String(i + 1)}`}
              onClick={() => {
                onConstraints(constraints.filter((_, j) => j !== i));
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => {
          onConstraints([...constraints, blankConstraint("check")]);
        }}
      >
        Add Constraint
      </button>
      <p className="hint">Columns: {props.columns.join(", ") || "none yet"}</p>
    </fieldset>
  );
}
