/**
 * The types the table dialogs offer as a column's type is written
 * (RULES.md D44), of Turborel's data types
 * ([DOC sql/02-data-types.md Data Types]); any other may be written.
 */
export const TYPE_CHOICES: readonly string[] = [
  "INTEGER",
  "SMALLINT",
  "BIGINT",
  "DECIMAL(10,2)",
  "NUMERIC(10,2)",
  "REAL",
  "DOUBLE PRECISION",
  "DECFLOAT",
  "BOOLEAN",
  "CHARACTER(10)",
  "VARCHAR(100)",
  "CLOB(1M)",
  "BINARY(16)",
  "VARBINARY(100)",
  "BLOB(1M)",
  "DATE",
  "TIME",
  "TIMESTAMP",
  "TIMESTAMP WITH TIME ZONE",
  "INTERVAL DAY TO SECOND",
  "UUID",
  "JSON",
  "XML",
  "GEOMETRY",
];
