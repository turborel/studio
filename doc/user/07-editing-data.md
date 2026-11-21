# Editing Data

[Contents](README.md)

A table's rows are edited in a worksheet's results, each change staged
until it is applied, all of them then in one transaction. A file's rows
are imported into a table, a table's rows exported to a file, and two
tables' rows compared. A table is made, or altered, by a dialog that
writes its DDL as it is filled in. A base table's details, in the
explorer, offer each of its tasks, and a schema's details **Create
Table…** and **Generate Script…**:

| Action | What it does |
|---|---|
| **Edit Rows…** | opens the table's first rows, or those a condition keeps, in a worksheet of their own, to be edited |
| **Import…** | imports the rows of a CSV or tab-separated file into the table |
| **Export…** | exports the table's rows, or those a condition keeps, to a file |
| **Compare Rows…** | compares the table's rows with another table's, and writes the statements that make the other's rows the same |
| **Alter Table…** | alters the table, an action of ALTER TABLE at a time |
| **Create Table…** | makes a table in the schema |
| **Generate Script…** | writes the definitions of the schema's objects chosen, in a worksheet |

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

## Comparing rows

**Compare Rows…** compares the table's rows, the source's, with those of
a target: a table of any open connection, its schema and its name the
source's at first. Rows are matched by the target's key, its primary key
or a unique key of NOT NULL columns, which the source must have too, and
compared by the columns both tables have, as the target types them; a
large object is not compared. Each table is read whole, in its key's
order, a page at a time, at most 100,000 rows of each, and values are
compared as their text.

**Compare** says how many rows are the same, and how many the target
must have inserted, updated and deleted to be the same as the source.
**Open Script in Worksheet** opens the statements that make it so, in a
worksheet of the target's connection, to be read and run there: an
UPDATE of the columns that differ of each row of both, an INSERT of each
row the target lacks, and a DELETE of each row the source lacks, each
value a literal of its column's type ([Results](06-results.md#copying)):

```sql
UPDATE "ANN"."PRICES_COPY" SET "NAME" = 'Ink''s', "PRICE" = 3.00 WHERE "ID" = 2;
INSERT INTO "ANN"."PRICES_COPY" ("ID", "NAME", "PRICE") VALUES (4, 'Pad', NULL);
DELETE FROM "ANN"."PRICES_COPY" WHERE "ID" = 3;
```

## Making and altering tables

**Create Table…** makes a table in the schema. Its form gives the
table's name; its columns, each with its name, its type, chosen from
Turborel's types or written, whether it is NOT NULL, its default, as SQL
writes it, and whether it is the primary key or unique; and the table's
constraints, each a primary key, unique, a check or a foreign key, of a
name or none. A column is moved up, removed or added; a constraint
removed or added. As it is filled in, the dialog shows the CREATE TABLE
it writes ([CREATE TABLE](https://github.com/turborel/turborel/blob/main/doc/sql/statements/create-table.md)),
each name as Turborel reads it back, bare where it is a regular
identifier in upper case and not reserved, else in quotes; each type,
default and condition as written:

```sql
CREATE TABLE ANN.DEPT (
    ID INTEGER NOT NULL PRIMARY KEY,
    NAME VARCHAR(20) DEFAULT 'none' UNIQUE
);
```

**Alter Table…** alters the table, ALTER TABLE taking one action a
statement ([ALTER TABLE](https://github.com/turborel/turborel/blob/main/doc/sql/statements/alter-table.md)).
An action is chosen, its fields filled in, and **Add to Script** adds its
statement to the script; an action added is removed by its **Remove**:

| Action | What it writes |
|---|---|
| **Add Column** | `ADD COLUMN` of the column defined |
| **Drop Column** | `DROP COLUMN` of the column chosen, RESTRICT or CASCADE |
| **Rename Column** | `RENAME COLUMN … TO` its new name |
| **Set Default**, **Drop Default** | `ALTER COLUMN … SET DEFAULT` or `DROP DEFAULT` |
| **Set NOT NULL**, **Drop NOT NULL** | `ALTER COLUMN … SET NOT NULL` or `DROP NOT NULL` |
| **Set Data Type** | `ALTER COLUMN … SET DATA TYPE`, a longer or more precise type of its kind |
| **Add Constraint** | `ADD` of the constraint defined |
| **Drop Constraint** | `DROP CONSTRAINT` of the constraint chosen, RESTRICT or CASCADE |
| **Rename Table** | `RENAME TO` its new name |

```sql
ALTER TABLE ANN.STAFF2 ADD COLUMN NOTE VARCHAR(10) DEFAULT 'x' NOT NULL;
ALTER TABLE ANN.STAFF2 ALTER COLUMN NOTE SET DATA TYPE VARCHAR(40);
ALTER TABLE ANN.STAFF2 RENAME COLUMN NOTE TO REMARK;
```

Either dialog's **Open in Worksheet** opens its DDL in a worksheet of the
connection, to be read, changed and run there; **Run** opens it and runs
it at once. It runs as any script does, through the connection's guards,
in the session's transaction, and the explorer reads the catalog again
after it.

## Generating a script

**Generate Script…** lists the schema's objects, each chosen at first:
its user-defined types, domains, sequence generators, base tables,
views and routines, in that order. **Choose None** and **Choose All**
choose them together. **Open in Worksheet** opens, in a worksheet of
the connection, the definition of each object chosen, as the explorer's
**Definition** writes it ([The Object Explorer](04-explorer.md#the-definition)),
in that order, a blank line between each.
