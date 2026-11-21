# Results

[Contents](README.md)

The **Results** pane of a worksheet ([Worksheets](05-worksheets.md))
shows the rows of each statement that gave rows. A script of several
statements gives a result of each, a tab of each; the tab chosen is the
result shown. A result shows the rows read so far: Studio reads a query
a page of 500 rows at a time, and leaves the rest on the server until
they are asked for.

Above a result is its toolbar, and under the toolbar, for a query, its
filter. Below it the bar says how many rows are read, whether more are
to be read, how long the statement took, as the window measured it, and
whether the result is sorted or filtered or has columns frozen. **Read
more** reads the next page.

## The grid

The grid draws only the rows and columns in view, so a result of any
size scrolls as a small one does. As it scrolls within 100 rows of the
last row read, the next page is read.

- Each column's header gives its name, or its place in parentheses if
  it has none, and below the name its declared type, as SQL writes it.
- Numbers are set to the right; a null is written NULL, in the muted
  colour.
- The grid draws at most the first 500 characters of a value; the value
  viewer shows it whole.
- Each row is numbered at its left. A click selects a cell; a drag, or a
  click with Shift, a range of cells; a click on a row's number, its row.
- A column is as wide as its name, its type and its first 100 values
  need, from 60 to 320 pixels; its header's edge is dragged to make it
  wider or narrower.
- Cmd+C, on macOS, or Ctrl+C, elsewhere, copies the cells selected as
  text, tab-separated; the toolbar's **Copy** copies in other formats.

## Sorting and filtering

A result is sorted and filtered on the server, so the order and the
filter are those of every row, not only of the rows read.

- A click on a column's header sorts by it, ascending; a second click,
  descending; a third, no longer by it. A click with Shift sorts by the
  column after those it is sorted by already; each header then shows
  its column's place in the order, as `▲1` or `▼2`.
- The filter, after WHERE, is a search condition of the result's
  columns, applied by Return, as `NAME LIKE 'A%'` or `ID > 1`.
- A cell's menu, opened by the secondary button, filters to its value
  (**Filter to This Value**) or out of it (**Filter Out This Value**), the
  condition added to the filter by AND. A null is matched by IS NULL;
  a large object is not compared.
- **Clear Filter and Sort** runs the query as it was written.

Each is done by running the query again within one that sorts and
filters it. Of a result of `SELECT * FROM T -- the rows` of the columns
ID, NAME and PRICE, sorted by NAME descending then by ID, and filtered by
`ID > 1`, Studio runs:

```sql
SELECT * FROM (
SELECT * FROM T -- the rows
) AS "Q" ("ID", "NAME", "PRICE")
WHERE ID > 1
ORDER BY "NAME" DESC, "ID"
```

Within it each column has its own name, but a column of no name, or of
a name another column has, is named by its place from 1, so the
condition `"2" > 0` reads the second column. The query runs through the
connection's guards as any statement does, with the values its
parameters were given, and is not kept in the history. Only a query is
sorted and filtered: a SELECT, VALUES, TABLE or WITH, or a query in
parentheses. Until the new rows come, the result keeps the rows it has;
if the query fails, it keeps them, and the messages pane says why.

## Views

The toolbar's first group chooses how a result is shown:

