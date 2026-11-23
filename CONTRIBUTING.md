# Contributing to Turborel Studio

Turborel Studio holds the keys to databases people depend on, and runs
statements on them. A statement run that the user did not mean, a
secret let out, or a value shown wrongly can cost far more than a
feature saves. So a change is judged first on whether it keeps every
secret, runs only what the user asked, and shows what the server holds,
and then on what it adds. The process follows the Linux kernel's,
adapted to pull requests and to a desktop application.

[Before you start](#before-you-start) · [Setting up](#setting-up) ·
[Making a change](#making-a-change) ·
[Changes that touch security](#changes-that-touch-security) ·
[The artwork](#the-artwork) ·
[Commit messages](#commit-messages) · [Pull requests](#pull-requests) ·
[Review](#review) · [Reporting issues](#reporting-issues) ·
[Security](#security) · [License](#license)

---

## Before you start

Read [RULES.md](RULES.md) §3 (code), §4 (tests), §6 (process) and the
decisions for your area. Every rule applies to every change, and
`cargo xtask verify` checks those a tool can.
[CONFORMANCE.md](CONFORMANCE.md) says what Studio supports of Turborel,
row by row, and [TODO.md](TODO.md) lists open work.

Open an issue first for anything larger than a fix. That covers new
features, changes to a decision in RULES.md, new settings, and new
dependencies (R-DEP-1). Agreeing on the design first saves everyone a
rewrite.

Turborel's manual is the source of truth for its SQL, its protocol and
its Information Schema
([Turborel Documentation](https://github.com/turborel/turborel/blob/main/doc/README.md)),
and turborel-client is how Studio reaches a server. Read the section
before writing code, and cite it by its heading, as in
`[DOC sql/07-information-schema.md TABLES]` (RULES.md D6). Never cite
from memory.

## Setting up

```
npm ci
cargo xtask verify
cargo xtask coverage
cargo xtask install-hooks
npm exec -- tauri dev
```

Rust's toolchain is the one `rust-toolchain.toml` names, which rustup
installs on first use; Node.js is 24 or later. On Linux, Tauri needs
WebKitGTK 4.1 and its build dependencies, as
[Installing](doc/user/01-installing.md) lists them. `cargo xtask audit`
needs `cargo-deny`, installed into the project:
`cargo install cargo-deny --locked --root .claude/tools`, then
`.claude/tools/bin` on the path.

The live tests run against a server when `TURBOREL_TEST_SERVER` names
one: a `turboreld` program's path, or `docker:` and an image, as
`docker:ghcr.io/turborel/turborel:nightly`. The shared harness starts it
on port 17440, with a data directory of its own under `.claude/`, and
stops it. Without the variable, they are skipped; `cargo xtask coverage`
counts them, so its floors are met with a server named.

CI runs `cargo xtask verify` and a Tauri build on Linux, macOS and
Windows, and the live tests, coverage and the supply chain on Linux
(RULES.md D4, D7, D23). A change that passes on one platform and fails
on another isn't done.

## Making a change

Keep one logical change per commit, and make each commit pass
`cargo xtask verify` on its own, because anyone bisecting may land on
it. Move code in one commit and change it in another. Don't mix a
reformat or rename with a change of behaviour.

Tests come with the change, at the lowest level that shows it
(R-TEST-1): a unit test of the backend or the front end, a test of the
backend against a live server, or a test of the front end over a mocked
IPC. Cover normal cases, boundaries, and failures with the exact SQLCODE
and SQLSTATE expected (R-TEST-2). Each test cites what it verifies
(R-TRACE-1): a Rust test in its doc comment, a TypeScript test in its
title. A fixed defect gets a test that fails without the fix (R-TEST-6).
Use the shared harnesses, one of each kind; never write a framework in
a test file (R-TEST-7).

Documents change in the same commit. Update CONFORMANCE.md for each row
implemented (R-TRACE-4), RULES.md for a decision made or changed, and
TODO.md for open work done or found. When behaviour changes, every
comment and document that describes it changes with it (R-DOC-3). Code
never cites TODO.md.

The manual changes in the same commit too (R-DOC-7). A change to what a
user sees updates each page of [doc/](doc/README.md) that states it,
with its steps and examples run again. The manual is laid out as
Turborel's, since turborel.com's documentation site reads it from every
repository: a chapter begins with its `# Title` and a line
`[Contents](README.md)`, links between its pages and to this
repository's other files are relative links, a link to Turborel's
manual is its GitHub address, `user/01-installing.md` keeps its name,
`doc/` holds no file but its pages and the images of `doc/images/`
(RULES.md D60), and each volume's README.md lists its chapters.

Never leave the README stale (R-DOC-9). A commit that changes what
Studio does, needs or supports, whether a feature, a mode, a
requirement, building and installing, or its status, updates README.md
in that same commit. Read the README against your change before you
push. The README's feature list links the chapter of the User's Guide of
each feature, and `cargo xtask verify` refuses a chapter it does not
link.

Some rules deserve a reminder.

- No dependency is added without a decision in RULES.md (R-DEP-1), and
  no setting without asking the maintainers first (R-SAFE-6).
- Every thread is started by the connection manager or the application's
  task holder, and named (R-SAFE-5).
- Performance claims cite measurements, with the numbers and their
  costs in memory and latency. Numbers go in the commit message, never in
  the code or the manual (R-DOC-8).
- The coverage floors only rise (R-COV-2).

## Changes that touch security

These need more than passing tests. Say in the commit message what was
done for each that applies.

A change to how secrets are kept or used shows that no secret reaches
the webview, a file, a log, the history or the clipboard (R-SEC-1), and
that each file Studio writes is its owner's alone (R-SEC-2).

A change to connecting says what an attacker in the middle of the
connection, or a server of their own, could do before and after it, and
is tested against a live server with the TLS mode or mechanism
concerned (R-SEC-3).

A new command is named in `src-tauri/build.rs`, registered, and granted
in the window's capability, and its arguments are validated in Rust
before use (R-SEC-5, R-SEC-6).

A change to how statements are run keeps the production and
destructive-statement guards on every path a statement can take: typed,
generated by a dialog, or proposed by the assistant (R-SEC-7, R-SEC-8).

A change to the assistant says what it sends, and shows that the user
sees it before it goes, and that no tool acts without the user
(R-SEC-12).

## The manual's pictures

`cargo xtask screenshots` makes the manual's pictures (RULES.md D60);
none is made by hand. Each is a pair, `NAME-light.png` and
`NAME-dark.png`, or `.gif`, shown on the page one line after the other,
of the same alt text, which says what the picture shows, each of its
theme's marker:

```markdown
![The explorer's tree of the demo shop](../images/explorer-tree-light.png#gh-light-mode-only)
![The explorer's tree of the demo shop](../images/explorer-tree-dark.png#gh-dark-mode-only)
```

GitHub and the documentation site show the one of the reader's theme.
The manual's check refuses an image of no alt text, a light image
without its dark one after it, a pair of different alt texts, an image
of a theme without its marker, an image linked rather than shown, and
an image no page shows.

## Adding an import format

The import wizard reads each format through a plug-in, one
`ImportFormat` (RULES.md D68, `core/src/connections/imports/format.rs`).
The preview, the sample, the inferred types, the progress, the cancel
and the error policy are the wizard's, the same for every format, so a
format brings only what is its own:

1. A module beside the others in `core/src/connections/imports/`, as
   `delimited.rs`, `json.rs` or `xlsx.rs`, implementing `ImportFormat`:
   - `id`, `label` and `extensions`: its name, as a reading names it,
     as the wizard shows it, and its files';
   - `takes`: whether it reads a header, a delimiter and a null, or a
     workbook's sheets;
   - `detect`: how surely a file's first 8 KiB are of it, 0 not, 1 by
     what they hold, 2 by the file's name too;
   - `choices`, if a file holds parts to choose among, as sheets;
   - `records`: the file's records as turborel-client's `Source`, a
     record at a time, so memory holds a record whatever the file's
     size, and their total, of bytes counted as they are read, or of
     records;
   - `infer`, only if the shared inference does not fit its values.
2. A variant of `Format`, in `imports.rs`, of its name.
3. A line of `formats()`, in `format.rs`, where the wizard offers it.
4. Its tests: its records read, its failures told by their place, and
   a file of it detected; an import of it on an embedded database in
   `core/tests/embedded/imports.rs`.
5. A crate it needs, if any, recorded as a decision in RULES.md
   (R-DEP-1), and the import section of `doc/user/07-editing-data.md`.

The platform's dialog, the wizard's format list and the choices it
offers come from the plug-ins, so the window needs no change.

## The artwork

The logo, `artwork/studio-logo.svg`, and its form of white text for
dark backgrounds, `artwork/studio-logo-white.svg`, are Studio's mark,
the copper ribbon spiral of its icon, beside the wordmark TURBOREL
STUDIO set in EB Garamond ExtraBold (800), under the SIL Open Font
License, and outlined to paths. The font itself is not committed.

The icon is Studio's vector artwork, `artwork/studio-icon.svg`: the
spiral on a white superellipse tile, 824 on a 1024 grid, with a faint
hairline edge and a transparent margin, the one source for every
platform (RULES.md D21). Beside it, `artwork/studio-icon.png` is the
same rendered at 2048 pixels. To change it:

1. Replace both files with the new artwork, as it is given: never
   redrawn, cropped or recoloured here.
2. Run `cargo xtask icons`. It runs Tauri's CLI on the SVG, which
   writes `src-tauri/icons` (`.icns`, `.ico` and the PNG sizes), and
   removes the CLI's mobile folders.
3. If the mark's colour changed, sample the new accent from the SVG's
   fills and set it in `ui/theme/tokens.ts` and RULES.md D20; the theme
   tests hold its contrast in both themes.
4. Commit the files and the set together, as `build: …`.

## Commit messages

The form is Linux's.

```
area: summary in the imperative, at most 75 characters

The problem: what goes wrong, or is missing, and who it affects. A
secret let out, a statement run unasked, a wrong value shown or a crash
is said first, with the steps that show it.

Why this change, and how it solves the problem. Mention the choices
made and the alternatives rejected, the rules and sections applied
(RULES.md D6, R-SEC-2), and what was measured, with numbers.

Fixes: 54a4f0239f2e ("connections: verify TLS by default")
Closes: <link to the issue>
Reported-by: A Reporter <reporter@example.org>
```

The subject is `area: summary`, at most 75 characters, in the imperative
("refuse a key…", not "refused"), with no full stop. It says what
changes, isn't a file name, and isn't reused within a series.

The body is wrapped at 75 columns and written for someone reading
`git log` years later with no context. Say what the change does in plain
prose, since the diff shows how. Don't write "as discussed" or "v2".

Pick the area where most of the change is.

| Area | Covers |
|---|---|
| `connections` | the connection manager, its workers, settings, TLS, cancel and reconnect |
| `secrets` | the keychain, and what Studio keeps of a secret |
| `ipc` | the commands, their arguments' validation, events and paging |
| `shell` | the window, menus, toolbar, status bar, dock, themes and shortcuts |
| `explorer` | the Object Explorer, the catalog it reads, details and DDL views |
| `worksheet` | the SQL editor, running statements, history, messages and transactions |
| `grid` | the results grid, its viewers and exports |
| `editing` | editing rows, importing, and the table dialogs |
| `modeling` | diagrams, models and schema compare |
| `analyzer` | index views, plans and the analyzer's rules |
| `assistant` | the AI assistant, its providers, tools and audit log |
| `admin` | the server and session monitor, users, roles, settings and replication |
| `doc` | `doc/`, README.md, RULES.md, CONFORMANCE.md, TODO.md, VERSIONING.md, SECURITY.md, AGENTS.md, CLAUDE.md, this file |
| `ci` | `.github/`: workflows, issue forms, labels, Dependabot |
| `build` | manifests, lock files, the checks tool and its configuration, `deny.toml`, the icons, `.githooks/`, `.gitattributes`, `.gitignore` |
| `treewide` | a mechanical change across many areas |

A test goes with the code it tests, in that code's area.

Trailers go at the end, one per line, never wrapped.

| Trailer | Meaning |
|---|---|
| `Fixes: <12+ hex digits> ("<subject>")` | the commit that introduced the defect fixed |
| `Closes: <link>` | the issue this commit resolves |
| `Link: <link>` | background, such as a discussion or an issue fixed only in part |
| `Reported-by:` | who reported the defect fixed, with `Closes:` |
| `Suggested-by:` | who suggested the idea |
| `Co-authored-by:` | a co-author, as GitHub credits one |
| `Reviewed-by:` | a reviewer who checked the change and is satisfied with it |
| `Acked-by:` | a maintainer of the area who approves it without a full review |
| `Tested-by:` | someone who tested it, saying where if that matters |

`Reported-by:` and `Suggested-by:` may be added without asking. The
others name someone who said so on the record.
`git log -1 --abbrev=12 --pretty='Fixes: %h ("%s")' <commit>` writes the
`Fixes:` line.

No commit or pull request carries AI or agent attribution: no
`Co-authored-by:` of an agent, no "Generated with" line, and no
`Signed-off-by:` (R-PROC-8). Whoever submits a change answers for it.

Stage a commit by an explicit list of its paths,
`git add -- <path> ...`, never `git add -A` or `git add .` on the whole
tree, so nothing comes along unasked.

## Pull requests

A pull request is a patch series, and its description is the cover
letter. The template asks for what and why, the series commit by commit,
testing, and what a user sees change. Each commit message still stands
alone.

Base it on `main` and keep it rebased, without merging `main` into it.
When revising, rewrite the commits so the series is again what should be
merged, with no "fix review comments" commits. Force-push, and say in a
comment what changed since the last version.

Trailers given in review go into the commits they cover. Drop them from
a commit that later changes substantially, and say so.

Keep a series to about 15 commits. Split a larger one into series that
each stand alone.

## Review

Reviewers check each commit against RULES.md §6's checklist, and that
the manual is updated (R-DOC-7). For
[changes that touch security](#changes-that-touch-security), they also
check what the commit message says was done. Review comments are about
the change, never the person. A reviewer who is satisfied gives
`Reviewed-by:`.

## Reporting issues

Use the issue forms, **Bug**, **Conformance**, **Performance** or
**Feature**. Conformance means Studio departing from Turborel's manual or
from turborel-client, or from what CONFORMANCE.md says it supports. Try
the latest `main` first, and add to an existing issue that matches
rather than opening another.

Reproduce with the smallest steps that show it, with the statements,
the schema and the data they need. A problem of the server itself, which
Turborel's own command-line client shows too, goes to
[turborel](https://github.com/turborel/turborel/issues).

State the impact first. Put it in the title's first word when it is
severe.

| Tag | Meaning |
|---|---|
| `[DATA LOSS]` | data changed or lost that the user did not mean to change |
| `[WRONG RESULT]` | a value, row or definition shown differs from what the server holds |
| `[CRASH]` | Studio brought down, or a failure not explained |
| `[HANG]` | a window that stops answering, or a statement that cannot be cancelled |
| `[REGRESSION]` | worked in an earlier commit (give the last good commit and, if you can, the first bad one) |

Give the commit (`git rev-parse --short=12 HEAD`), the platform and its
version, the server's version, and the connection's settings, with any
password left out.

## Security

Don't open a public issue for a vulnerability. Report it privately, as
[SECURITY.md](SECURITY.md) says.

## License

Turborel Studio is under the BSD-2-Clause Plus Patent License in
[LICENSE](LICENSE), and a contribution is made under that license.
Contributors keep their copyright and own their changes. Whoever
submits a change answers for all of it, however it was written.
