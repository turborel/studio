# Editing Data

[Contents](README.md)

A table's rows are edited in a worksheet's results, each change staged
until it is applied, all of them then in one transaction. A file's rows
are imported into a table, and a table's rows exported to a file. A
base table's details, in the explorer, offer each:

| Action | What it does |
|---|---|
| **Edit Rows…** | opens the table's first rows, or those a condition keeps, in a worksheet of their own, to be edited |
| **Import…** | imports the rows of a CSV or tab-separated file into the table |
| **Export…** | exports the table's rows, or those a condition keeps, to a file |

## Editing rows

**Edit Rows…** asks how many rows, 200 at first, and a condition of the
table's columns, and opens a worksheet of the query that reads them:

```sql
SELECT * FROM "ANN"."STAFF" WHERE ID > 1 FETCH FIRST 50 ROWS ONLY
```

The query is run, and its rows are opened to be edited. The rows of any
result are edited too, by the result's **Edit Rows**, where its query
reads one base table, by its name or the session's schema's, and the
result holds each column of the table's key: its primary key, or else a
unique key of columns none of which takes null. Each of the result's
columns is the table's column of its name.

While the rows are edited:

- A cell is edited in place, as text, as the grid shows it: a binary
  value in hexadecimal digits ([Worksheets](05-worksheets.md#parameters-and-script-variables)).
  A cell's menu sets it to NULL (**Set to NULL**). A cell changed, and a
  row added, are drawn in the colour of a selection.
- A generated column, an identity column whose values are always
  generated, a column of no column of the table, and a large object not
  sent whole in its row are not edited.
- **Add Row** adds a row at the end, each of its columns written
  DEFAULT, taking its default, until it is given a value.
- **Remove Rows Selected** marks the rows selected removed, their text
  in the colour of danger, or, of rows marked, unmarks them; a row added
  is let go.
- The tools say how many changes are staged: each cell changed, each
  row added and each row removed.
- **Review Changes…** shows the statements the changes make, each
  value a parameter, the values after it.
- **Revert Changes** lets every change go; **Stop Editing** ends the
  editing and lets them go.

Of the table ITEMS, of the key ID, a row removed, a cell changed and a row
added make:

```sql
DELETE FROM "ANN"."ITEMS" WHERE "ID" = ?;
-- "3"
UPDATE "ANN"."ITEMS" SET "NAME" = ? WHERE "ID" = ?;
-- "Quill", "1"
INSERT INTO "ANN"."ITEMS" ("NAME") VALUES (?);
-- "Pad"
```

A row removed is deleted; a row changed is updated, of its columns
changed alone, found by its key as it was read; a row added is inserted,
of the columns given values, or by DEFAULT VALUES if none is.

**Apply Changes** runs the statements. The connection's guards judge them
together first, and ask as they ask of a script
([Connections](03-connections.md#environments-and-guards)). They run in
a transaction of their own, under autocommit too, which is committed if
each UPDATE and DELETE changed exactly one row, and rolled back if one
did not, as when the row changed since it was read, or if a statement
fails: then nothing is kept, the messages pane says why, and the changes
stay staged. If the session already has a transaction active, they run
within it, and it is left to be committed or rolled back. Once applied,
the query is run again, to show the rows as they are.

## Importing

**Import…** opens the platform's dialog to choose a file, a `.csv`,
`.tsv` or `.txt` file, and shows its first 20 records as it is read:

- **Format**: CSV, its fields between commas and quoted as they need, or
  tab-separated, its fields between tabs and never quoted.
- **First record names the fields**: the file's first record is its
  header.
- **Delimiter**: another character between fields, one ASCII character,
  not a quote or a line break.
- **Null is written**: the text a field not in quotes is written as to
  be null; an empty field is null, if nothing is written here.

Above each field a choice gives the column it goes into, or **Skip**. A
field goes at first into the column its heading names, as a name is
read in SQL, a regular identifier in upper case, or else into the
column of its name in any case; of a file of no header, into the column
of its place.

**Commit each … rows** commits the rows a batch at a time, 1000 at
first, or all at once for 0. **Skip a row refused, and tell it** skips a
row the server refuses, or of too many or too few fields, and goes on;
otherwise the first ends the import. **Import** asks the connection's
guards first, as of an INSERT into the table, then imports the rows by
copy, where the server grants it and no column is a large object, or by
INSERT, and says how many rows were imported, and which were skipped and
why, the first 100 of them. A file is read a record at a time, so a file
of any size is imported. An import begins with no transaction active,
as it commits its batches; one that stops says where, why, and how many
rows were committed and rolled back.

Studio reads only the file chosen in the dialog.

## Exporting

**Export…** exports the table's rows, or those a condition keeps, as
CSV or as native rows, to the file the platform's dialog chooses, as a
result's export does ([Results](06-results.md#exporting)).
