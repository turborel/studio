# TODO

Open work, by area, in the order of Studio's milestones. Each item names
the rows of [CONFORMANCE.md](CONFORMANCE.md) it marks done, where it has
any. An item leaves this file when it is done, and its design choices
become decisions in [RULES.md](RULES.md).

Code never cites this file (R-DOC-5).

## M4 SQL worksheet

- Waiting on the server, shown as unavailable until Turborel has it: a
  debugger of SQL routines, with breakpoints and stepping.

## M8 Analyzer

- The plan viewer: a warning of a sort or hash that spilled, once
  Turborel's EXPLAIN ANALYZE tells it.
- Reports: built-in reports of sizes, once Turborel shows them.
- Waiting on the server, each shown as unavailable, with a line saying
  why, until Turborel exposes it: per-statement statistics; table and
  index statistics; the planner's column statistics; object sizes.

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
