/**
 * The snippets of the editor (RULES.md D36, D40): each its name, what it
 * is and its template, `#{}` a field Tab moves to, offered in the same list
 * as completion's other items.
 */

/** The snippets, each its name, what it is and its template. */
export const SNIPPETS: readonly (readonly [string, string, string])[] = [
  ["sel", "SELECT … FROM … WHERE …", "SELECT #{columns}\nFROM #{table}\nWHERE #{condition}"],
  ["ins", "INSERT INTO … VALUES …", "INSERT INTO #{table} (#{columns})\nVALUES (#{values})"],
  ["upd", "UPDATE … SET … WHERE …", "UPDATE #{table}\nSET #{column} = #{value}\nWHERE #{condition}"],
  ["del", "DELETE FROM … WHERE …", "DELETE FROM #{table}\nWHERE #{condition}"],
  [
    "ct",
    "CREATE TABLE …",
    "CREATE TABLE #{name} (\n    #{column} #{type},\n    CONSTRAINT #{name}_PK PRIMARY KEY (#{column})\n)",
  ],
  ["ci", "CREATE INDEX …", "CREATE INDEX #{name} ON #{table} (#{columns})"],
  ["cv", "CREATE VIEW …", "CREATE VIEW #{name} AS\nSELECT #{columns}\nFROM #{table}"],
  ["with", "WITH … AS (…) SELECT …", "WITH #{name} AS (\n    #{query}\n)\nSELECT #{columns}\nFROM #{name}"],
  ["exp", "EXPLAIN …", "EXPLAIN #{query}"],
];
