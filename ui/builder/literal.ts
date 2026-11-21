/**
 * A value written in the query builder as a literal of its column's type
 * (RULES.md D48): a number bare, text quoted, any other type cast from
 * its text.
 */
import { literal } from "../results/literals";

/** `value`, as written, as a literal of a column of `type`. */
export function literalOf(value: string, type: string): string {
  return (
    literal(value, { name: null, typeWritten: type, typeName: null, notNull: false }) ??
    `'${value.replaceAll("'", "''")}'`
  );
}
