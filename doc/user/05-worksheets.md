# Worksheets

[Contents](README.md)

A worksheet is a script of SQL and the connection it runs on. Each opens
as a tab in the centre of the window, its editor above and its results,
messages and plan below; the line between them is dragged, or moved by
the arrow keys when it has the focus, to share the tab between them.

## Opening a worksheet

**File > New Worksheet**, Cmd+N or Ctrl+N, the toolbar's **New
Worksheet**, the **+** after the worksheets' tabs, or the Start panel's
button opens an empty worksheet on the active connection; **New
Worksheet** in the menu of a connection, schema or table in the explorer
opens one on that connection, its schema set
([The Window](02-window.md#context-menus)). **File > Open File…** opens a `.sql` file in a worksheet of
its own; **Favourite Queries**, **Projects** and **File > History…** open
what they hold the same way, and **Open in Worksheet** opens an object's
definition from the details panel ([The Object Explorer](04-explorer.md)).

A worksheet runs on the connection its toolbar's **Connection** names,
which may be changed to any connection open, or to none. A worksheet
kept from an earlier session runs on its saved connection again once that
connection opens; a connection ending leaves its worksheets on none.

## The editor

The editor knows Turborel's SQL: its reserved words, as Turborel's own
lexer reads them, the words its statements read, its types, strings,
delimited identifiers and comments, each in a colour of its own.

- **Describe**: the pointer resting on a table's name, or **Worksheet >
  Describe**, shows its columns and their types.
- **A routine's parameters** are shown as its arguments are written,
  within the parentheses of a call of a routine of the session's schema
  that the explorer has read.
- **Go to Definition** shows, in the details panel, the table, view or
  routine named at the cursor.
- **Bookmarks**: **Toggle Bookmark** marks the cursor's line in the
  gutter; **Next Bookmark** and **Previous Bookmark** move between them,
  round from the last to the first.
- **Folding**: a statement of more than one line folds from its first
  line, by the gutter's arrow or the editor's keys.
- **Outline** lists the script's statements, each by its first line; a
  click selects it.
- **Split Editor** shows the worksheet's text twice, one view above the
  other, each change made in one made in the other.
- **Find and Replace…** opens the editor's search, of text or of a
  regular expression, its case matched or not.
- **Toggle Comment** comments the selected lines out with `--`, or back
  in; **Upper Case** and **Lower Case** change the selection's case, or
  the word's at the cursor.
- A click with Cmd, on macOS, or Ctrl, elsewhere, adds a cursor.

## Completion

Completion offers, as a word is typed, after a period, and by
Ctrl+Space or Tab, what may be written where the cursor is. While its
list is open, Up and Down move through it, Page Up, Page Down, Home and
End jump, typing narrows it, and the item highlighted shows its detail;
Tab or Enter takes it, and Escape closes the list. With no list open,
the arrow keys move the cursor, and Tab completes the word before the
cursor in place where one candidate alone begins with it, opens the
list where several do, and otherwise moves to a snippet's next field or
indents; Shift+Tab goes back a field, or outdents. Both are commands,
**Complete or Indent** and **Previous Placeholder or Outdent**, whose
keys may be changed ([The Window](02-window.md#keys)). Escape, then Tab,
leaves the editor. The statement is
read by Turborel's own parser, with a name put where one is being typed
so that a statement being written parses; one that does not parse even
so is read by its words.

| Where | What is offered |
|---|---|
| a statement's start | the words that begin a statement, and the snippets |
| after FROM, JOIN, INTO, UPDATE, TABLE, or a comma of FROM | the session's schema's tables and views, the schemas, and the statement's common table expressions |
| after NEXT VALUE FOR | the session's schema's sequence generators |
| after a schema's name and a period | its tables, views, sequences and routines |
| after a table's name or its alias and a period | its columns |
| after a table of FROM | AS, JOIN and the joins' words, ON, WHERE, GROUP BY, ORDER BY and the other clauses' |
| after JOIN … ON | the conditions the foreign keys between the table joined and the others imply, then the columns |
| within INSERT INTO t ( | the columns of t that take a value, as one list, then each column |
| right after SELECT * | the star written as its columns |
| after AS in CAST( | the types |
| in a value expression | the columns of the statement's tables, common table expressions and derived tables; Turborel's built-in functions; the session's schema's routines; the words of value expressions and of the clauses that may follow; and the snippets |

A column two of the statement's tables have is written qualified, by its
table's alias or name; one only one has, by its name alone. A name is
written as Turborel's lexer reads it back: bare where it is a regular
identifier in upper case and no reserved word, else delimited. Key words
and functions are written in the case the formatter's setting says, or
in upper case where it keeps the case written. Nothing is offered in a
string, a delimited name being written, or a comment.

The items are ranked by kind, columns first, then common table
expressions, tables, views, schemas, sequences, routines, functions,
snippets and key words; by scope, the statement's outermost query's
first; and by how often each was chosen before, this session. Matching
is fuzzy: the letters typed in order, not all together. Each item shows
its kind's icon and its type, or a routine's signature; its popup says
a column's type, whether it may be null, its default and its table, a
function's signature, what it gives and where Turborel's manual says so,
or a snippet's template.

Completion reads the catalog the explorer has read, and the session's
schema's objects as it first needs them, each table's columns as they
are asked for. While the worksheet runs a statement, it reads from what
is read alone, as the connection is busy. **Connection > Refresh
Catalog** reads the catalog again, as running a statement that changes
definitions does.

The built-in functions are those of the tables of functions of
Turborel's manual, at the commit Studio is built with.

## Dropping a table

A table dragged from the explorer's tree into the editor writes a SELECT
of its columns where it is dropped, or an INSERT of them, each value a
`?`, if Shift is held as it is dropped.

## Running statements

| Command | What it runs |
|---|---|
| **Run Statement** | the selection's statements, if text is selected; else the statement at the cursor, or the last before it |
| **Run Script** | every statement of the worksheet, in turn |
| **Explain** | EXPLAIN of the statement at the cursor, or of the selection's first |
| **Explain Analyze** | EXPLAIN ANALYZE of it, which runs it |

A script is split into its statements as Turborel's server splits a
request of several: at each semicolon that is not in a string, a
delimited identifier, a comment or a compound statement. A comment
before a statement is that statement's.

Before anything runs, the connection's guards judge the statements
together ([Environments and guards](03-connections.md#environments-and-guards)).
Where they ask, a dialog says what the script does, what it destroys,
and what Studio cannot tell; **Run** runs it, **Don't Run** or Escape
runs nothing. A read-only connection refuses a script that may write,
and nothing of it runs. Every connection refuses CONNECT, SET CONNECTION
and DISCONNECT: each of Studio's connections is bound to its own session,
and another is opened in the connection dialog.

The statements then run one by one, until one fails. After a statement
that changes definitions, or who may do what, or that Studio cannot
classify, the explorer reads the connection's catalog again. **Cancel
Statement**, in the worksheet's toolbar or the Connection menu, cancels
the statement running and runs none after it.

**Worksheet > Run Script on a Folder's Connections…** runs the script on
each saved connection of the folder chosen, or of a folder within it,
each connected first if it is not open, as its password in the keychain
proves. Each connection's guards judge the script for it, and a failure
on one ends the run on it alone; the results are each their own, each
tab named by its connection, and the messages tell each connection's in
turn.

The worksheet's toolbar's **Autocommit** makes each statement its own
transaction, or not; **Connection > Commit** and **Rollback** end the
transaction, and the status bar shows it.

## Parameters and script variables

A statement may hold markers a worksheet gives values to as it runs. None
is read in a string, a delimited identifier or a comment.

- `?` is a dynamic parameter, and `:name` one by name, sent as `?`.
- `${name}` is a script variable, whose value replaces it before the
  statement is sent, as text.

```sql
SELECT NAME FROM ${schema}.STAFF WHERE DEPT = :dept AND ID > ?
```

Before such a statement runs, a dialog asks each parameter's value, as
text or NULL, naming the type the server describes it as; and, before a
script runs, the value of each of its script variables that has none.
The values given last are offered again. A script's variables, and their
values, are also shown under the worksheet's toolbar, where a value is
changed in place. A parameter's value is cast to its parameter's type:
one that is no number, of a number's parameter, fails with SQLSTATE
22018. A binary string's value, or a binary large object's, is written
in hexadecimal digits, as the grid shows it, `DEADBEEF`; digits not in
pairs fail with SQLSTATE 22018. A large object's value longer than
64 KiB is written to the server first, a piece at a time, and sent as
its locator.

## Results and messages

**Results** shows the rows of each statement that gave rows, a tab of
each where a script gave several: each column's name and declared type,
and its values, NULL so written. A result shows the rows read so far, a
page of 500 at first; **Read more** reads the next 500. A result is
closed as the worksheet runs again.

**Messages** tells each statement's outcome as it ran: the rows it gave,
`+` after their count where more are to be read, or the rows it changed
and the identity values it generated, and its time, on the server where
the server tells it; its warnings; the notices the server sent the
connection; and a failure, by its SQLSTATE, SQLCODE and message, the
rule of the standard it broke, and its diagnostics' detail, hint, the
schema, table and column it is about, and its constraint, where the
server gives them. A failure at a place in the statement is
underlined in the editor, and the cursor moved there; clicking its
message moves it there again.

## The plan

**Plan** shows the plan of the statement Explain or Explain Analyze ran,
or of an EXPLAIN written in the script, read from EXPLAIN's text
([EXPLAIN](https://github.com/turborel/turborel/blob/main/doc/sql/statements/explain.md));
the statement's PLAN rows stay its result, in **Results**, for its grid
and text views. Its toolbar holds **Explain** and **Explain Analyze**,
which says that it runs the statement; **Flow** or **Tree-Table**;
**Show raw**; **Compare with the plan before**, where there is one; and a
search of its operators.

Its summary says the rows the query gave and its time, of Explain
Analyze, or that the plan is of estimates alone; the join order and the
algorithm that found it; the rewrite rules applied; the tables storage
counted; the three operators that cost most, by their own time, their
time but their inputs', where the clock moved, else by the planner's
cost, each with its share; and the warnings, each of its rule:

| Rule | What it warns of |
|---|---|
| `PLAN-FULL-SCAN` | a table of about 10,000 rows or more read whole |
| `PLAN-SERIAL` | a table of 65,536 rows or more, EXECUTOR.PARALLEL_MIN_ROWS's default, read on one thread where no part of the plan runs in parallel |
| `PLAN-MISESTIMATE` | an operator whose estimate is off its actual rows by ten times or more |
| `PLAN-MANY-PROBES` | an index nested loop of 10,000 probes or more, or a nested loop of as many loops |
| `SCAN-NO-INDEX` | a column the plan compares with a constant, of a table read whole, that no index leads, with its fix and a what-if ([The Analyzer](09-analyzer.md#the-plans-findings)) |

EXPLAIN does not tell whether an operator spilled to disk, so the plan
cannot warn of it.

Below are a tab of each stage, physical first, then optimized and bound,
**rewrites**, which lists the rules, and **raw**, EXPLAIN's text, with
**Copy**. A stage is drawn as a flow or a tree-table:

- **Flow:** each operator a node, its inputs below it, the rows moving
  up its lines toward the result, each line as thick as the rows it
  carries. A node shows its kind's icon, its name, the table and index it
  reads, and its estimate; of Explain Analyze its actual rows, loops,
  probes and time, a bar of its estimate against its actual rows, and a
  heat of its share of the time. A node's **−** collapses the operators
  below it, and **+** shows them again. The controls zoom and fit, and
  the search fits the operators it finds in view.
- **Tree-Table:** each operator a row, indented by its depth, with its
  estimate, actual rows, loops, probes, own time and share; a column's
  heading sorts by it, descending, then ascending, then as the plan is.

A click on an operator shows every detail of it beside the plan: what it
is of, its figures, its cost and degree, its notes, and the line it came
of. A range join, `RangeJoin` or `LeftRangeJoin`, has an icon of its own,
and its details say what its right operand is sorted on, the equalities
that group those rows, and the comparison it is pruned by
([EXPLAIN](https://github.com/turborel/turborel/blob/main/doc/sql/statements/explain.md)).
A line EXPLAIN gives that the viewer does not know is shown as an
operator of its first word.

**Compare with the plan before** shows the plan explained before beside
the latest, each as a tree-table, of the same stage, the operators one
has and the other lacks marked, as after an index is made; a what-if
shows them so at once. The setting **Open plans as** opens a plan on its
raw text instead ([Appendix B](../appendix/b-settings.md)).

## Formatting

**Format** lays out the selection, or the whole script if nothing is
selected: each clause on a line of its own; AND, OR and ON indented on a
line each; a subquery indented within its parentheses; a list broken
where its line would pass the width. Strings, delimited identifiers and
comments are kept as written. Three settings shape it: the case of key
words, upper, lower or as written; the indentation, from 1 to 8 spaces;
and the width of lines, from 40 to 240 characters
([Appendix B](../appendix/b-settings.md)).

```sql
select name, count(*) as n from staff s left join dept d on s.dept = d.id where s.age > 30 and d.name is not null group by name
```

is formatted, of the settings' defaults, as:

```sql
SELECT name, COUNT(*) AS n
FROM staff s
LEFT JOIN dept d
    ON s.dept = d.id
WHERE s.age > 30
    AND d.name IS NOT NULL
GROUP BY name
```

## The history

Each statement run is kept in the history, the latest first, at most
1000: its text, when it ran, its connection, how long it took, its rows,
and its SQLSTATE. A statement that changes who may do what, as CREATE
USER with its password, is never kept. **File > History…** searches it,
in any case, by statement or connection; **Open** opens an entry in a
worksheet, **Run** opens it and runs it there, and **Clear History**
forgets every entry. The setting **Keep a history of what runs** turns
it off.

## Favourite queries

**Worksheet > Add to Favourite Queries…** keeps the selection, or the
statement at the cursor, under a name. The explorer's **Favourite
Queries** lists them; a click opens one in a worksheet, and **Forget**
lets it go.

## Files and projects

**File > Save** saves the worksheet to its file, or, if it has none, to
one the platform's dialog chooses, which then names the worksheet; **Save
As…** chooses another. A tab's title is marked with `•` while its text
has changed since it was saved.

The explorer's **Projects** lists folders of `.sql` files: **Add Project
Folder…** chooses one in the platform's dialog, and each of its `.sql`
files is listed, eight folders deep at most, and opened by a click;
**Close Project** lets the folder go, its files as they are. Studio reads
and writes only the files chosen in the dialog and the `.sql` files of
the project folders.

## Keeping worksheets

Studio keeps each worksheet, with its text, its title, its file and its
saved connection, a moment after it last changes, so a worksheet not
saved to a file comes back after a crash or a restart
([Appendix D](../appendix/d-files.md)).

**Worksheet > Close Worksheet**, or a tab's close button, closes a
worksheet; **File > Reopen Closed Worksheet** opens the last closed
again, until the window closes. **Pin Tab** pins a worksheet's tab, so
**Close Other Worksheets** leaves it open.

## Notifications

A run that lasts longer than the setting **Notify a run's end** says,
10 seconds by default, and ends while the window is in the background,
is told by the platform's notification. 0 turns it off.
