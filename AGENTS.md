# Guide for coding agents

How to work on Turborel Studio as a coding agent, with any tool. If this
file disagrees with [RULES.md](RULES.md) or
[CONTRIBUTING.md](CONTRIBUTING.md), follow those.

Turborel Studio is the desktop database IDE for Turborel, a relational
database system: a Tauri application with a Rust backend over
turborel-client, Turborel's own client library, and the `turborel`
crate's embedded library, which opens embedded and in-memory databases
in Studio's own process (RULES.md D59), and a front end in TypeScript
and React. See [README.md](README.md).

## Before you change anything

Read RULES.md §3 (code), §4 (tests), §6 (process) and the decisions for
your area. Read CONTRIBUTING.md for how a change is made and the extra
checks for changes that touch security. Read the page of Turborel's
manual your change relies on, and the rows of CONFORMANCE.md it marks
done.

## Build and check

Every change must pass `cargo xtask verify` and `cargo xtask coverage`
before it is handed back.

```
npm ci
cargo xtask verify
cargo xtask coverage
cargo xtask audit
npm exec -- tauri dev
```

`cargo xtask verify` stops at the first failure (RULES.md D4). CI runs
it, and a Tauri build, on Linux, macOS and Windows, and the live tests,
coverage and the audit on Linux. The coverage floors only rise (D7,
R-COV-2).

Project automation is a `cargo xtask` command, never a shell script;
npm scripts only call tools (R-PROC-5).

## Where things are

| Path | What |
|---|---|
| `core/` | the backend, everything but drawing, tested without a window (D1) |
| `src-tauri/` | the application: window, commands, capability, bundles (D1, D9) |
| `ui/` | the front end; `ui/ipc/` is its one way to the backend (R-TS-3) |
| `xtask/` | the checks tool (D19) |
| `doc/` | the manual (R-DOC-7) |

