# The Object Explorer

[Contents](README.md)

The explorer, on the left of the window, shows the connections and,
under them, the catalog of the active connection: what its database
holds, as far as its user may see it. Studio reads it from the
database's Information Schema, the views every SQL database describes
itself by, a part at a time as the tree opens.

## The tree

Each row of the tree, and each connection, has a context menu of what
can be done with it ([The Window](02-window.md#context-menus)).

![The catalog's tree: the schema DEMO, its tables and views, and the table ORDERS opened on its columns, keys and index, each of its own icon](../images/explorer-tree-light.png#gh-light-mode-only)
![The catalog's tree: the schema DEMO, its tables and views, and the table ORDERS opened on its columns, keys and index, each of its own icon](../images/explorer-tree-dark.png#gh-dark-mode-only)

The tree's first level holds the schemas, then **Users and Roles**. A
schema opens on its folders:

| Folder | What it holds |
|---|---|
| **Tables** | its base tables and temporary tables |
| **Views** | its views |
| **Routines** | its functions and procedures |
| **Sequences** | its sequence generators |
| **Domains** | its domains |
| **Types** | its user-defined types, distinct and structured |

Each row shows the icon of its kind: a schema, a folder, a table, a
view, a column, a key, a foreign key, a check, an index, a trigger, a
routine, a sequence, a domain, a type, a user or a role.

A table or view opens on its parts: each column, with its type and NOT
NULL where it is so; each constraint, with its kind; each index made
by CREATE INDEX; and each trigger. The index a key's constraint is
served by is shown under the table's **Indexes** in the details, not
in the tree.

A schema lists at most 20,000 tables and views, routines, sequences,
domains and types; one holding more says so, as **Only the first 20,000
of each kind are listed**; a search of the definitions finds the tables,
views and routines beyond them by name.

**Users and Roles** opens on the users the session may see, every user
to the database's owner and else the session's own, then the roles
granted to the user, to PUBLIC, and to the roles it holds.

A node is opened by its triangle, or by double-clicking it. The
explorer's toolbar's **Refresh** reads the schemas again, closing
everything opened, so the tree shows what was made or dropped since;
**Collapse All** closes every node.

The keys work the tree as its arrows show:

| Key | What it does |
|---|---|
| Down, Up | the next row, the row before |
| Right | opens the row |
| Left | closes the row |
| Enter | selects the row, showing it in the details panel |

A row is selected by clicking it too.

## Filtering and searching

The explorer's toolbar's **Filter**, or Cmd+F on macOS and Ctrl+F
elsewhere within the explorer, shows the catalog's search above the
tree: one field, of a scope of names at first. **Filter** again, or
Escape in the field, hides it and clears it.

![The catalog filtered by ORDER: the tables and view whose names hold it, their schema and folders opened](../images/explorer-filter-light.png#gh-light-mode-only)
![The catalog filtered by ORDER: the tables and view whose names hold it, their schema and folders opened](../images/explorer-filter-dark.png#gh-dark-mode-only)

Of names, the field keeps the objects whose names hold what is typed,
in any case, with their schemas and folders opened; Users and Roles are
hidden while it holds anything. A schema not yet opened is read as it
is typed, and shows its objects once they are read.

The scope's button beside the field, **Search definitions too**, makes
Enter ask the server instead, in any case, for every table, view and
routine whose name holds the text, and each table with a
column whose name does; and for every view whose query, routine whose
body, trigger whose action, and check whose condition holds it. Each
object found is listed by its kind, schema and name, a column by its
table's, marked **(in its definition)** where the text was found there;
clicking a table, view, column or routine found selects it, a column's
table for a column.

## Favourites

A saved connection keeps favourites: objects listed above its tree,
each selected by a click. The details panel's **Add to favourites**
makes the object shown one; **Favourite** takes it off. The favourites
are kept with the saved connection, in its file
([Appendix D](../appendix/d-files.md)); a connection opened without
saving has none.

## The details panel

The details panel, on the right, shows the object selected.

![The details panel of the table DEMO.ORDERS: its actions, its tabs, and its columns with their types](../images/explorer-details-light.png#gh-light-mode-only)
![The details panel of the table DEMO.ORDERS: its actions, its tabs, and its columns with their types](../images/explorer-details-dark.png#gh-dark-mode-only)

![The details panel's Dependencies of DEMO.ORDERS: it uses nothing, and is used by the view CUSTOMER_TOTALS and the foreign key ORDER_LINES_FOREIGN1](../images/explorer-dependencies-light.png#gh-light-mode-only)
![The details panel's Dependencies of DEMO.ORDERS: it uses nothing, and is used by the view CUSTOMER_TOTALS and the foreign key ORDER_LINES_FOREIGN1](../images/explorer-dependencies-dark.png#gh-dark-mode-only)

Of a table or view, its tabs are:

| Tab | What it shows |
|---|---|
| **Columns** | each column: its name, type, whether it may be null, its default, its identity or generation |
| **Keys and checks** | each constraint: primary key, unique, foreign key with what it references and its delete rule, and check with its condition |
| **Indexes** | each index: its method, whether it is unique, its columns, the options WITH gave it, and what the server made it for, if it did: a key, or, on a partition, its table's index |
| **Triggers** | each trigger: its timing, event, whether for each row or statement, and its action |
| **Partitions** | of a partitioned table, its strategy, its key and each partition with its bound; of a partition, the table it is a partition of and its bound |
| **Storage** | of a base table, the engine that keeps its rows, and each option of the engine given a value of its own ([Appendix G](https://github.com/turborel/turborel/blob/main/doc/appendix/g-table-options.md)) |
| **Privileges** | each privilege granted on it, or on one of its columns: to whom, which, on which column, by whom, and whether with grant option |
| **Statistics** | of a base table, what the planner's statistics hold of it: the rows the last pass found and when, its rows now and when it last changed; each column's share NULL, distinct values, width, least and greatest values, most common values with their shares, and histogram; and each index's entries, distinct keys and selectivity beside its definition ([The Analyzer](09-analyzer.md#statistics)). Of statistics not yet gathered it says so; reading them asks for them, so they are gathered soon after. A column is shown to a user who holds a privilege on it, and every column to the owner and a holder of MONITOR |
| **Dependencies** | what it uses, as the tables a view reads, and what uses it: views, routines and triggers that read it, and other tables' foreign keys that reference it |
| **Definition** | its definition as SQL |

Above a base table's tabs, **Edit Rows…**, **Import…**, **Export…**,
**Compare Rows…** and **Alter Table…** edit its rows, import a file's rows
into it, export its rows, compare them with another table's, and alter
it; above a schema's definition, **Create Table…** makes a table in it,
**Import into New Table…** makes one of a file's fields and imports its
rows, and **Generate Script…** writes the definitions of the objects chosen
of it ([Editing Data](07-editing-data.md)); **Compare Schema…** compares
it with another, and **Open Model** opens a model of its tables
([Schema Modeling](08-modeling.md)).

**Partitions** is shown only of a partitioned table or a partition. The
index a partitioned table's index made on a partition is named by the
template, the partition's schema and its name, shown apart by `/`.

A routine shows its parameters, with their modes, types and defaults; its body,
which only the owner of its schema sees; the privileges granted on it;
and its definition. Its **Debug** tab debugs it on the connection,
as **Debug…** of its menu does ([Debugging Routines](13-debugging.md)). A type
shows its category; a distinct type its source type, and a structured
type its attributes, whether it is final and instantiable, its
supertype, how its references are represented, and its methods; and its
definition. A sequence and a domain show their definitions and, under
**Usage**, who is granted USAGE on them; a schema shows its definition.
A user shows the roles granted to it, and a role the users and roles it
is granted to, and says so where the session's user may grant, revoke
and drop it.

## The definition

The **Definition** tab shows the SQL that makes the object again, as
Studio writes it from the catalog: a table's columns, its constraints,
the indexes made by CREATE INDEX, with their methods and options, and
its triggers, and a partitioned table's strategy and key; a base table's
engine, by USING, and the options of its engine it was given, by WITH
([Appendix G](https://github.com/turborel/turborel/blob/main/doc/appendix/g-table-options.md)); a partition as
a partition of its table, of its bound; a view's query; a routine whole;
a sequence's options; a domain's type, default and checks; a distinct
type's source, and a structured type's attributes and whether it is
final and instantiable, though not yet its supertype, its reference
type's options or its methods. A schema's definition makes each of its
objects: its types, domains and sequences, then its tables, each after
those its foreign keys reference and a partition after its table, then
its views and its routines.

![The details panel's Definition of DEMO.ORDERS: its CREATE TABLE, with Script as, Copy, Save and Open in Worksheet](../images/explorer-definition-light.png#gh-light-mode-only)
![The details panel's Definition of DEMO.ORDERS: its CREATE TABLE, with Script as, Copy, Save and Open in Worksheet](../images/explorer-definition-dark.png#gh-dark-mode-only)

![The table ORDERS's context menu, Script As, then SELECT, then To Worksheet, and the SELECT of its columns in a new worksheet](../images/script-as-light.gif#gh-light-mode-only)
![The table ORDERS's context menu, Script As, then SELECT, then To Worksheet, and the SELECT of its columns in a new worksheet](../images/script-as-dark.gif#gh-dark-mode-only)

A routine's body and a trigger's action are shown to the owner of their
schema alone: to another user, the definition holds a comment saying so
in their place.

A table made so:

```sql
CREATE TABLE ORDERS (
  ID INTEGER GENERATED ALWAYS AS IDENTITY,
  CUSTOMER VARCHAR(40) NOT NULL,
  TOTAL DECIMAL(9,2) DEFAULT 0,
  CONSTRAINT ORDERS_PK PRIMARY KEY (ID),
  CONSTRAINT TOTAL_NOT_NEGATIVE CHECK (TOTAL >= 0)
);
CREATE INDEX ORDERS_BY_CUSTOMER ON ORDERS (CUSTOMER);
```

has this definition:

```sql
CREATE TABLE ANN.ORDERS (
    ID INTEGER GENERATED ALWAYS AS IDENTITY NOT NULL,
    CUSTOMER CHARACTER VARYING(40) NOT NULL,
    TOTAL DECIMAL(9,2) DEFAULT 0.00,
    CONSTRAINT ORDERS_PK PRIMARY KEY (ID),
    CONSTRAINT TOTAL_NOT_NEGATIVE CHECK (TOTAL >= 0)
) USING rowstore;
CREATE INDEX ORDERS_BY_CUSTOMER ON ANN.ORDERS (CUSTOMER);
```

Each name is qualified by its schema, here ANN's. The engine is named
though it is the default, as the database it is run on may keep its
tables in another. A type is written as
the server names it, VARCHAR as CHARACTER VARYING, and a default as the
server keeps it, cast to its column's type; a column of the primary key
is NOT NULL, as the key makes it.

Of a table, **Script as** chooses the statement shown instead:

| Script as | What it writes |
|---|---|
| CREATE | the table's definition |
| ALTER | ALTER TABLE … ADD COLUMN NEW_COLUMN INTEGER, to be made the change wanted |
| DROP | DROP TABLE, or DROP VIEW, … RESTRICT |
| SELECT | a query of every column |
| INSERT | INSERT of every column that takes a value, each value a `?` |
| UPDATE | UPDATE of every such column not of the primary key, by the key |
| DELETE | DELETE by the primary key |

A statement by the primary key, of a table that has none, is by every
column. A statement scripted is only shown: it runs only where it is
copied to and run.

**Copy** puts the text on the clipboard. **Save…** asks, in the
platform's own dialog, where to save it as a file, named after the
object by default; nothing is saved if the dialog is cancelled.

Studio reads the catalog through the connection, by queries that change
nothing, so a read-only connection shows it as any other does.
