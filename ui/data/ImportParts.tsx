/**
 * The parts of the import wizard (RULES.md D43, D63, D68): how the file
 * is read, as its format's plug-in takes it, the fields and their columns with each cast and conflict shown,
 * a new table's columns, the error policy, and the import's progress and
 * report.
 */
import type { ReactNode } from "react";
import type { Column } from "../ipc/catalog";
import type { FormatInfo, ImportProgress, ImportReport, Preview, Reading } from "../ipc/data";
import { castNote, type NewColumn, type Policy } from "./importing";
import { TYPE_CHOICES } from "./typeChoices";

/** A labelled text input of a reading, empty for none. */
function TextChoice(props: {
  readonly label: string;
  readonly value: string | null;
  readonly size: number;
  readonly onValue: (v: string | null) => void;
}) {
  return (
    <label>
      {props.label}{" "}
      <input
        type="text"
        size={props.size}
        maxLength={props.size === 2 ? 1 : undefined}
        value={props.value ?? ""}
        onChange={(e) => {
          props.onValue(e.target.value === "" ? null : e.target.value);
        }}
      />
    </label>
  );
}

/** The format, of the backend's plug-ins, and the choices of a delimited file or a workbook. */
function FormatChoices(props: {
  readonly formats: readonly FormatInfo[];
  readonly reading: Reading;
  readonly sheets: readonly string[] | null;
  readonly onReading: (r: Reading) => void;
}) {
  const { reading, onReading } = props;
  return (
    <>
      <label>
        Format{" "}
        <select
          value={reading.format}
          onChange={(e) => {
            const format = props.formats.find((f) => f.id === e.target.value)?.id ?? reading.format;
            onReading({ ...reading, format, sheet: null });
          }}
        >
          {props.formats.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      {props.sheets !== null && (
        <label>
          Sheet{" "}
          <select
            value={reading.sheet ?? props.sheets[0] ?? ""}
            onChange={(e) => {
              onReading({ ...reading, sheet: e.target.value });
            }}
          >
            {props.sheets.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

/** The choices of how a file is read, as its format takes them: its format, its header, and a delimited file's delimiter and null. */
export function ReadingChoices(props: {
  readonly formats: readonly FormatInfo[];
  readonly reading: Reading;
  readonly sheets: readonly string[] | null;
  readonly onReading: (r: Reading) => void;
}) {
  const { reading, onReading } = props;
  const takes = props.formats.find((f) => f.id === reading.format)?.takes;
  const delimited = takes?.delimited === true;
  return (
    <fieldset className="import-reading">
      <legend>How the file is read</legend>
      <FormatChoices formats={props.formats} reading={reading} sheets={props.sheets} onReading={onReading} />
      {takes?.header === true && (
        <label>
          <input
            type="checkbox"
            checked={reading.header}
            onChange={(e) => {
              onReading({ ...reading, header: e.target.checked });
            }}
          />{" "}
          First record names the fields
        </label>
      )}
      {delimited && (
        <>
          <TextChoice
            label="Delimiter"
            size={2}
            value={reading.delimiter}
            onValue={(delimiter) => {
              onReading({ ...reading, delimiter });
            }}
          />
          <TextChoice
            label="Null is written"
            size={6}
            value={reading.null}
            onValue={(v) => {
              onReading({ ...reading, null: v });
            }}
          />
        </>
      )}
    </fieldset>
  );
}

/** A heading cell of field `i`: its name, and what is chosen of it below. */
function FieldHeading(props: { readonly preview: Preview; readonly at: number; readonly children: ReactNode }) {
  return (
    <th scope="col">
      <span>{props.preview.headings?.[props.at] ?? `Field ${String(props.at + 1)}`}</span>
      {props.children}
    </th>
  );
}

/** The first records under their fields. */
function Records({ preview, width }: { readonly preview: Preview; readonly width: number }) {
  return (
    <tbody>
      {preview.records.map((r, i) => (
        <tr key={String(i)}>
          {Array.from({ length: width }, (_, j) => (
            <td key={String(j)} className={r[j] === null || r[j] === undefined ? "null" : undefined}>
              {r[j] ?? "NULL"}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

/** The column a field goes into, and its cast and conflict. */
function FieldColumn(props: {
  readonly preview: Preview;
  readonly at: number;
  readonly columns: readonly Column[];
  readonly field: string | null;
  readonly onField: (column: string | null) => void;
}) {
  const column = props.columns.find((c) => c.name === props.field);
  const inferred = props.preview.inferred[props.at];
  const note = column === undefined || inferred === undefined ? null : castNote(inferred, column);
  return (
    <FieldHeading preview={props.preview} at={props.at}>
      <select
        aria-label={`Column of field ${String(props.at + 1)}`}
        value={props.field ?? ""}
        onChange={(e) => {
          props.onField(e.target.value === "" ? null : e.target.value);
        }}
      >
        <option value="">Skip</option>
        {props.columns.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
      {note !== null && note.cast !== "" && <small className="hint">{note.cast}</small>}
      {note?.conflict != null && <small className="error">{note.conflict}</small>}
    </FieldHeading>
  );
}

/** The fields' columns of an existing table, and the first records under them. */
export function Fields(props: {
  readonly preview: Preview;
  readonly columns: readonly Column[];
  readonly fields: readonly (string | null)[];
  readonly onFields: (fields: (string | null)[]) => void;
}) {
  const { fields } = props;
  return (
    <table className="result-table" aria-label="Preview">
      <thead>
        <tr>
          {fields.map((f, i) => (
            <FieldColumn
              key={String(i)}
              preview={props.preview}
              at={i}
              columns={props.columns}
              field={f}
              onField={(column) => {
                props.onFields(fields.map((g, j) => (j === i ? column : g)));
              }}
            />
          ))}
        </tr>
      </thead>
      <Records preview={props.preview} width={fields.length} />
    </table>
  );
}

/** A new table's column of a field: whether it is made, its name and its type. */
function NewColumnHeading(props: {
  readonly preview: Preview;
  readonly column: NewColumn;
  readonly onColumn: (c: NewColumn) => void;
}) {
  const { column, onColumn } = props;
  const n = String(column.field + 1);
  return (
    <FieldHeading preview={props.preview} at={column.field}>
      <label>
        <input
          type="checkbox"
          aria-label={`Make a column of field ${n}`}
          checked={column.included}
          onChange={(e) => {
            onColumn({ ...column, included: e.target.checked });
          }}
        />
      </label>
      <input
        type="text"
        aria-label={`Name of field ${n}'s column`}
        value={column.name}
        onChange={(e) => {
          onColumn({ ...column, name: e.target.value });
        }}
      />
      <input
        type="text"
        list="import-types"
        aria-label={`Type of field ${n}'s column`}
        value={column.type}
        onChange={(e) => {
          onColumn({ ...column, type: e.target.value });
        }}
      />
    </FieldHeading>
  );
}

/** A new table's columns, one a field, each named and typed, and the first records under them. */
export function NewColumns(props: {
  readonly preview: Preview;
  readonly columns: readonly NewColumn[];
  readonly onColumns: (columns: NewColumn[]) => void;
}) {
  const { columns } = props;
  return (
    <table className="result-table" aria-label="Preview">
      <datalist id="import-types">
        {TYPE_CHOICES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <thead>
        <tr>
          {columns.map((c, i) => (
            <NewColumnHeading
              key={String(c.field)}
              preview={props.preview}
              column={c}
              onColumn={(changed) => {
                props.onColumns(columns.map((d, j) => (j === i ? changed : d)));
              }}
            />
          ))}
        </tr>
      </thead>
      <Records preview={props.preview} width={columns.length} />
    </table>
  );
}

/** A radio button of the group `name`, labelled by its children. */
function Radio(props: { readonly checked: boolean; readonly onChoose: () => void; readonly children: ReactNode }) {
  return (
    <label>
      <input type="radio" name="refused" checked={props.checked} onChange={props.onChoose} /> {props.children}
    </label>
  );
}

/** The rows a batch commits. */
function BatchChoice(props: { readonly batch: number; readonly onBatch: (batch: number) => void }) {
  return (
    <label>
      Commit each{" "}
      <input
        type="number"
        min={0}
        value={props.batch}
        onChange={(e) => {
          props.onBatch(Math.max(0, Math.trunc(Number(e.target.value)) || 0));
        }}
      />{" "}
      rows, 0 for all at once
    </label>
  );
}

/** The choices of the rows a batch commits, and of what a row refused does. */
export function PolicyChoices(props: {
  readonly batch: number;
  readonly policy: Policy;
  readonly onBatch: (batch: number) => void;
  readonly onPolicy: (policy: Policy) => void;
}) {
  const { policy, onPolicy } = props;
  const rows = policy.kind === "limit" ? policy.rows : 100;
  const choose = (next: Policy) => () => {
    onPolicy(next);
  };
  return (
    <fieldset>
      <legend>Loading</legend>
      <BatchChoice batch={props.batch} onBatch={props.onBatch} />
      <Radio checked={policy.kind === "stop"} onChoose={choose({ kind: "stop" })}>
        Stop at the first row refused
      </Radio>
      <Radio checked={policy.kind === "skip"} onChoose={choose({ kind: "skip" })}>
        Skip a row refused, and tell it
      </Radio>
      <Radio checked={policy.kind === "limit"} onChoose={choose({ kind: "limit", rows })}>
        Skip at most{" "}
        <input
          type="number"
          min={0}
          aria-label="Rows that may be skipped"
          value={rows}
          onChange={(e) => {
            onPolicy({ kind: "limit", rows: Math.max(0, Math.trunc(Number(e.target.value)) || 0) });
          }}
        />{" "}
        rows refused, then stop
      </Radio>
    </fieldset>
  );
}

/** How far the import has come. */
export function ImportProgressView({ progress }: { readonly progress: ImportProgress | null }) {
  return (
    <div role="status" aria-label="Progress">
      <progress
        max={1}
        value={progress === null || progress.total === 0 ? 0 : Math.min(1, progress.read / progress.total)}
      />
      <p>
        {progress === null
          ? "Starting…"
          : `${progress.records.toLocaleString()} records read, ${progress.rejected.toLocaleString()} skipped.`}
      </p>
    </div>
  );
}

/** What an import did. */
export function ImportReportView({ report }: { readonly report: ImportReport }) {
  const rows = `${String(report.rows)} row${report.rows === 1 ? "" : "s"}`;
  const said = report.cancelled
    ? `Cancelled: ${rows} imported; the ${String(report.rolledBack)} of the batch under way were rolled back.`
    : `Imported ${rows}${report.rejected > 0 ? `; ${String(report.rejected)} skipped:` : "."}`;
  return (
    <div role="status" aria-label="What the import did">
      <p>{said}</p>
      <ul>
        {report.skipped.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </div>
  );
}
