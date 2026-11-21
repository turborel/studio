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

- A check against the real API, for the owner to run with a key, as no
  test calls a real model:
  1. Build Studio, open a saved connection of a development database
     that holds a table or two, and **View > Assistant Settings…**: turn
     the assistant on, keep Claude and `claude-opus-5-5`, and save a key.
  2. Ask "Which tables have no primary key?" with a worksheet's SQL
     sent: the preview shows the body, of no key; **Send**; the answer
     streams, `list_tables` and `describe_table` are shown with their
     outcomes, and the turn ends with its tokens.
  3. Ask the same again: the turn's tokens name some read of the cache.
  4. Ask it to count a table's rows: `run_query` asks, with its class,
     objects and estimate; **Run**; the count comes back.
  5. Ask it to drop the table: its draft is shown in red, blocked, and
     its worksheet runs only once the table's name is typed.
  6. Set the level to **Explain only**, ask it to count rows again:
     `run_query` is shown blocked by `LEVEL`.
  7. **Show the Log**: each request is there, of no key; **Clear the
     Log** empties it.
  8. Choose a model of the user's own, a local model server's
     chat-completions endpoint, and ask again.

## M10 Live Sessions

- A check across machines, for the owner: two computers on one network,
  one presenting and one joining directly; then both through a
  `studio-relay` on a third, reached by its address and fingerprint.
- Whether Turborel runs a public relay, and its address, is the owner's
  decision; until then no relay is set.

## M11 Administration

- Waiting on the server, shown as unavailable until Turborel has it:
  each session's current statement, and per-statement statistics.

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