Turborel's manual, in
[turborel](https://github.com/turborel/turborel/blob/main/doc/README.md),
is the source of truth for SQL, the protocol and the Information Schema.
turborel-client is pinned to one commit of Turborel's main (D10); read
its code at that commit when its pages are silent.

## The rules every Turborel repository keeps

- **Never name another database** or its client libraries, in any file,
  comment, test, metadata or commit. Describe Studio in its own terms.
  Standards (ODBC, JDBC) and toolkits (Tauri, React, CodeMirror) are
  fine. Name no other database IDE as a model.
- **Contributors own their code:** no AI or agent attribution, no DCO,
  no `Signed-off-by:` (R-PROC-8).
- **No shell scripts:** automation is `cargo xtask` (R-PROC-5).
- **Readable docs:** each decision in RULES.md is short bullets led by a
  bold label, then *Why:*. TODO.md holds open work only, grouped by
  area; finished work leaves it, and its choices become decisions. No
  history or "done" notes.
- **Docs match the code:** every sentence of `doc/` is checked against
  what Studio does, and every example and step is run (R-DOC-7).
- **Comments follow changes:** when behaviour changes, every comment,
  page and line of RULES, TODO and CONFORMANCE describing it changes in
  the same commit (R-DOC-3).
- **No benchmarks in docs:** no timings or speedups in comments, `doc/`
  or RULES; figures go in TODO.md or a commit message (R-DOC-8).
- **Code never cites TODO.md:** only RULES (D and R IDs), CONFORMANCE
  and Turborel's manual (R-DOC-4); `cargo xtask rules` enforces it.
- **Production-grade dependencies:** check each one's own readiness
  claims, license and build needs in its current docs, and record it as
  a decision (R-DEP). No `ring`: TLS is rustls on aws-lc-rs.
- **Portable:** Linux, macOS and Windows; a platform's extra behind
  `cfg`, refused clearly elsewhere; paths through `Path` (R-PLAT).
- **One harness per kind:** one Rust live-server harness, one Vitest
  setup, one mock model server (R-TEST-7).
- **Formats stay at 1:** the model file, settings, saved connections,
  the layout and the audit log each carry format 1, and change in place
  during the alpha (R-FMT-1).
- **Threads are named and held** by the connection manager or the task
  holder, none started ad hoc. Settings are named for what they
  control, and a new one is raised with the maintainers first (R-SAFE-5,
  R-SAFE-6).

## Rules that are broken most often

`cargo xtask verify` treats every warning as an error (R-LINT-1).
RULES.md §3 and §4 have the full list.

- No secret in the webview, a file, a log, the history or the clipboard
  (R-SEC-1). The front end sees "saved" or "not saved", never a value.
- Every command's argument validated in Rust (R-SEC-6), and every new
  command named in `build.rs`, registered and granted (R-SEC-5).
- Every statement path goes through the production and destructive
  guards (R-SEC-7, R-SEC-8).
- No result held whole: rows come a page at a time (R-SAFE-1).
- No panics in library code: no `unwrap`, `expect` or indexing that can
  fail (R-ERR-1).
- Functions to 50 lines of code and 5 parameters, files to 600 lines
  (R-SIZE).
- No magic numbers or strings: SQL, view names, command names and file
  keys are named constants (R-CONST).
- Every public item has a doc comment (R-DOC-1), and comments say why
  (R-DOC-2).
- A silenced warning names its rule and says why (R-LINT-3).

## Tests

Every test cites what it verifies (R-TRACE-1, D6): a Rust test in its
doc comment, a TypeScript test in its title.

- `[CLIENT <heading>]`, a section of Turborel's `02-library.md` or
  `02-library-connections.md`;
- `[DOC <page> <heading>]`, a section of another page of Turborel's
  manual;
- `[STUDIO <heading>]`, a section of this repository's manual;
- `[DESIGN] D<n>` and `[RULE] R-<id>`, of RULES.md.

The checks tool refuses a heading, decision or rule that is not there
(R-TRACE-2). Tests are deterministic, with no clock, randomness or
network beyond loopback (R-TEST-5). A fixed defect gets a regression
test that fails without the fix (R-TEST-6). No test calls a real model
(R-TEST-9).

Live tests run when `TURBOREL_TEST_SERVER` names a server: locally
Turborel's `turboreld`, on port 17440, with a data directory under the
repository's ignored `.claude/`. The shared harness starts it and stops
it; stop only the processes you started, and wait on their IDs alone.

## Documents

**Never leave the README stale** (R-DOC-9). A commit that changes what
Studio does, needs or supports, whether a feature, a mode, a
requirement, building and installing, or its status, updates README.md
in that same commit, with the pages of the manual it touches. Before
each push, read the README against what the commit changed. The checks
tool refuses a chapter of the User's Guide the README's feature list
does not link.

A finished feature updates these in the same change:

- RULES.md, if it made a decision, including the row in §1's table;
- CONFORMANCE.md, each row it implements (R-TRACE-4), marked done only
  where its code exists and its tests pass;
- TODO.md, which only holds open work;
- [doc/](doc/README.md), for anything a user sees (R-DOC-7), every step
  and example run: each page keeps its `# Title` and its
  `[Contents](README.md)` line, links to this repository's files are
  relative, links to Turborel's manual are GitHub addresses,
  `user/01-installing.md` keeps its name, and `doc/` holds no file but
  its pages and the images of `doc/images/` (RULES.md D60);
- README.md, whenever what Studio does, needs or supports changes
  (R-DOC-9).

## Commits

- Commit only when the maintainer asks, and never push without approval.
- Follow CONTRIBUTING.md's form, with one logical change per commit.
- Stage with an explicit path list, `git add -- <path> ...`. Never use
  `git add -A` or `git add .` on the whole tree.
- Never stage scratch files, or a live test's data directory.
- Code compiled for one platform only can't be verified locally on
  another. Say so when handing it back (R-PLAT-4).
