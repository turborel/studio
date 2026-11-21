# Conformance

What Turborel Studio supports of Turborel, row by row: the statements it
runs and shows, the types it displays and edits, the Information Schema
views it reads, the features of turborel-client and the protocol's
capabilities it uses, the files it keeps, how it keeps them secure, the
choices Turborel leaves to it, and its limits.

A row is **done** only where Studio's code for it exists and tests
citing it pass (RULES.md R-TRACE-4); else it is **not yet**, and
[TODO.md](TODO.md) names the milestone that does it. Each row cites
Turborel's manual where Turborel defines the behaviour, by page and
heading as RULES.md D6 writes them. Turborel's manual is read at the
commit turborel-client is pinned to (RULES.md D10),
`7189b102f79059f5d587d025a6efcc8d63b843e9`.

[Statements](#statements) · [Types](#types) ·
[The Information Schema](#the-information-schema) ·
[turborel-client](#turborel-client) · [Capabilities](#capabilities) ·
[Files](#files) · [Security](#security) ·
[Implementation-defined](#implementation-defined) · [Limits](#limits)

---

## Statements

Every statement is the server's to run: Studio sends it as typed, and
shows what it gives. These rows say how each kind is shown.

| ID | Statements | How Studio runs and shows them | Status |
|---|---|---|---|
| S-STMT-1 | Queries: SELECT, VALUES, TABLE, WITH ([DOC sql/06-queries.md Query Expressions]) | prepared and read through a cursor, a page at a time, into the worksheet's results, with each column's declared type | done |
| S-STMT-2 | INSERT, UPDATE, DELETE, MERGE | the rows affected, and the identity values an INSERT generated, in the messages pane | done |
| S-STMT-3 | TRUNCATE TABLE | confirmed first, as a statement that destroys | done |
| S-STMT-4 | CREATE, ALTER and DROP of each object Turborel defines | run as typed; a DROP confirmed first; the explorer read again after | done |
| S-STMT-5 | COMMIT, ROLLBACK, SAVEPOINT, RELEASE SAVEPOINT, START TRANSACTION, SET TRANSACTION, SET CONSTRAINTS | the transaction's state in the status bar after each | done |
| S-STMT-6 | SET SCHEMA, SET CATALOG, SET TIME ZONE, SET ROLE, SET SESSION AUTHORIZATION, and SET of a setting | the session's status as the server tells it, at once | done |
| S-STMT-7 | GRANT, REVOKE, and CREATE, ALTER and DROP of a user or role | run as typed; the explorer's users, roles and privileges read again | done |
| S-STMT-8 | EXPLAIN | its text, and the plan view of its stages | done |
| S-STMT-9 | CALL | a procedure's output parameters, as one row | done |
| S-STMT-10 | PREPARE, EXECUTE, EXECUTE IMMEDIATE, DEALLOCATE PREPARE, DESCRIBE, descriptors, and cursors declared in SQL | sent to the server as typed, their outcomes shown | done |
| S-STMT-11 | CONNECT, SET CONNECTION, DISCONNECT | refused in a worksheet, which is bound to its connection (S-IMPL-3) | done |
| S-STMT-12 | A script of several statements | split as the server splits a request of several, each run in turn, each result its own | done |

## Types

How each of Turborel's types
([DOC sql/02-data-types.md Data Types]) is shown in the grid and its
viewers: as the text the server's value gives. Each is edited in a
table's rows as it is shown (RULES.md D41, D42).

| ID | Types | Shown | Status |
|---|---|---|---|
| S-TYPE-1 | CHARACTER, CHARACTER VARYING | as text | done |
| S-TYPE-2 | BINARY, BINARY VARYING | as hexadecimal text; in the hex and image viewers as octets | done |
| S-TYPE-3 | CLOB, BLOB | whole in its row where it was sent whole; else by what it is, read whole by its locator, a chunk at a time, for the text, hex or image viewer (S-LIMIT-3) | done |
| S-TYPE-4 | BOOLEAN | TRUE or FALSE; unknown as NULL | done |
| S-TYPE-5 | SMALLINT, INTEGER, BIGINT, NUMERIC, DECIMAL | exact, as the server's text, with its scale, never through a float (R-NUM-1) | done |
| S-TYPE-6 | REAL, DOUBLE PRECISION, FLOAT | as the server's text, as `1.5E0` | done |
| S-TYPE-7 | DECFLOAT | exact, as the server's text | done |
| S-TYPE-8 | DATE, TIME, TIMESTAMP, with or without time zone | as the server's text, as `2024-02-29` | done |
| S-TYPE-9 | INTERVAL | as the server's text, its qualifier in the column's type | done |
| S-TYPE-10 | Arrays | as the server's text, as `ARRAY[1, 2]` | done |
| S-TYPE-11 | Rows | as the server's text, as `ROW(1, 'a')` | done |
| S-TYPE-12 | Multisets | as the server's text, as `MULTISET[3]` | done |
| S-TYPE-13 | Distinct types | as their source type's values | done |
| S-TYPE-14 | Structured types | as the server's text of their attributes, as `ANN.ADDRESS('Main', 'Oslo')` | done |
| S-TYPE-15 | Reference types | as the server's text, as `REF(…)` | done |
| S-TYPE-16 | XML | as text; in the XML viewer laid out, never rendered | done |
| S-TYPE-17 | JSON | as text; in the JSON viewer as a tree, never run | done |
| S-TYPE-18 | UUID | as its text | done |
| S-TYPE-19 | Vectors | as text; in the vector viewer, its elements and figures | done |
| S-TYPE-20 | Spatial types | as well-known text; on a plane | done |
| S-TYPE-21 | Types beyond the standard, as VECTOR, and those of plug-ins | as the text the server gives | done |

## The Information Schema

The views Studio reads ([DOC sql/07-information-schema.md The Information Schema]),
each as the session's user may see it.

| ID | Views | Read for | Status |
|---|---|---|---|
| S-VIEW-1 | SCHEMATA | the explorer's schemas | done |
| S-VIEW-2 | TABLES | tables and views, by type | done |
| S-VIEW-3 | COLUMNS | columns, types, defaults, nullability, identity and generation | done |
| S-VIEW-4 | VIEWS | a view's definition | done |
| S-VIEW-5 | TABLE_CONSTRAINTS | keys, unique constraints, foreign keys and checks | done |
| S-VIEW-6 | KEY_COLUMN_USAGE | a key's columns, in order | done |
| S-VIEW-7 | REFERENTIAL_CONSTRAINTS | a foreign key's referenced key and rules | done |
| S-VIEW-8 | CHECK_CONSTRAINTS | a check's condition | done |
| S-VIEW-9 | INDEXES, INDEX_OPTIONS | indexes, their methods, columns and options | done |
| S-VIEW-10 | ROUTINES, PARAMETERS | functions and procedures, and their parameters | done |
| S-VIEW-11 | TRIGGERS | triggers, their events, timing and actions | done |
| S-VIEW-12 | DOMAINS, DOMAIN_CONSTRAINTS | domains and their constraints | done |
| S-VIEW-13 | SEQUENCES | sequence generators | done |
| S-VIEW-14 | USERS | users | done |
| S-VIEW-15 | APPLICABLE_ROLES, ENABLED_ROLES, ADMINISTRABLE_ROLE_AUTHORIZATIONS | roles and their grants | done |
| S-VIEW-16 | TABLE_PRIVILEGES, COLUMN_PRIVILEGES, USAGE_PRIVILEGES, ROUTINE_PRIVILEGES | privileges | done |
| S-VIEW-17 | SERVER, CONNECTIONS, CONNECTION_ATTRIBUTES | the server and session monitor | not yet |
| S-VIEW-18 | JOBS, FILES, MEMORY_RESERVATIONS | the server's work, files and memory | not yet |
| S-VIEW-19 | SETTINGS | session and database settings | not yet |
| S-VIEW-20 | REPLICAS | replication's status | not yet |
| S-VIEW-21 | PROPERTY_GRAPHS, PG_ELEMENT_TABLES, PG_LABELS, PG_EDGE_ENDPOINTS | property graphs, drawn in a model's diagram | done |
| S-VIEW-22 | PARTITIONED_TABLES, PARTITIONS, PARTITION_INDEXES | partitions and their indexes | done |
| S-VIEW-23 | USER_DEFINED_TYPES, ATTRIBUTES, DIRECT_SUPERTYPES, METHOD_SPECIFICATIONS, METHOD_SPECIFICATION_PARAMETERS | user-defined types, with their supertypes, references and methods | done |

## turborel-client

The features of turborel-client Studio uses, as its chapters describe
them.

| ID | Feature | Studio's use | Status |
|---|---|---|---|
| S-CLIENT-1 | Connecting over TCP ([CLIENT Connecting]) | a connection's worker opens it | done |
| S-CLIENT-2 | A Unix socket, or a named pipe on Windows ([CLIENT Connecting]) | a host that is a path | done |
| S-CLIENT-3 | TLS by mode ([CLIENT TLS by mode]) | verify-full by default for every host but a local socket (S-IMPL-6) | done |
| S-CLIENT-4 | SCRAM-SHA-256 and SCRAM-SHA-256-PLUS, and the key cache ([CLIENT The SCRAM key cache]) | a password proved by SCRAM, bound over TLS; one cache for the application | done |
| S-CLIENT-5 | Password, certificate and trust ([CLIENT Connecting]) | as the settings say | done |
| S-CLIENT-6 | Timeouts ([CLIENT Timeouts]) | the connect timeout of the settings; no read limit, as a statement runs as long as it must | done |
| S-CLIENT-7 | The connection URI ([CLIENT The connection URI]) | pasted in the connection dialog | done |
| S-CLIENT-8 | Settings, their layers and the environment ([CLIENT Where settings come from]) | a saved connection's settings, over the environment's | done |
| S-CLIENT-9 | The service file ([CLIENT The service file]) | a connection by service | done |
| S-CLIENT-10 | The password file ([CLIENT The password file]) | a password the keychain does not hold | done |
| S-CLIENT-11 | Several servers and their roles ([CLIENT Several servers]) | hosts in order or at random, read-write or read-only | done |
| S-CLIENT-12 | Cancel ([CLIENT Running statements]) | the toolbar's Cancel, through the canceller, from another thread | done |
| S-CLIENT-13 | Ending a connection ([CLIENT Connecting]) | terminate on close; a lost connection reconnected on request | done |
| S-CLIENT-14 | Prepared statements and cursors ([CLIENT Prepared statements]) | a query's rows a page at a time | done |
| S-CLIENT-15 | The splitter of statements ([CLIENT Controlling the session]) | a script split as the server splits it | done |
| S-CLIENT-16 | Declared types ([CLIENT Prepared statements]) | each column's type as SQL writes it | done |
| S-CLIENT-17 | Notices and conditions ([CLIENT What the server tells]) | the messages pane | done |
| S-CLIENT-18 | The session's status and settings ([CLIENT What the server tells]) | the status bar: user, schema, transaction, read-only, replica | done |
| S-CLIENT-19 | Rows affected, generated values and server time ([CLIENT What the server tells]) | the messages pane and the status bar | done |
| S-CLIENT-20 | A failure's diagnostics ([CLIENT What the server tells]) | the messages pane | done |
| S-CLIENT-21 | Large objects ([CLIENT Large objects]) | read whole for the viewers, a chunk at a time, by `read_lob`; a value longer than a row holds written by `create_lob` | done |
| S-CLIENT-22 | Copying ([CLIENT Copying and exporting]) | importing a file, by `import`, which copies where the server grants it | done |
| S-CLIENT-23 | Exporting, CSV and native ([CLIENT Copying and exporting]) | a result's export, and a statement run straight to a file | done |
| S-CLIENT-24 | Reading CSV ([CLIENT Importing]) | importing a CSV or tab-separated file, previewed first | done |
| S-CLIENT-25 | Ping and reset ([CLIENT Controlling the session]) | checking a connection; a session is not reset | done |
| S-CLIENT-26 | What a connection asks for ([CLIENT What a connection asks for]) | the attribute `application`, Turborel Studio | done |
| S-CLIENT-27 | A connection's role ([CLIENT Several servers]) | the status bar's Replica, from the status SERVER_READ_ONLY | done |

## Capabilities

Studio asks for every capability turborel-client's `connect` asks for:
all but compression ([CLIENT What a connection asks for]). Each is used
as below; a feature whose capability is not granted is shown as such,
never sent.

| ID | Capability | Studio's use | Status |
|---|---|---|---|
| S-CAP-1 | `notices` | the messages pane | done |
| S-CAP-2 | `status` | the status bar | done |
| S-CAP-3 | `diagnostics` | a failure's detail, hint and objects | done |
| S-CAP-4 | `describe` | not used: a statement is prepared again rather than described | done |
| S-CAP-5 | `cursors` | not used: each result has a statement of its own, and one cursor | done |
| S-CAP-6 | `ping` | checking a connection | done |
| S-CAP-7 | `reset` | not used | done |
| S-CAP-8 | `change-user` | not used | done |
| S-CAP-9 | `query-attributes` | not used | done |
| S-CAP-10 | `connection-attributes` | the attribute `application` | done |
| S-CAP-11 | `multi-statement` | not used: a script is split and run a statement at a time (S-STMT-12) | done |
| S-CAP-12 | `compression` | not asked for | done |
| S-CAP-13 | `commit-position` | not used | done |
| S-CAP-14 | `copy` | importing a file | done |
| S-CAP-15 | `row-counts` | rows affected | done |
| S-CAP-16 | `generated-values` | identity values generated | done |
| S-CAP-17 | `fetch-ends` | a cursor's transaction under autocommit, ended as its last row is read or it is closed; the session read again then | done |
| S-CAP-18 | `conditions` | a statement's warnings | done |
| S-CAP-19 | `declared-types` | columns' declared types | done |

## Files

The files Studio keeps, each of format version 1 (R-FMT-1), described in
the manual.

| ID | File | Status |
|---|---|---|
| S-FILE-1 | A schema model, the user's own file | done |
| S-FILE-2 | Saved connections, with no password | done |
| S-FILE-3 | Studio's settings | done |
| S-FILE-4 | The dock's layout | done |
| S-FILE-5 | The assistant's audit log | done |
| S-FILE-6 | The worksheets, with their text | done |
| S-FILE-7 | The history of what ran, with no statement of security | done |
| S-FILE-8 | The favourite queries | done |
| S-FILE-9 | The project folders | done |

## Security

| ID | What | Status |
|---|---|---|
| S-SEC-1 | Passwords and keys in the operating system's keychain alone (R-SEC-1) | done |
| S-SEC-2 | Files owner-only, with no secret (R-SEC-2) | done |
| S-SEC-3 | TLS verified by default; a connection not secure shown so (R-SEC-3) | done |
| S-SEC-4 | Environments by colour; a production connection asks before a statement that writes (R-SEC-7) | done |
| S-SEC-5 | A read-only connection begins each transaction READ ONLY (R-SEC-7) | done |
| S-SEC-6 | A statement that destroys asks first (R-SEC-8) | done |
| S-SEC-7 | The webview's policy and capability (R-SEC-4, R-SEC-5) | done |
| S-SEC-8 | The assistant sends only what the user chose, shown first, and its tools never act alone (R-SEC-12) | done |

## Implementation-defined

The choices Turborel and turborel-client leave to a client, as Studio
makes them.

| ID | Choice | Studio's | Status |
|---|---|---|---|
| S-IMPL-1 | The rows a cursor's fetch asks for | 500 rows, one page | done |
| S-IMPL-2 | A worksheet's transactions: autocommit or not | the connection's, transactions held until Commit or Rollback, Autocommit a toggle of the worksheet's toolbar | done |
| S-IMPL-3 | Connection statements in a worksheet | refused (S-STMT-11) | done |
| S-IMPL-4 | How a script is split | as the server splits it (S-STMT-12) | done |
| S-IMPL-5 | How a value is shown | as text the server's value gives, exact numbers never through a float | done |
| S-IMPL-6 | TLS of a new connection | verify-full, trusting the platform's authorities where the settings name none, below every layer that names a mode; a local socket uses no TLS | done |
| S-IMPL-7 | The application's name, as the server is told it | Turborel Studio, unless the settings name another | done |

## Limits

| ID | Limit | Studio's | Status |
|---|---|---|---|
| S-LIMIT-1 | The rows a result keeps in memory | 8 pages of 500 rows; the rest spooled to disk, sealed, at most 1 GiB a result | done |
| S-LIMIT-2 | The text of a cell the grid draws | its first 500 characters; the value viewer shows it whole | done |
| S-LIMIT-3 | A large object's viewer reads at most | its first 16 MiB, a chunk of 256 KiB at a time | done |
| S-LIMIT-4 | A worksheet's history | 1000 statements, each at most 64 KiB | done |
| S-LIMIT-5 | The rows the assistant's `run_query` returns | the policy's, 100 at first, 1 to 10,000 | done |
