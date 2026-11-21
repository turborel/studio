# The Assistant

[Contents](README.md)

The assistant answers questions of a connection's schema, a worksheet's
SQL and its plan, of a model of the user's choice: Claude, or a model of
the user's own. It is off until the user turns it on. Every request is
made by Studio's backend, never by the window, and holds only what the
user chose to send, shown whole first. Its tools read the catalog,
explain queries and run a query only once the user approves it; a
statement that changes anything it drafts into a worksheet, where only
the user runs it. Its guard rails are kept by Studio and the database,
never by what the model is told, so no answer of a model, nor text it
reads, can talk its way past them.

## Turning it on

**View > Assistant** shows the assistant's panel, beside Details on the
right of the window. **View > Assistant Settings…**, or **Assistant
Settings…** in the panel, opens its settings:

| Setting | What it is |
|---|---|
| **Turn the assistant on** | off until ticked |
| **Model of** | **Claude**, or **My own model** |
| **Claude's model** | `claude-opus-5-5` at first; `claude-sonnet-5-5` and `claude-haiku-5-5` are offered, and any model's name may be written |
| **Endpoint** | of the user's own model, its base URL: `http://localhost:11434` at first |
| **Model** | of the user's own model, its name |
| **Wire format** | of the user's own model: **Chat completions**, which most local model servers speak, or **Anthropic Messages** |
| **It calls tools** | whether the user's own model calls tools; one that calls none answers questions alone, and the panel says so |
| **Key** | the model's key, saved by **Save Key** and forgotten by **Forget Key** |

A key is kept in the operating system's keychain alone. Once saved it is
never shown again, not even to the window: the settings say only
whether one is saved. Claude needs a key; the user's own model is asked
with none where none is saved.

An endpoint of another machine is of HTTPS. One of this machine,
`localhost`, `127.0.0.1` or `[::1]`, may be of plain HTTP. Claude is
asked at `https://api.anthropic.com`.

## Asking

The panel holds a conversation with the assistant of the active
connection, which must be a saved one. Write a question and click
**Ask**. Above **Ask**, three boxes choose what is sent with it:

| Box | What it sends | At first |
|---|---|---|
| **Send the worksheet's SQL** | the active worksheet's text | ticked |
| **Send its plan** | the latest plan the worksheet showed, as EXPLAIN gave it | not ticked |
| **Include its result's first rows** | the first 20 rows of the result it shows, a line each, a null as `NULL` | not ticked |

Every request also holds the schema's context: the session's schema's
tables and views, each with its columns and their types, its keys, its
foreign keys and the indexes CREATE INDEX made, written the same way
each time, so a model's cache of it holds. The first 200 tables are
described; those past them are named alone. No row's value is sent but
those the user includes or approves.

Where the connection's policy redacts literals, each literal of the
worksheet's SQL and of its plan, a string, a number or a binary string,
is sent as `?`.

The answer is shown as it comes. Each tool the model calls is shown
with what became of it, and a call a rule stopped in red, its rule
named. Each turn ends with the tokens it took, and those read of the
cache. A model that declines to answer is shown declining, with the
category and explanation it gives. **New Conversation** begins again,
the old forgotten; asking of another saved connection begins one too.

The conversation runs on a connection of the assistant's own, opened as
it is first asked, on which each transaction begins READ ONLY and each
statement is cancelled past the policy's time.

### What will be sent

Where the connection's policy says so, as it does at first, each
request is shown before it is sent: the whole body Studio will send,
which holds no key. **Send** sends it; **Don't Send** stops the turn,
and the request is logged as not sent. A question of the assistant
waits 30 minutes for its answer, then is taken as no.

### Asking Claude

Claude is asked through Anthropic's Messages API, each request streamed.
A request that sends a plan asks the model to think harder than one
that does not. Claude's server-side fallbacks are asked for: where the
model chosen cannot answer for a while, another of Claude's models may,
and the log names the model that answered. A request refused for too
many requests, or by a failure of the server, is tried again, at most
three times, after the seconds the server asks, at most a minute, or
else after 1, 2 and 4 seconds; any other failure is shown with what its
HTTP status means.

## The tools

The model may call these tools, each judged by the connection's policy
before it runs:

| Tool | What it does | From the level |
|---|---|---|
| `list_schemas` | names the schemas | Explain only |
| `list_tables` | names a schema's tables and views | Explain only |
| `describe_table` | describes a table: its columns, constraints and indexes | Explain only |
| `explain` | runs EXPLAIN of a query, and is told its plan; never EXPLAIN ANALYZE, which runs its statement, refused as `EXPLAIN-ONLY` | Explain only |
| `analyzer_findings` | is told a schema's findings ([The Analyzer](09-analyzer.md)) | Explain only |
| `run_query` | runs a query, once the user approves it, and is told its rows | Read |
| `propose_sql` | drafts SQL into a worksheet for the user, never running it | Explain only, of a query; Propose changes, of any other statement |

A table or schema the policy hides is left out of every list, and no
tool tells of it. `run_query` shows the query, its class, the objects
it names and EXPLAIN's estimate, the top line of its plan, and waits
for **Run** or **Don't Run**. It runs in a READ ONLY transaction, ended
after, and the model is told at most the policy's rows.

What the model reads of the database, names, comments, values, routine
bodies and plans, is data to it, never instructions; what it is told
first says so. No tool changes anything without the user.

### Drafts

