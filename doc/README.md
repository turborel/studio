# The Turborel Studio Documentation Set

Turborel Studio is the desktop database IDE for Turborel, a relational
database system. It connects to a Turborel server, `turboreld`, through
Turborel's own client library, and gives one window for the work done
with a database: browsing its catalog, writing and running SQL, reading
and editing its rows, modeling and comparing schemas, analyzing indexes
and plans, asking an assistant, sharing the workspace live, and watching
the server. This set of manuals describes it for those who use it. The
SQL Studio runs, and the server, are described in Turborel's own
manuals,
[The Turborel Documentation Set](https://github.com/turborel/turborel/blob/main/doc/README.md).

Turborel Studio is in alpha: what these manuals describe may change in
any release until 1.0.0 ([Versions](appendix/c-versions.md)). Studio is
built in milestones, and until a chapter's milestone lands, the chapter
says what it will cover. Each change updates the pages it touches, so
the manuals describe the release they come with.

## The volumes

| Volume | For | |
|---|---|---|
| [I. User's Guide](user/README.md) | Anyone who works with a Turborel database through Studio | Installing, connections, the Object Explorer, worksheets, results, editing data, schema modeling, the analyzer, the assistant, live sessions and administration, chapter by chapter |
| [Appendices](appendix/README.md) | Everyone | Keyboard shortcuts, settings and versions |

Read the User's Guide from the start to learn Studio; turn to the
appendices to look a thing up.

## Conventions

**Menus and keys** are set in bold, as **File > New Connection…** and
**Ctrl+Shift+P**; on macOS, **Cmd** stands where **Ctrl** is written
([Keyboard shortcuts](appendix/a-keyboard.md)).

**Examples** of SQL are set in a fixed-width font. SQL key words are in
upper case, names in upper case unless delimited, as the standard folds
them:

```sql
SELECT NAME, SALARY FROM STAFF WHERE SALARY > 1000
```

**Results** of examples follow them, as Studio shows them.

**Errors** are given by SQLSTATE, the code the SQL standard defines, and
SQLCODE, the older number, as Turborel gives them.
