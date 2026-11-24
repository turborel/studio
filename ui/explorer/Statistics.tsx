/**
 * A table's planner statistics in the details panel (RULES.md D72): its
 * rows now and at the last pass that gathered them, and when; each
 * column's share NULL, distinct values, width, least and greatest values,
 * most common values with their shares, and histogram, a long one cut to
 * a line; and each index's
 * entries, distinct keys and selectivity beside its definition. Read of
 * COLUMN_STATISTICS, TABLE_STATISTICS and INDEX_STATISTICS as the tab is
 * shown; reading them asks for them, so ones not gathered are soon after.
 */
import { useEffect, useState } from "react";
import { catalogStatistics, type Index, type TableStatistics } from "../ipc/catalog";
import { thrownText } from "../model/ModelDialogs";
import { selectivity } from "./selectivity";
import { Table } from "./Details";

/** A figure as shown: its text, or a dash while it is not known. */
function shown(figure: string | null): string {
  return figure ?? "–";
}

/** The most characters of a value or a list of values shown in a cell, so a row of a long histogram stays a line. */
export const BRIEF_CHARS = 40;

/** A value or a list of them as a cell shows it: cut at `BRIEF_CHARS`, a `…` after; a dash while it is not known. */
export function brief(figure: string | null): string {
  const chars = Array.from(figure ?? "–");
  return chars.length > BRIEF_CHARS ? `${chars.slice(0, BRIEF_CHARS).join("")}…` : chars.join("");
}

/** What the statistics say of the table as a whole: its rows, and when they were last gathered. */
function said(s: TableStatistics): string {
  if (s.columns.length === 0) {
    return "None of the table's columns is shown to you, so neither are its statistics.";
  }
  if (s.gatheredRows === null) {
    return `Not yet gathered: the planner estimates by its defaults meanwhile; reading them asks for them, so they are gathered soon. Rows now: ${shown(s.rows)}.`;
  }
  return `Gathered of ${s.gatheredRows} rows${s.gathered === null ? "" : ` at ${s.gathered}`}; rows now: ${shown(s.rows)}${s.lastChanged === null ? "" : `, last changed at ${s.lastChanged}`}.`;
}

/** The statistics of `schema`.`table` on `connection`, read as shown: null until read, or the failure's text. */
function useStatistics(connection: number, schema: string, table: string): TableStatistics | string | null {
  const [found, setFound] = useState<TableStatistics | string | null>(null);
  useEffect(() => {
    let current = true;
    catalogStatistics(connection, schema, table).then(
      (s) => {
        if (current) {
          setFound(s);
        }
      },
      (thrown: unknown) => {
        if (current) {
          setFound(thrownText(thrown));
        }
      },
    );
    return () => {
      current = false;
    };
  }, [connection, schema, table]);
  return found;
}

/** Each column's statistics. */
function Columns({ statistics }: { readonly statistics: TableStatistics }) {
  return (
    <Table
      label="Column statistics"
      headings={[
        "Column",
        "Null share",
        "Distinct",
        "Width",
        "Least",
        "Greatest",
        "Most common",
        "Their shares",
        "Histogram",
      ]}
      rows={statistics.columns.map((c) => [
        c.name,
        shown(c.nullFraction),
        shown(c.distinctValues),
        shown(c.averageWidth),
        brief(c.minValue),
        brief(c.maxValue),
        brief(c.mostCommon),
        brief(c.frequencies),
        brief(c.histogram),
      ])}
    />
  );
}

/** Each index's entries, distinct keys and selectivity, beside its definition of `indexes`. */
function Indexes({
  statistics,
  indexes,
}: {
  readonly statistics: TableStatistics;
  readonly indexes: readonly Index[];
}) {
  const definition = (name: string) => {
    const i = indexes.find((x) => x.name === name);
    return i === undefined ? "" : `${i.unique ? "UNIQUE " : ""}${i.method} (${i.columns.join(", ")})`;
  };
  return (
    <Table
      label="Index statistics"
      headings={["Index", "Definition", "Entries", "Distinct keys", "Selectivity"]}
      rows={statistics.indexes.map((i) => [
        i.name,
        definition(i.name),
        shown(i.entries),
        shown(i.distinctKeys),
        selectivity(i) || "–",
      ])}
    />
  );
}

/** A table's statistics, its columns and its indexes, read as shown; `indexes` its indexes' definitions. */
export function Statistics(props: {
  readonly connection: number;
  readonly schema: string;
  readonly table: string;
  readonly indexes: readonly Index[];
}) {
  const found = useStatistics(props.connection, props.schema, props.table);
  if (typeof found === "string" || found === null) {
    return <p className="hint">{found ?? "Reading…"}</p>;
  }
  return (
    <>
      <p>{said(found)}</p>
      <Columns statistics={found} />
      <Indexes statistics={found} indexes={props.indexes} />
    </>
  );
}
