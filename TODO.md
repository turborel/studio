# TODO

Open work, by area, in the order of Studio's milestones. Each item names
the rows of [CONFORMANCE.md](CONFORMANCE.md) it marks done, where it has
any. An item leaves this file when it is done, and its design choices
become decisions in [RULES.md](RULES.md).

Code never cites this file (R-DOC-5).

## M2 Shell

- Menus, the toolbar, the status bar, keyboard shortcuts, Studio's
  settings, and the dock's layout saved and restored (S-FILE-3,
  S-FILE-4).
- The connection dialog and saved connections, their passwords in the
  keychain (S-FILE-2, S-SEC-1 to S-SEC-3).
- Environments marked by colour; production's confirmation of writes;
  read-only connections (S-SEC-4, S-SEC-5).
- The status bar of the session, as the server tells it: user, schema,
  transaction, read-only, secure or not, primary or replica
  (S-CLIENT-18, S-CLIENT-27).

## M3 Object Explorer

- The catalog tree from the Information Schema (S-VIEW-1 to S-VIEW-16,
  S-VIEW-22, S-VIEW-23).
- Search, the details panel and the DDL view.

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
- Waiting on the server, shown as unavailable until Turborel has it: a
  debugger of SQL routines.

## M5 Results grid

- Paged, virtualized rows with declared types (S-TYPE-1 to S-TYPE-21,
  S-IMPL-5, S-LIMIT-2).
- Sort, filter, copy and export, as CSV and native (S-CLIENT-23).
- Viewers of large objects, JSON and XML; several results per script
  (S-CLIENT-21, S-LIMIT-3).

## M6 Data and definitions

- Editing rows, staged and run in a transaction; importing CSV by copy
  (S-CLIENT-22, S-CLIENT-24).
- Create and alter table dialogs that show their DDL before it runs.

## M7 Schema modeling

- ER diagrams of a live schema and of property graphs, laid out, saved
  and exported (S-VIEW-21).
- Models designed offline (S-FILE-1), compared with a live schema, and
  their DDL script; schema compare.

## M8 Analyzer

- Index views, the plan view, and the analyzer's rules, each with its
  fix as SQL; what-if indexes.
- Waiting on the server, each shown as unavailable, with a line saying
  why, until Turborel exposes it: a plan with actual rows and timings;
  per-statement statistics; table and index statistics; the planner's
  column statistics.

## M9 Assistant

- Providers behind a trait: Claude, and the user's own model in both
  wire formats; the tools; what is sent shown first; the audit log
  (S-FILE-5); the mock model server (S-SEC-8, S-LIMIT-5).
- A manual check against the real API, for the owner to run with a key.

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

## M12 Polish and the security audit

- Accessibility and keyboard reach; large results and long sessions.
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
