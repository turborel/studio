# TODO

Open work, by area, in the order of Studio's milestones. Each item names
the rows of [CONFORMANCE.md](CONFORMANCE.md) it marks done, where it has
any. An item leaves this file when it is done, and its design choices
become decisions in [RULES.md](RULES.md).

Code never cites this file (R-DOC-5).

## M4 SQL worksheet

- Waiting on the server, shown as unavailable until Turborel has it: a
  debugger of SQL routines, with breakpoints and stepping.

## M6 Data

- Parquet files imported, once a crate fits R-DEP-2: the Apache Arrow
  project's `parquet` crate, Apache-2.0, is the one of note, and it
  brings the Arrow crates and a codec of each compression with it; a
  plug-in of the import formats (D68) once that weight is taken.

## M8 Analyzer

- Waiting on the server, shown as unavailable, with a line saying why,
  until Turborel exposes it: the planner's column statistics; and EXPLAIN
  without ANALYZE of a data change, a plan of it that runs nothing, for
  the assistant's estimate of an UPDATE or DELETE and its Explain.

## M9 Assistant

- A check against the real API, for a maintainer to run with a key, as no
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

- A check across machines, for a maintainer: two computers on one network,
  one presenting and one joining directly; then both through a
  `studio-relay` on a third, reached by its address and fingerprint.

## M12 Polish and the security audit

- Keyboard schemes: sets of key bindings to choose among, beside each
  command's own key, which Settings already rebinds.
- The keychain checked by hand on Windows and Linux, as on macOS, by the
  test STUDIO_TEST_KEYCHAIN runs.
- Signing and notarization of the installers, once the maintainers'
  signing certificates exist; until then they are unsigned.
- The nightly's trigger after verify on main, written and left off,
  turned on once its installers are seen to build on each platform; and
  macOS on Intel, once a runner of its own is there.
- The full manual, every feature checked again against turborel-client
  and Turborel's manual at the pinned commit.