A draft is shown with its title, why the model drafted it, its class,
the objects it names, and EXPLAIN's estimate where it is a query, as
EXPLAIN plans a query alone. A statement that destroys, or that the
assistant may never run, is shown in red with the reason and the rule.
**Open in Worksheet** opens it in a worksheet of the active connection,
where the user reads it and runs it, through the guards every statement
runs through ([Worksheets](05-worksheets.md)).

A draft the hard floor holds, or whose statement is of no class known,
is blocked for the assistant: its worksheet runs only once the user
types the name of the object it names, or its first word where it names
none, as `ANN` of `DROP SCHEMA ANN CASCADE`.

## The guard rails

### Levels

Each saved connection has a policy, whose level says what the
assistant may do on it:

| Level | What the assistant may do |
|---|---|
| **Nothing: off** | nothing; it is not asked |
| **Explain only** | read the catalog, EXPLAIN queries and read the analyzer's findings; draft queries |
| **Read** | and run queries the user approves |
| **Propose changes** | and draft statements that write rows or change the schema, which the user runs |

A connection of the development or test environment is Read at first;
one of production is off at first, its literals redacted, and is never
more than Read, whatever its policy says.

### The hard floor

The assistant can never run nor explain any of these, at any level,
whatever the policy says, and a draft of one is blocked for it:

- DROP SCHEMA, DROP TABLE and TRUNCATE TABLE;
- DELETE or UPDATE with no WHERE;
- CREATE, ALTER and DROP USER; CREATE and DROP ROLE; GRANT and REVOKE;
- SET SESSION AUTHORIZATION;
- ALTER DATABASE and SET DATABASE;
- END CONNECTION and CANCEL CONNECTION;
- BACKUP DATABASE, CREATE RESTORE POINT and RESCAN BACKUP TARGET;
- CREATE, ALTER and DROP EXTENSION.

Each statement is classified by Turborel's own parser, as the guards of
every worksheet classify it: of a script, each statement, the strictest
class winning. A statement that does not parse, dynamic SQL (EXECUTE
IMMEDIATE, PREPARE, EXECUTE), CALL and a compound statement are of no
class known, and held as the floor holds. The assistant explains or
runs one statement at a time; it may draft a script.

### The rules

A tool call a rule stops is told to the model and shown in red, the
rule named:

| Rule | What it stops |
|---|---|
| `ASSISTANT-OFF` | anything, on a connection whose level is off |
| `ONE-STATEMENT` | a script of more than one statement, explained or run |
| `HIDDEN` | a statement that names a hidden schema or table, and any tool of one |
| `HARD-FLOOR` | a statement the hard floor holds, explained or run |
| `READ-ONLY` | a statement that is not a query, explained or run |
| `LEVEL` | what the connection's level does not allow |
| `CLASS` | a statement of a class the policy denies, or does not allow |
| `DENIED` | a statement that names a denied schema or table |
| `NOT-ALLOWED` | a statement, explained or run, that names no allowed schema or table, where the policy allows some |
| `LIMIT` | a tool call past the limit of a turn's calls |

A name written alone is judged as of the session's schema too, and a
rule of a table catches the table written without its schema.

### The policy

**Assistant Settings…** sets the active saved connection's policy:

| Field | What it is | At first | Bounds |
|---|---|---|---|
| **The assistant may** | the level | Read; off, of production | |
| **Show what will be sent before each request** | the preview | ticked | |
| **Replace SQL's literals by placeholders** | the redaction | ticked of production alone | |
| **Hidden schemas and tables** | `SCHEMA` or `SCHEMA.TABLE`, a line each: never read nor told of | none | 500 |
| **Denied schemas and tables** | those it may not explain, run nor draft statements of | none | 500 |
| **Allowed schemas and tables** | those alone it may explain and run statements of; all, if none | none | 500 |
| **Rows returned to the model** | the most rows `run_query` tells | 100 | 1 to 10,000 |
| **Seconds a query runs** | before it is cancelled, by STATEMENT.TIMEOUT_MS ([Settings](https://github.com/turborel/turborel/blob/main/doc/appendix/c-settings.md)) | 30 | 1 to 3600 |
| **Tool calls of a turn** | the most | 20 | 1 to 100 |
| **Tokens of an answer** | the most a request asks for | 64,000 | 1024 to 128,000 |
| **The assistant's own login** | a user the assistant's connection logs in as | none | |

The classes allowed and denied are set in the policy's file
([Files](../appendix/d-files.md#assistant-policyjson)).

### A login of its own

Where a policy names a login, the assistant's connection logs in as
that user, proving the password **Save Password** keeps in the
keychain, instead of as the saved connection's user. Made a user who
may only SELECT, the database refuses what Studio's own checks might
miss:

```sql
CREATE USER HELPER PASSWORD 'a long secret';
GRANT SELECT ON ANN.STAFF TO HELPER;
```

([CREATE USER](https://github.com/turborel/turborel/blob/main/doc/sql/statements/create-user.md),
[GRANT](https://github.com/turborel/turborel/blob/main/doc/sql/statements/grant.md))

**Export Policies…** saves every saved connection's policy to a file
the platform's dialog chooses; **Import Policies…** takes a file so
saved in place of those kept.

## The log

Each request is logged on this computer alone: when, the provider, the
model that answered, the connection by its name, the kinds of context
sent (`schema`, `sql`, `explain`, `rows`), each tool call and what
became of it (ran, approved, refused by the user, blocked by its rule,
or of input that did not fit its tool), how it stopped, and its tokens.
A request not sent is logged too. **Show the Log** in the settings
shows the latest 1000, the latest first; **Clear the Log** forgets
them. The log never holds a key, nor a row's value
([Files](../appendix/d-files.md#assistant-auditjsonl)).