| View | What it shows |
|---|---|
| **Grid View** | the rows, in the grid |
| **Text View** | the rows read as text, each column as wide as its widest value, at most 60 characters, numbers to the right, the count of rows below |
| **Record View** | one row as a form, each column's name, type and value on a line of its own; **Previous Row** and **Next Row** move through the rows read |
| **Graph View** | the rows as nodes and edges ([Graphs](#graphs)) |
| **Plane View** | a spatial column's values on a plane, offered where the result has one ([Spatial values](#spatial-values)) |

A cell's menu also opens its row in the record view (**Show in Record
View**), and keeps columns in view as the grid scrolls across: **Freeze
Up to This Column** freezes each column from the first to the cell's,
and **Unfreeze Columns** lets them go.

## The status bar

While cells are selected, the status bar tells of them: how many hold a
value, of how many are selected, and, if the values are all numbers,
their sum, average, least and greatest:

```
Count 2 of 2 · Sum 3 · Average 1.5 · Min 1 · Max 2
```

Exact numbers, of INTEGER, DECIMAL and the other exact types, are summed
exactly, every digit kept; their average has six digits more than the
numbers have, rounded half away from zero, its trailing zeros let go.
Approximate numbers, of REAL, DOUBLE PRECISION, FLOAT and DECFLOAT, and
exact and approximate numbers together, are summed as floating-point
numbers. Of values that are not numbers, the count alone is told.

## The value viewer

**Value Viewer** opens a panel beside the rows that shows the cell
selected. Its tabs are the viewers that may show the value, the one that
shows it best first, chosen by the column's declared type, then by what
the value's text is:

| Viewer | What it shows |
|---|---|
| **Text** | the value as text, its lines wrapped or not |
| **JSON** | a JSON value as a tree, each object and array opened or closed |
| **XML** | an XML value laid out, a node a line, indented by its depth; never rendered |
| **Hex** | a binary string or binary large object as a dump, each line its offset, sixteen octets, and those of them that are printable; the first 64 KiB |
| **Image** | a binary value that is a PNG, JPEG, GIF, BMP or WebP image; never SVG, which may hold script |
| **Plane** | a geometry's points, lines and polygons ([Spatial values](#spatial-values)) |
| **Vector** | a vector's dimension count, its norm, its least and greatest elements, a bar of each element, and a table of them |
| **Path** | a path, as PATH_TO_JSON writes one, as nodes and edges ([Graphs](#graphs)) |

A large object longer than its row holds is sent by its locator, and its
cell says what it is, as `<CHARACTER LARGE OBJECT of 90000 characters>`.
The viewer reads it whole, at most its first 16 MiB, and says so if it
is longer. A locator holds while its transaction lasts, or, under
autocommit, while its result is open; read after, the viewer says that
the value could not be read, and why.

## Spatial values

A value of GEOMETRY or of one of the ST_ types, or text that is a
geometry's well-known text, is drawn on a plane: x to the east and y to
the north, scaled to fit, the least and greatest x and y given below.
Points, lines and polygons are drawn, a polygon's holes left open, and
each member of a collection; a curve is drawn through the points it is
written by, and a value's Z and M are not drawn. The result's **Plane
View** draws every row read of the column chosen, the selected row's in
the colour of running. Nothing is drawn under the values: the tiles of a
map are remote content, which Studio never loads.

## Graphs

The **Graph View** draws a result's rows as nodes and edges, laid out
from left to right, in one of two ways:

- **Paths**: each value of the column chosen is a path, as PATH_TO_JSON
  writes one, each vertex a node, labelled by its table and key, and
  each edge an edge between the vertices it joins, labelled the same
  way. Of `PATH_TO_JSON(p)` of a path from account a1 through a2 to a3,
  the nodes are ACCOUNT a1, ACCOUNT a2 and ACCOUNT a3, and the edges
  TRANSFER t1 and TRANSFER t2.
- **Edges from column to column**: each row is an edge from its value of
  the column **From** to its value of the column **To**, each value a
  node, labelled by its value of the column **Label** if one is chosen.
  A row of a null at either end draws no edge.

A result is read as paths if the first row that holds a value holds a
path; else, of two columns or more, from its first column to its
second. At most 500 nodes
are drawn. A node is dragged to move it.

## Copying

The toolbar's **Copy** copies the cells selected, or every row read if
none is, in the format **Copy as** chooses, the columns' names as its
header if **Headers** is ticked:

| Format | What it writes |
|---|---|
| **CSV** | a record of each row, its fields between commas, each quoted where it must be, a null empty, as an export writes CSV |
| **Tab-Separated** | a line of each row, its fields between tabs, a field quoted only where it holds a tab, a quote or a line's end |
| **JSON** | an array of objects, one a row, each keyed by its columns' names; numbers, truth values and JSON values as JSON's own, the rest as strings |
| **Markdown** | a table, each bar in a value escaped; without headers, the columns' places head it |
| **INSERT Statements** | an INSERT of each row, each value a literal of its column's type |

Of the columns ID, NAME and PRICE, a row of `1`, `Ada, Countess` and
`10.50` is copied as CSV, with headers, as:

```
ID,NAME,PRICE
1,"Ada, Countess",10.50
```

and, of a result of `SELECT * FROM ANN.ITEMS`, as an INSERT:

```sql
INSERT INTO "ANN"."ITEMS" ("ID", "NAME", "PRICE") VALUES (1, 'Ada, Countess', 10.50);
```

An INSERT inserts into the one table the query reads, or into RESULT if
it reads none or several. A large object is not copied as a value, as
its cell holds only what it is.

## Exporting

**Export as CSV…** and **Export as Native Rows…** run the result's
query again, sorted and filtered as it is, and write its rows to the
file the platform's dialog chooses, as they come, none of them held in
the window. A CSV file has a header of the columns' names, then a record
of each row. A native rows file, of the extension `.rows`, holds
Turborel's own frames, every value as it was, as turborel-client reads
them back. Only a query is exported, and not one of parameters: its
values are written in it instead.

**Worksheet > Run to CSV File…** and **Run to Native Rows File…** run
the statement at the cursor, or the selection's first, straight to a
file, its rows never shown. A statement of parameters, or of script
variables with no value, is not run so.

## Pinning and comparing

**Pin Result** pins the result's tab: the worksheet's next run leaves it
open and its rows readable, and the new results come in tabs beside it.
A pinned tab has a pin and a close button; **Unpin Result** lets it go
with the next run.

**Compare with…** compares the result with another of the worksheet's,
row by row, of the rows read of each: each row of one is matched with an
equal row of the other, as often as both have it. The comparison says
how many rows are in both, in this result alone and in the other alone,
whether the two have different columns, by name or type, and lists the
rows, those of both first, each marked by where it is.

## Timings

The **Timings** pane lists each statement the worksheet has run, the
latest first: when it ran, its connection, its statement's first line,
its rows, its time in the window and on the server, and how it compares
with the run of the same statement on the same connection before it, as
`50% slower` or `25% faster`, by the server's time where the server
gives it, else by the window's. A run that failed is marked so. **Clear
Timings** forgets them.

## Autocommit and a result's transaction

Under autocommit a query's transaction lasts while its result has rows
to read, and ends as its last row is read or the result is closed, as
the server ends it, and the status bar then says so. A result is closed
as the worksheet runs again, unless it is pinned, or as its tab is
closed.
