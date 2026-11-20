# TODO

Open work, by area, in the order of Studio's milestones. Each item names
the rows of [CONFORMANCE.md](CONFORMANCE.md) it marks done, where it has
any. An item leaves this file when it is done, and its design choices
become decisions in [RULES.md](RULES.md).

Code never cites this file (R-DOC-5).

## M3 Object Explorer

- The catalog tree from the Information Schema (S-VIEW-1 to S-VIEW-16,
  S-VIEW-22, S-VIEW-23).
- Search, the details panel and the DDL view.
- Favourite objects pinned at the top of the explorer.
- Filter and search the tree, inside definitions too: routine bodies,
  views, triggers and checks.
- Drag a table into the editor to write a SELECT or INSERT of its
  columns.
- Script as CREATE, ALTER, DROP, SELECT, INSERT, UPDATE and DELETE, to a
  worksheet, the clipboard or a file; scripts of a whole schema or of
  objects chosen.
- A dependencies view: what an object uses, and what uses it.

## M4 SQL worksheet

- CodeMirror 6, its Turborel SQL mode from Turborel's key words, and
  completion from the catalog.
- Running the statement at the cursor, the selection or the script;
  cancel; history (S-STMT-1 to S-STMT-12, S-CLIENT-15, S-IMPL-2 to
  S-IMPL-4, S-LIMIT-4).
- Notices and conditions in the messages pane, with each failure's
  diagnostics, the rows changed, values generated and the server's time;
  transaction state, commit and rollback; destructive statements
  confirmed (S-CLIENT-17, S-CLIENT-19, S-CLIENT-20, S-CAP-1, S-CAP-17,
  S-SEC-6).
- A plan view of EXPLAIN.
- The confirmation a statement's guards ask for, shown before it runs:
  production's of a write, and every connection's of a statement that
  destroys or is not classified (S-SEC-4, S-SEC-6).
- Worksheet tabs pinned, coloured by their connection; a script run
  against each connection of a folder, with results per connection.
- Snippets with placeholders; a SQL formatter; comment, change case,
  multiple cursors, find and replace by regex, bookmarks, a split
  editor, folding and an outline of the script's statements.
- Go to an object's definition, describe it on hover, and parameter
  hints of routines.
- Bind variables, `?` and named, asked for and remembered; script
  variables, substituted before running and shown.
- Worksheets autosaved and restored after a crash; saved as `.sql` files
  in project folders.
- History searchable by time, connection, duration and rows, run again;
  favourite queries.
- A notification when a long statement ends while the window is in the
  background.
- Waiting on the server, shown as unavailable until Turborel has it: a
  debugger of SQL routines.

## M5 Results grid

- Paged, virtualized rows with declared types (S-TYPE-1 to S-TYPE-21,
  S-IMPL-5, S-LIMIT-2).
- Sort, filter, copy and export, as CSV and native (S-CLIENT-23).
- Viewers of large objects, JSON and XML; several results per script
  (S-CLIENT-21, S-LIMIT-3).
- A result tab pinned, so the next run opens one beside it.
- Results as a grid, as text, or to a file; columns frozen; one row as a
  form.
- The status bar's count, sum, average, least and greatest of the cells
  selected.
- Copy with or without headers, as CSV, TSV, JSON, Markdown or INSERT.
- Two results compared; timing and rows of each run, compared across
  runs.
- Viewers of spatial values on a map or plane, property graph results as
  nodes and edges, and vectors.

## M6 Data and definitions

- Editing rows, staged and run in a transaction; importing CSV by copy
  (S-CLIENT-22, S-CLIENT-24).
- Edit a table's first N rows, or a filtered set, in the grid.
- A data compare of two tables or connections, writing the statements
  that sync them.
- Import and export wizards.
- Create and alter table dialogs that show their DDL before it runs.

## M7 Schema modeling

- ER diagrams of a live schema and of property graphs, laid out, saved
  and exported (S-VIEW-21).
- Models designed offline (S-FILE-1), compared with a live schema, and
  their DDL script; schema compare.
- A visual query builder: tables picked, joins from their foreign keys,
  columns, filters, grouping and order, its SQL written live in a
  worksheet.

## M8 Analyzer

- Index views, the plan view, and the analyzer's rules, each with its
  fix as SQL; what-if indexes.
- The plan view's actual figures, by EXPLAIN ANALYZE, which main now
  gives: each operator's estimated rows against its actual rows, loops
  and probes, a large misestimate marked, its time where the server gives
  one, `(never run)` shown so; two plans compared, before and after. It
  runs the query, so it is run only when the user asks, never of itself;
  its text read as main's EXPLAIN page gives it, the tests on that page's
  examples.
- Reports: built in (object counts and sizes, files, indexes,
  privileges, sessions and settings) and the user's own, a saved query
  shown as a table or a chart, with parameters.
- Waiting on the server, each shown as unavailable, with a line saying
  why, until Turborel exposes it: per-statement statistics; table and
  index statistics; the planner's column statistics.

## M9 Assistant

- Providers behind a trait: Claude, and the user's own model in both
  wire formats; the tools; what is sent shown first; the audit log
  (S-FILE-5); the mock model server (S-SEC-8, S-LIMIT-5).
- A manual check against the real API, for the owner to run with a key.
- Guard rails, in code and the database, never the prompt: policy levels
  per connection (Off, Explain only, Read, Propose changes), production
  Off by default and at most Read; the hard floor, which the classifier
  marks already; allow and deny lists by class, schema and table, and
  tables hidden from the assistant; limits on rows, statement time, tool
  calls and tokens; a login of its own for the assistant; each statement
  shown with its class, objects and estimate, and each block with its
  rule; the policy file, format 1; a corpus of statements blocked at
  every level, run in CI.

## M10 Live Sessions

- Present and Join: a presenter shares the workspace's state live with
  viewers, never a secret, the connection or its settings; invites,
  approval by a safety code, QUIC on TLS 1.3 with the certificate pinned,
  end to end through a relay, revoked at any time; the policy file; the
  `studio-relay` program; their tests.

## M11 Administration

- The server and session monitor, END and CANCEL CONNECTION, users,
  roles and privileges, settings and replication status (S-VIEW-17 to
  S-VIEW-20).
- Waiting on the server, shown as unavailable until Turborel has it:
  each session's current statement.
- The server's counters from SERVER over time, JOBS, FILES and
  MEMORY_RESERVATIONS; backups and restore points from BACKUPS and
  RESTORE_POINTS.

## M12 Polish and the security audit

- Accessibility and keyboard reach; large results and long sessions.
- Keyboard schemes; tab colours.
- The keychain checked by hand on Windows and Linux, as on macOS, by the
  test STUDIO_TEST_KEYCHAIN runs.
- The security review of the whole application, each finding fixed or
  written here.
- Unsigned installers: `.dmg`, `.msi`, `.AppImage` and `.deb`. Signing
  and notarization wait for the owner's certificates.
- The nightly: a workflow, as Turborel's, that builds the installers after
  verify passes on main and replaces the one `nightly` pre-release, its
  files at fixed names with SHA-256 sums; Installing then tells how to
  open an unsigned build and check the sums, and the README points to it.
- The full manual, every feature checked against turborel-client and
  Turborel's manual.
