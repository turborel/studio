# Turborel Studio rules

How Turborel Studio is designed, written and verified. Every change
follows these rules; `cargo xtask verify` checks those a tool can check,
and review checks the rest.

Rules (R-…) say how code and tests are written. **shall** is mandatory,
and a departure needs a decision recorded here (§7). **should** is
expected, and a reviewer may accept a reasoned exception.

Decisions (D1…) record how Studio is built and why. Change one only by
changing this file in a reviewed commit. A decision says what was chosen
and why, and the module it names holds the mechanism.

Cite both by ID in code, tests, reviews and commit messages, as in
`RULES.md D6` or `R-SEC-2`.

The rules are those of every Turborel repository: Turborel's own
[RULES.md](https://github.com/turborel/turborel/blob/main/RULES.md) and
its drivers', adapted to a desktop application. Decisions D1 to D8 have
the same subjects as the drivers'; Studio's own begin at D9, and its own
requirements are in families of their own (R-SEC, R-UI, R-FMT, R-TS).

Before changing code, read §3 (code rules), §4 (test rules) and the
decisions covering your area. What Studio supports of Turborel is in
[CONFORMANCE.md](CONFORMANCE.md), and open work is in [TODO.md](TODO.md).

[1 Decisions](#1-decisions) · [2 Layout](#2-project-layout) ·
[3 Code](#3-code-rules) · [4 Tests](#4-test-rules) ·
[5 Coverage](#5-coverage) · [6 Process](#6-process-and-tools) ·
[7 The decisions](#7-the-decisions) · [8 References](#8-references)

---

## 1. Decisions

Each is told in full in [§7](#7-the-decisions).

| # | Decision |
|---|---|
| **The subjects every Turborel repository decides** | |
| D1 | A Tauri application: a Rust backend over turborel-client, a webview that holds no secret |
| D2 | The front end: React and TypeScript on Vite |
| D3 | The platforms and the toolchains |
| D4 | One command runs every check, before each commit and in CI on three platforms |
| D5 | The version is the Turborel release's: 0.0.0 in the alpha |
| D6 | Tests and code cite Turborel's documents by their headings |
| D7 | Coverage floors, enforced in CI, that only rise |
| D8 | Where these rules depart from the toolkits' conventions |
| **Studio's own** | |
| D9 | Tauri 2 for the desktop shell |
| D10 | turborel-client, a git dependency at a pinned commit |
| D11 | React 18, the version Glide Data Grid supports |
| D12 | CodeMirror 6 for the SQL editor |
| D13 | Glide Data Grid for results |
| D14 | dockview for the dockable panels |
| D15 | React Flow and dagre for schema diagrams |
| D16 | The keychain through keyring-core and each platform's store |
| D17 | serde and serde_json for the IPC and the files |
| D18 | The front end's tools: Vite, TypeScript, ESLint, Prettier and Vitest |
| D19 | The checks tool is Rust, in `xtask/` |
| D20 | Two themes, their accent the icon's maroon |
| D21 | The icon set, made from the owner's icon by `cargo xtask icons` |
| D22 | The webview's content security policy |
| D23 | The supply chain: cargo deny and npm audit |
| D24 | Each connection on a worker thread the manager holds |
| D25 | A result read through its cursor, its pages spooled sealed |
| D26 | Studio's defaults for a connection: TLS verified, its name told |
| D27 | The live tests: one harness, one server, made as it starts |
| D28 | Saved connections: a file of no secret, passwords in the keychain |
| D29 | Guards on what runs, by Turborel's own parser |
| D30 | Commands by name: the menus, the keys and the palette |
| D31 | The front end's state: one store per window |
| D32 | A connection's colour tints the window |
| D33 | The catalog: the Information Schema, read as the tree opens |
| D34 | A file saved through the platform's dialog, by the backend |
| D35 | Icons: Phosphor's, one set, in the theme's colours |
| D36 | Worksheets: scripts split as the server splits them, run through the guards |
| D37 | The editor: CodeMirror 6 in Turborel's SQL |
| D38 | A run's end notified by the platform, from the backend |
| D39 | Results: paged in a canvas grid, sorted and filtered on the server, values read whole for their viewers |
| D40 | Completion: of the place, from the parser's scope and the catalog's cache |
| D41 | Data: values written as the grid shows them |
| D42 | Rows edited in the grid, staged, applied in one transaction |
| D43 | Imports and exports of a table, through the backend |
| D44 | Tables made and altered by dialogs that write their DDL |
| D45 | Rows compared by the target's key, synced by a script |
| D46 | Models: a schema's tables as a diagram, kept as a file of their own |
| D47 | A schema taken to a model, or to another schema, by a script |
| D48 | The query builder: a query written into a worksheet as it is built |
| D49 | A window that never goes blank: failures shown and logged, files that do not fit set aside, a smoke test of the real window |
| D50 | The analyzer: rules of the catalog and the plan, each finding's fix as SQL |
| D51 | What-if indexes: made, explained and dropped, only when asked |
| D52 | Reports and charts: queries shown as tables or charts, the user's kept |
| D53 | Context menus everywhere, of the registry, and a new worksheet a click away |
| D54 | The plan viewer: a summary, a flow, a tree-table, the stages, the raw text last |

---

## 2. Project layout

| Path | What |
|---|---|
| `Cargo.toml` | the Rust workspace: the version (D5), the pinned Turborel commit (D10), every Rust dependency and the lints |
| `core/` | `turborel-studio-core`, the backend: everything Studio does but draw, tested without a window (D1) |
| `core/src/connections/` | the connection manager and its workers (D24), settings (D26), statements' outcomes, results paged (D25), values read whole and exports (D39), and imports (D43) |
| `core/src/guard/` | statements classified, and the guards on what runs (D29) |
| `core/src/catalog/` | the catalog read from the Information Schema, and the definitions written of it (D33) |
| `core/src/worksheet/` | scripts split, the history, the worksheets and queries kept, and the files a worksheet may use (D36) |
| `core/src/saved.rs`, `secrets.rs` | saved connections, and the keychain (D16, D28) |
| `core/src/preferences.rs`, `store.rs` | settings and the layout, and Studio's files of format 1 (R-FMT-1) |
| `core/src/failures.rs` | the window's failures' log (D49) |
| `xtask/smoke/earlier/` | an earlier build's app data, for the smoke test of the real window (D49) |
| `core/tests/live/` | the live tests, their harness and server (D27) |
| `src-tauri/` | `turborel-studio`, the application: the window, its capability and the commands, each a thin layer over `core` (D1, D9) |
| `src-tauri/build.rs` | names each command, so each is a permission (R-SEC-5) |
| `src-tauri/capabilities/` | what each window may call (R-SEC-5) |
| `src-tauri/tauri.conf.json` | the window, the content security policy (D22) and the bundles |
| `src-tauri/src/menu.rs` | the menu bar (D30); `src-tauri/tests/menu.rs` its test, on the main thread |
| `src-tauri/icons/` | the icon set, made by `cargo xtask icons` (D21) |
| `package.json`, `package-lock.json` | the front end's packages, pinned (D18, R-DEP-3) |
| `ui/` | the front end, in TypeScript and React (D2) |
| `ui/ipc/` | the typed commands, the front end's one way to the backend (R-TS-3) |
| `ui/theme/` | the themes' palettes (D20) |
| `ui/icons/` | the icons, by what each stands for (D35) |
| `ui/shell/` | the dock, toolbar, status bar, dialogs and the explorer's connections |
| `ui/explorer/` | the catalog's tree, the details panel and the definition view (D33) |
| `ui/worksheet/` | the worksheet, its editor, panes, plan view, formatter and dialogs (D36, D37) |
| `ui/worksheet/complete/` | completion, and the copy of Turborel's built-in functions (D40) |
| `ui/results/` | a result's grid, its views and viewers, its copies, exports and comparisons, the timings (D39), and its rows edited (D42) |
| `ui/model/` | models: their diagram, file, tables designed, and comparisons with schemas (D46, D47) |
| `ui/builder/` | the query builder (D48) |
| `core/src/analyzer.rs` | the analyzer's rules of the catalog and the settings (D50) |
| `core/src/reports.rs` | the built-in reports, and the user's kept (D52) |
| `ui/plan/` | the plan's parser, summary, flow, tree-table and viewer (D54) |
| `ui/shell/ContextMenu.tsx` | the context menus, their items of the command registry (D53) |
| `ui/analyzer/` | the analyzer's dialog, the plan's rule and findings, what-if indexes and reports (D50, D51, D52) |
| `ui/data/` | the dialogs of a table's data and definitions: its rows edited, imported, exported and compared, and tables made and altered (D42 to D45) |
| `ui/state/` | the window's store and its actions (D31) |
| `ui/commands/` | the commands and their keys (D30) |
| `ui/test/` | the one Vitest setup and the one mock of the backend (R-TEST-7) |
| `xtask/` | the checks tool (D19) and its copy of Turborel's headings (D6) |
| `artwork/` | Studio's logo, and its icon, the source of the icon set (D21) |
| `doc/` | the manual (R-DOC-7) |
| `.github/` | CI, issue forms, the pull request template, labels, Dependabot |
| `.githooks/pre-commit` | hands over to the checks tool (D4) |
| `deny.toml` | cargo deny's policy (D23) |

---

## 3. Code rules

The tools named by "the formatter", "the linters", "the type checker" and
"the checks tool" are D4's: rustfmt and Prettier, Clippy and ESLint,
`tsc`, and `cargo xtask`.

### R-STYLE: formatting and idiom

| ID | Rule | Checked by |
|---|---|---|
| R-STYLE-1 | Code **shall** be formatted by the formatter. | the formatter |
| R-STYLE-2 | Names **shall** follow the language's own conventions; code for a view, statement or setting of Turborel is named after it, as Turborel's manual names it. | the linters; review |
| R-STYLE-3 | Library code **shall not** print, or write to a stream it was not given; the front end **shall not** write to the console. | the linters |
| R-STYLE-4 | What is not public **shall** be private, by the language's own means. | review |

### R-SIZE: short functions and files

| ID | Rule | Checked by |
|---|---|---|
| R-SIZE-1 | A function **shall** have at most 50 lines of code, blank lines and comments not counted. | the linters |
| R-SIZE-2 | A source file **shall** have at most 600 lines; split it by concept. | the linters; the checks tool |
| R-SIZE-3 | A function **shall** take at most 5 parameters; else a structure or an options object. | the linters |
| R-SIZE-4 | A module **should** hold one concept, stated in its doc comment. | review |
| R-SIZE-5 | A function's complexity **shall** be at most 15, and its blocks nested at most 5 deep. | the linters |

### R-DOC: comments and documentation

| ID | Rule | Checked by |
|---|---|---|
| R-DOC-1 | Every public item **shall** have a doc comment, rustdoc or TSDoc, saying each parameter, what it returns, and each failure it gives. | the linters; review |
| R-DOC-2 | Comments **shall** say *why*: the section implemented, the choice made, the invariant relied on. | review |
| R-DOC-3 | When behaviour changes, every comment, page of `doc/`, and line of RULES.md, CONFORMANCE.md and TODO.md that describes it **shall** change in the same commit. | review |
| R-DOC-4 | Behaviour Turborel governs **shall** cite Turborel's manual by its heading; Studio's own choices cite their decision (D6). Code cites RULES.md, CONFORMANCE.md and Turborel's manual, never TODO.md. | review; the checks tool |
| R-DOC-5 | No commented-out code, and no open-work markers in code: open work goes in TODO.md, which code never names. | the checks tool |
| R-DOC-6 | Every Rust source file **shall** begin with a doc comment giving its responsibility; every TypeScript module with a TSDoc block. | the checks tool; review |
| R-DOC-7 | A change a user can see **shall** update the manual, `doc/`, in the same commit; every claim is checked against the code, and every example and step is run. The manual keeps Turborel's layout, which turborel.com's documentation site reads: each page opens with its `# Title` and a line holding only `[Contents](README.md)`, each volume's README.md lists its pages, links within `doc/` and to this repository's files are relative links that resolve, a link to Turborel's own manual is its GitHub address, `user/01-installing.md` keeps its name, and `doc/` holds no images. | review; the checks tool |
| R-DOC-8 | No document or comment gives timings or speedups; figures go in TODO.md or a commit message. | review |

### R-CONST: no magic numbers or strings

| ID | Rule | Checked by |
|---|---|---|
| R-CONST-1 | Numbers other than `0` or `1` **shall** be named constants, documenting the value's source. | the linters; review |
| R-CONST-2 | SQL Studio sends, the names of Turborel's views, settings and capabilities, IPC command and event names, and file keys **shall** be named constants, defined once. | review |
| R-CONST-3 | Related constants **shall** live together in their module, under a comment naming where they come from. | review |
| R-CONST-4 | Tests may use literal fixtures; an expected value restating a constant **should** use it. | review |

### R-ERR: errors

| ID | Rule | Checked by |
|---|---|---|
| R-ERR-1 | Every failure the backend gives the front end **shall** be Studio's error: no panic, abort or process exit in library code, and no error of a library reaches the user unexplained. | the linters; tests; review |
| R-ERR-2 | A failure of the server **shall** keep all of it: its SQLCODE, SQLSTATE, message, the rule it cites, its position and its diagnostics, shown in the messages pane. A failure Studio raises itself carries the SQLCODE and SQLSTATE turborel-client gives the same failure. | tests |
| R-ERR-3 | No failure **shall** be silenced. One caught and given again keeps its cause; a result left unread says why it cannot matter. | the linters; review |
| R-ERR-4 | A connection that fails **shall** be closed, its worker ended, and every request waiting on it given that failure. | tests; review |

### R-NUM: numbers

| ID | Rule | Checked by |
|---|---|---|
| R-NUM-1 | An exact number and a DECFLOAT **shall** reach the front end as text, never through a binary floating-point type, so each is shown as the server gave it. | review; tests |
| R-NUM-2 | A value out of range for its type **shall** be refused with Studio's error, never truncated, wrapped or rounded. | tests |
| R-NUM-3 | Arithmetic on sizes, counts and offsets **shall** be checked or saturating. | the linters |

### R-LINT: warnings

| ID | Rule | Checked by |
|---|---|---|
| R-LINT-1 | A warning is an error: of the compilers, the linters and the type checker. | the checks tool |
| R-LINT-2 | The strictest standard lints **shall** be on: Clippy's pedantic group and the restrictions the workspace names, typescript-eslint's strict type-checked rules, and TypeScript's strict options; a check left off says why where it is left off. | review |
| R-LINT-3 | A warning **shall** be silenced only on its item, naming its rule and saying why (`#[allow(…, reason = "…")]`, or an ESLint comment with its reason). | the linters; review |

### R-DEP: dependencies

| ID | Rule | Checked by |
|---|---|---|
| R-DEP-1 | No dependency, Rust or npm, of the product or of its tools, **shall** be added without a decision here, saying its use, version, license and readiness. | review |
| R-DEP-2 | A dependency **shall** be production-grade by its makers' own claims, read in its current documentation: a stable release they support. Licenses are MIT or Apache-2.0, or as `deny.toml` allows with its reason. | review; cargo deny |
| R-DEP-3 | Versions **shall** be pinned exactly, with Cargo.lock and package-lock.json under version control; a change of a version is a commit of its own. | review |

### R-SAFE: what a server sends, and what lasts

| ID | Rule | Checked by |
|---|---|---|
| R-SAFE-1 | A query's rows **shall** be read through a cursor, a page at a time as the grid asks; no result sits whole in the backend's memory or the webview. | tests; review |
| R-SAFE-2 | Nothing a server, a file or a model sends **shall** be run, loaded or rendered as code or markup. | the linters; review |
| R-SAFE-3 | A length or count read from a file Studio opens **shall** be bounded before anything is held for it. | tests; review |
| R-SAFE-4 | No module-level mutable state: what lasts belongs to an object the application made, such as the connection manager. | review |
| R-SAFE-5 | Every thread **shall** be started by the connection manager or the application's task holder, named for what it does, and listed by it; none is started ad hoc, and a closed connection leaves none behind. | tests; review |
| R-SAFE-6 | A setting **shall** be named after what it controls, never generically; a new setting is raised with the owner first. | review |

### R-SEC: security

| ID | Rule | Checked by |
|---|---|---|
| R-SEC-1 | Database passwords and the assistant's keys **shall** live in the operating system's keychain alone. They never reach the webview, a file, a log, the history, a crash report or the clipboard; the front end sees only whether one is saved. | tests; review |
| R-SEC-2 | A file Studio writes **shall** hold no secret, and be readable by its owner alone: mode 0600 on Unix, in the user's own profile on Windows. | tests |
| R-SEC-3 | TLS **shall** be verified by default for every host but a local socket; a connection that is not secure says so plainly in the status bar. | tests; review |
| R-SEC-4 | The webview **shall** load nothing remote and run no `eval`, under a strict content security policy (D22). | the linters; review |
| R-SEC-5 | A window **shall** be granted only the application's own commands it uses, each named in `build.rs`, registered and granted alike; no shell, file system or HTTP plug-in is reachable from the webview. | the checks tool |
| R-SEC-6 | Every argument of a command **shall** be validated in Rust before it is used. | tests; review |
| R-SEC-7 | A production connection **shall** ask before a statement that writes, and one set read-only **shall** begin each transaction READ ONLY. | tests |
| R-SEC-8 | A statement that destroys (DROP, TRUNCATE, and DELETE or UPDATE without WHERE) **shall** ask first, wherever it is run from. | tests |
| R-SEC-9 | Studio **shall** touch the network only for the user's connections and, when turned on, the assistant's provider: no telemetry, analytics or updates. | review |
| R-SEC-10 | The supply chain **shall** pass `cargo xtask audit`: cargo deny's advisories, licenses and sources, npm audit of the shipped packages, and no `ring` in the tree. | CI |
| R-SEC-11 | A log **shall** never hold a secret or a row's values; a statement's text only when the user turns that on. | tests; review |
| R-SEC-12 | A model **shall** be called from the Rust backend alone, with only what the user chose to send; no tool acts without the user, and what is read from the database is data to a model, never instructions. | tests; review |
| R-SEC-13 | A provider's endpoint **shall** be HTTPS, but one on the loopback interface, which may be HTTP. | tests |

### R-UI: the user interface

| ID | Rule | Checked by |
|---|---|---|
| R-UI-1 | Every action **shall** be reachable by the keyboard, and the focused control always visible. | tests; review |
| R-UI-2 | Text **shall** meet WCAG 2.2 AA contrast in both themes, 4.5:1, and controls and focus rings 3:1. | tests |
| R-UI-3 | Every control **shall** have an accessible name and role. | tests; review |
| R-UI-4 | What the database gives (names, comments, values) **shall** be shown as text, never as markup. | the linters; review |

### R-TS: TypeScript

| ID | Rule | Checked by |
|---|---|---|
| R-TS-1 | TypeScript's strict options **shall** be on, and `any` is never written. | the type checker; the linters |
| R-TS-2 | A value from the backend **shall** have its type declared once, beside the command that gives it. | review |
| R-TS-3 | The front end **shall** reach the backend through `ui/ipc/` alone. | review |

### R-FMT: Studio's files

| ID | Rule | Checked by |
|---|---|---|
| R-FMT-1 | Each file Studio writes (a model, saved connections, settings, the layout, the assistant's log) **shall** carry a format version of 1. During the alpha a format changes in place, and no reader of an older layout is kept; a file of another version is refused, saying so. | tests |
| R-FMT-2 | Each format **shall** be described in the manual, with an example that Studio reads. | review |

### R-PLAT: platforms

| ID | Rule | Checked by |
|---|---|---|
| R-PLAT-1 | Studio **shall** build, run and pass its checks on Linux, macOS and Windows (D3, D4). | CI |
| R-PLAT-2 | Code of one platform **shall** be chosen by `cfg`, and elsewhere refused with Studio's error, saying so; never silently something else. | tests; review |
| R-PLAT-3 | Paths **shall** be made by `Path` and `PathBuf`, and files kept with LF line endings (`.gitattributes`). | review |
| R-PLAT-4 | Code built for one platform only **shall** say, when handed back, that it was not run on the others. | review |

---

## 4. Test rules

### R-TEST: levels and layout

| ID | Rule | Checked by |
|---|---|---|
| R-TEST-1 | A test **shall** sit at the lowest level that shows its requirement: a unit test of the backend or the front end, a test of the backend over a server it starts, or a test of the front end over a mocked IPC. | review |
| R-TEST-2 | Tests **shall** derive from Turborel's manual, turborel-client and these rules, not from the code: normal cases, boundaries, and failures with the exact SQLCODE and SQLSTATE expected. | review |
| R-TEST-3 | A test's name **shall** say the behaviour checked. | review |
| R-TEST-4 | Test code may assert, print and use literal fixtures; every other rule applies. | the linters' configuration |
| R-TEST-5 | Tests **shall** be deterministic and independent: no clock, randomness, network beyond loopback, or order between them. A live test runs against a server on loopback that the shared harness starts, on port 17440 and a data directory of its own. | review |
| R-TEST-6 | Every fixed defect **shall** get a regression test that fails without the fix, its doc comment saying so. | review |
| R-TEST-7 | There **shall** be one harness of each kind, written once and reused: one Rust live-server harness, one Vitest setup, one mock model server. No test file makes a framework of its own. | review |
| R-TEST-8 | Live tests **shall** run against `ghcr.io/turborel/turborel:nightly` in CI on Linux, set up by the shared harness, with test certificates made as it starts, SCRAM users and SERVER.TRUST_LOCAL. | CI |
| R-TEST-9 | No test **shall** call a real model or need a key; the assistant's tests use the mock model server. | review |

### R-TRACE: traceability

| ID | Rule | Checked by |
|---|---|---|
| R-TRACE-1 | Every test **shall** cite what it verifies, a Rust test in its doc comment and a TypeScript test in its title, with a tag of D6. | the checks tool |
| R-TRACE-2 | A citation **shall** name a heading, decision or rule that exists. | the checks tool |
| R-TRACE-3 | Code implementing a requirement **shall** cite it (R-DOC-4). | review |
| R-TRACE-4 | CONFORMANCE.md **shall** change with the change that implements or changes a row; a row is marked done only where its code exists and tests citing it pass. | review |

---

## 5. Coverage

| ID | Rule | Checked by |
|---|---|---|
| R-COV-1 | Coverage **shall** be measured by `cargo xtask coverage`, over the Rust crates and the front end, by every test. | the checks tool |
| R-COV-2 | Coverage **shall not** fall below the floors (D7); a change raising it **should** raise them. | the checks tool, in CI |
| R-COV-3 | A gap is closed by a test derived from a requirement, or by removing dead code; never by a test of no requirement, and never by excluding the code. | review |

---

## 6. Process and tools

| ID | Rule | Checked by |
|---|---|---|
| R-PROC-1 | `cargo xtask verify` **shall** pass before every commit; CI adds every platform, the Tauri build, the live tests, coverage and the supply chain (D4). | pre-commit hook; CI |
| R-PROC-2 | Every change **shall** be reviewed against the checklist below. | review |
| R-PROC-3 | Commits **should** be small and single-purpose, in CONTRIBUTING.md's form (`area: summary`, then why), citing the rules applied or changed. | review |
| R-PROC-4 | A threshold change **shall** change RULES.md and the configuration that holds it together. | review |
| R-PROC-5 | Project automation **shall** be a `cargo xtask` command, never a shell script; npm scripts only call tools, and the git hook only hands over to the checks tool. | review |
| R-PROC-6 | CI's actions **shall** be pinned by their full commit SHA, with the version in a comment. | review |
| R-PROC-7 | A release **shall** be published only as VERSIONING.md says, by the owner (D5). | review |
| R-PROC-8 | No commit, file or pull request **shall** carry AI or agent attribution, a DCO or a `Signed-off-by:`; contributors own their code. | review |

The review checklist:

- Turborel's manual cited in code (R-DOC-4) and tests (R-TRACE-1);
- normal and failure tests (R-TEST-2), and a failing-first test for a
  fix (R-TEST-6);
- every failure Studio's, carrying its condition (R-ERR);
- no magic numbers or strings (R-CONST);
- no secret disclosed, every IPC argument validated, no statement run
  the user did not run (R-SEC);
- comments explain why (R-DOC-2), and follow the change (R-DOC-3);
- CONFORMANCE.md (R-TRACE-4), the manual (R-DOC-7) and TODO.md updated
  where they change.

---

## 7. The decisions

### The subjects every Turborel repository decides

#### D1. A Tauri application: a Rust backend over turborel-client, a webview that holds no secret

- **Backend:** `core/` does the work: the connection manager, each
  connection on a worker thread of its own, the catalog, the analyzer,
  models and the assistant. It has no user interface, and is tested
  without a window.
- **Application:** `src-tauri/` holds the window and the commands, each
  a thin layer that validates its arguments and calls `core`.
- **Front end:** `ui/` draws, and reaches the backend through the
  commands alone. It holds no secret and sends nothing to the network.
- **Streams:** long work sends its rows, notices and progress as events
  on a channel the command is given.
- *Why:* the code that holds secrets and talks to servers is Rust, where
  it is checked and tested; the webview, the part that renders what a
  database gives, can reach nothing but what the backend offers.

#### D2. The front end: React and TypeScript on Vite

- **Language:** TypeScript, strict (R-TS-1).
- **Framework:** React (D11), with CodeMirror 6 (D12), Glide Data Grid
  (D13), dockview (D14), and React Flow with dagre (D15).
- **Build:** Vite (D18), into `dist/`, which Tauri bundles.
- *Why:* the editor, grid, dock and diagram libraries Studio needs are
  each production-grade for React, and TypeScript types what the backend
  gives (R-TS-2).

#### D3. The platforms and the toolchains

- **Platforms:** Linux with WebKitGTK 4.1, macOS with WKWebView, Windows
  with WebView2, as Tauri 2 supports them.
- **Rust:** the toolchain Turborel pins, 1.99.1, in `rust-toolchain.toml`.
- **Node.js:** 24 or later, for the front end's tools; CI uses 26.
- *Why:* one toolchain with Turborel's keeps turborel-client building as
  it does in Turborel's own CI; Node.js 24 is the oldest release its
  makers still support.

#### D4. One command runs every check, before each commit and in CI on three platforms

- **The command:** `cargo xtask verify`, stopping at the first failure:
  the repository's rules, rustfmt, Prettier, `tsc`, ESLint, Clippy, the
  Rust tests and Vitest.
- **Coverage:** `cargo xtask coverage` (D7).
- **Supply chain:** `cargo xtask audit` (D23).
- **The hook:** `.githooks/pre-commit` hands over to `verify`, a script
  only because git runs hooks as scripts.
- **CI:** `verify` and a Tauri build on Linux, macOS and Windows; the
  live tests against the nightly image, coverage and the audit on Linux.
  Every action is pinned by its full commit SHA, and Dependabot proposes
  each bump.
- *Why:* one command, the same everywhere, is what a contributor runs
  and what CI holds them to.

#### D5. The version is the Turborel release's: 0.0.0 in the alpha

- **Number:** the Turborel release Studio is made for, 0.0.0 in the
  alpha, written once in the workspace's `Cargo.toml`;
  `package.json` and `tauri.conf.json` are held to it by a test.
- **Tags:** exactly the server's release tag.
- **Publishing:** nothing until the owner says (VERSIONING.md).
- *Why:* one number tells a user which server a Studio is made for.

#### D6. Tests and code cite Turborel's documents by their headings

- **`[CLIENT <heading>]`:** a heading of The Client Library,
  `doc/client/02-library.md`, or of Settings, Pipelines and Pools,
  `doc/client/02-library-connections.md`, in Turborel's repository.
- **`[DOC <page> <heading>]`:** a heading of any other page of
  Turborel's manual, by its path under `doc/`, as
  `[DOC sql/07-information-schema.md TABLES]`.
- **`[STUDIO <heading>]`:** a heading of this repository's manual.
- **`[DESIGN] D<n>`** and **`[RULE] R-<id>`:** this file's.
- **The copy:** `xtask/turborel-headings.tsv` holds the headings of
  Turborel's manual at the commit D10 pins, made by
  `cargo xtask headings`; the checks tool refuses a citation of what is
  not there.
- *Why:* a heading is what a reader finds; the copy checks citations with
  no checkout of Turborel.

#### D7. Coverage floors, enforced in CI, that only rise

- **Rust:** lines and regions of `core/src` and `src-tauri/src`, by
  rustc's source-based coverage and the toolchain's LLVM tools, held to
  `xtask/src/coverage.rs`'s floors.
- **TypeScript:** lines, branches, functions and statements of `ui/`,
  by Vitest's V8 coverage, held to `vite.config.ts`'s floors.
- **Rising:** a change that raises coverage well above a floor raises it.
- **Below 100 %:** the program's `main` and `run` open the platform's
  window, which no test can; the keychain's test touches the platform's
  own keychain, so it runs where CI or a person sets
  `STUDIO_TEST_KEYCHAIN` (D16); `ui/main.tsx` only mounts the window,
  which the tests render themselves.
- *Why:* untested code is where the defects are.

#### D8. Where these rules depart from the toolkits' conventions

- **Sizes:** functions and files are bounded (R-SIZE), where React and
  Tauri projects commonly leave them to taste.
- **Errors:** every failure is Studio's, with its SQLCODE and SQLSTATE
  (R-ERR-1), where a Tauri command commonly returns a string.
- **Layout:** the front end is `ui/`, not Vite's `src/`, so `src` names
  no folder of two languages.
- *Why:* each keeps a rule every Turborel repository holds.

### Studio's own

#### D9. Tauri 2 for the desktop shell

- **Chosen:** `tauri` 2.12.7 and `tauri-build` 2.7.6, `@tauri-apps/api`
  2.12.5 and `@tauri-apps/cli` 2.12.6; MIT or Apache-2.0.
- **Readiness:** Tauri 2 is its makers' stable major release, supported
  on Linux, macOS and Windows.
- **Use:** the window, the commands and their permissions, channels for
  streams, the native menu, and the bundles. No plug-in is granted to the
  webview (R-SEC-5).
- *Why:* the platform's own webview, a Rust backend, and permissions per
  window and command.

#### D10. turborel-client, a git dependency at a pinned commit

- **Chosen:** `turborel-client` (features `tls`, `scram`,
  `system-roots`), `turborel` and `turborel-protocol`, from
  github.com/turborel/turborel at commit
  `3df14c1621d8063f12452a6c189017e34b8e9fd9` of `main`; BSD-2-Clause
  Plus Patent.
- **Not crates.io:** the 0.0.0 crates published there are frozen and
  never used.
- **Moving:** a new pin is a commit of its own, which moves the pin in
  `Cargo.toml` and `core/src/version.rs`, copies the headings again
  (D6), and follows what changed.
- *Why:* Studio is a client of the server Turborel's main builds, and
  turborel-client is the reference client; a pin makes each build the
  same.

#### D11. React 18, the version Glide Data Grid supports

- **Chosen:** `react` and `react-dom` 18.3.1, `@types/react` 18.3.31 and
  `@types/react-dom` 18.3.7; MIT.
- **Readiness:** React 18.3 is a stable release its makers support.
- *Why:* Glide Data Grid 6.0.3 (D13) supports React up to 18; React 19
  waits for a release of it that supports 19.

#### D12. CodeMirror 6 for the SQL editor

- **Chosen:** CodeMirror 6's packages (`@codemirror/*`), MIT, from M4.
- **Readiness:** version 6 is its maker's stable, maintained line.
- **Use:** a Turborel SQL mode built from Turborel's key words, and
  completion from the catalog.
- *Why:* an editor built for extension, with no eval.

#### D13. Glide Data Grid for results

- **Chosen:** `@glideapps/glide-data-grid` 6.0.3, MIT, with its peer
  packages `lodash` 4.18.1, `marked` 4.3.0 and
  `react-responsive-carousel` 3.2.23, from M5; `minimatch` 11.0.4 put
  under its build tool's packages, whose own was found vulnerable.
- **Readiness:** 6.0.3 is its makers' latest stable release.
- **Use:** a canvas grid that asks for the cells it draws, so the
  backend's pages fill it as it scrolls (R-SAFE-1). A header's click
  sorts and selects nothing; a drag selects a range, a row's number its
  row. Its overlay editor is not used, so it needs no portal.
- **Tests:** jsdom has no canvas, so the one setup gives the tests a
  table in its place that asks for its cells as the grid does
  (R-TEST-7).
- *Why:* a virtualized canvas grid draws millions of rows without a DOM
  node each.

#### D14. dockview for the dockable panels

- **Chosen:** `dockview-react` 8.9.1, with `dockview`, MIT.
- **Readiness:** its maker's stable major release, with no runtime
  dependency beyond its own core.
- **Use:** the panels, tabs and groups, and the layout saved and restored
  (from M2), in Studio's colours (D20).
- *Why:* panels that dock, tab and float, with layouts as data.

#### D15. React Flow and dagre for diagrams

- **Chosen:** `@xyflow/react` 12.12.1 and `@dagrejs/dagre` 3.1.3, MIT,
  from M5.
- **Readiness:** each its makers' stable major release.
- **Use:** a result's rows as nodes and edges (D39), and a model's
  tables as nodes and foreign keys as edges (D46), laid out by dagre. Its attribution
  link is hidden, as its MIT license allows: a link would lead the
  webview to a remote page (R-SEC-4).
- *Why:* diagrams of many tables, laid out automatically.

#### D16. The keychain through keyring-core and each platform's store

- **Chosen:** `keyring-core` 1.1.0, with `apple-native-keyring-store`
  1.0.2 (the macOS Keychain), `windows-native-keyring-store` 1.1.0 (the
  Windows Credential Manager) and `zbus-secret-service-keyring-store`
  1.0.1 (the Secret Service, on Linux and the other Unix systems), each
  chosen by `cfg`; MIT or Apache-2.0.
- **Not `keyring`:** its makers advise an application to link
  keyring-core and the stores it needs, as here, rather than that crate.
- **No global store:** each entry names its store, so no store is set
  for the process (R-SAFE-4).
- **Readiness:** each its makers' stable 1.x release.
- **No keychain:** where none opens, as a Linux session with no Secret
  Service, a password is kept in memory until Studio closes, and the
  connection dialog says why it cannot be saved.
- *Why:* secrets kept by the platform, never in Studio's files (R-SEC-1).

#### D17. serde and serde_json for the IPC and the files

- **Chosen:** `serde` 1.0.229 and `serde_json` 1.0.154, MIT or
  Apache-2.0.
- **Use:** the commands' arguments and results, and Studio's files
  (R-FMT-1).
- *Why:* Tauri's own encoding of its IPC, and the Rust ecosystem's
  standard.

#### D18. The front end's tools: Vite, TypeScript, ESLint, Prettier and Vitest

- **Chosen:** `vite` 8.3.8 with `@vitejs/plugin-react` 6.3.0;
  `typescript` 6.0.3; `eslint` 10.15.0 with `@eslint/js`,
  `typescript-eslint` 8.73.0, `eslint-plugin-react-hooks` and `globals`;
  `prettier` 3.10.1; `vitest` 5.1.1 with `@vitest/coverage-v8`, `jsdom`
  and `@testing-library/react`. MIT, TypeScript Apache-2.0.
- **TypeScript 6.0:** the newest that typescript-eslint supports.
- **Readiness:** each a stable release its makers support.
- *Why:* the standard tools of a React front end on Vite, one of each.

#### D19. The checks tool is Rust, in `xtask/`

- **Chosen:** `cargo xtask`, a program of the workspace, as Turborel's.
- **Commands:** `verify`, `coverage`, `audit`, `rules`, `headings`,
  `icons` and `install-hooks`.
- **Its own rules:** file sizes, doc comments and markers; the manual's
  layout and every relative link; citations; the IPC's three lists.
- *Why:* automation in the project's own language runs the same on every
  platform, and is tested (R-PROC-5).

#### D20. Two themes, their accent the icon's maroon

- **Themes:** light and dark, following the system's preference; their
  palettes are `ui/theme/tokens.ts`, written as CSS variables.
- **Accent:** #562024, the tile's maroon in `artwork/studio-icon.png`. It fills
  the chrome in both themes under white text; on the dark background, a
  tint of it, #E8A4AC, draws accent text and focus rings.
- **Contrast:** tests hold every pair to WCAG 2.2 AA (R-UI-2).
- *Why:* the maroon is Studio's mark; too dark to read on the dark
  background, its tint keeps the accent legible there.

#### D21. The icon set, made from the owner's icon by `cargo xtask icons`

- **Source:** `artwork/studio-icon.png`, the owner's, kept unchanged: a
  maroon tile of continuous corners on a transparent 2048 px canvas, in
  the proportion of Apple's app icon grid, so one file serves every
  platform.
- **The set:** `cargo xtask icons` runs Tauri's CLI on it, into
  `src-tauri/icons`, and removes the CLI's mobile folders; Studio is
  built for the desktop alone.
- *Why:* the icon set is made again by one command anyone can run, from
  the one file the owner keeps.

#### D22. The webview's content security policy

- **Policy:** scripts, styles, fonts and images from the application
  alone; IPC to Tauri's own scheme; no objects, frames, workers, forms or
  base URI.
- **Styles:** `style-src` allows inline styles, which CodeMirror and the
  grid inject, and Tauri is told not to add nonces to it
  (`dangerousDisableAssetCspModification`), which would disable that.
  Scripts keep Tauri's hashes and nothing inline.
- **Prototypes:** `Object.prototype` frozen by the window's entry once
  every module has run, not by Tauri's `freezePrototype` before any has:
  d3, which React Flow reads (D15), sets `constructor` on objects of that
  prototype as its modules run, which a prototype frozen before refuses,
  so the window ran no module at all and stayed blank (D49).
- *Why:* no remote content and no eval (R-SEC-4); inline styles cannot
  run code.

#### D23. The supply chain: cargo deny and npm audit

- **Rust:** `cargo deny`, by `deny.toml`: advisories, licenses, bans and
  sources; crates come from crates.io, and Turborel's from its
  repository alone.
- **npm:** `npm audit --omit=dev`, of the packages that ship.
- **ring:** never in the tree; TLS is rustls on aws-lc-rs, as Turborel's.
- **Where:** `cargo xtask audit`, in CI.
- *Why:* every library Studio ships is a library it answers for.

#### D24. Each connection on a worker thread the manager holds

- **Workers:** `ConnectionManager` starts one thread for each connection,
  named `studio-connection-<n>`, which connects, then owns the connection
  and answers its requests in turn, over a channel. `threads` lists them,
  and closing a connection, or the manager, ends its thread.
- **Commands:** each runs on Tauri's pool of blocking threads, so the
  window never waits on a server; that pool is Tauri's runtime's, not
  Studio's.
- **Cancel:** through turborel-client's canceller, from the caller's
  thread, while the worker waits on its statement.
- **Lost:** a connection lost is told once, as the event `Lost`, and
  takes no more until it is reconnected by the settings it was made by.
- **Events:** notices and losses go to one hub, the backend's one stream
  of events, which tells the webview, as the event `studio:event`, and
  any other sink that listens, as a live session will.
- *Why:* turborel-client is blocking, and a connection is one session
  answering one request at a time; a thread of its own keeps each
  session's order, and a named, held thread is one that ends (R-SAFE-5).

#### D25. A result read through its cursor, its pages spooled sealed

- **Cursor:** a statement that has columns is prepared, its cursor opened,
  and read a page of 500 rows at a time as the grid asks; another is
  executed; one the server cannot prepare (SQLSTATE 37000) is run
  directly.
- **Pages:** each page, as the server's text of each value, is appended
  to a spool file as it comes; the latest 8 stay in memory, the rest are
  read back from the file.
- **Sealed:** each page is sealed by AES-256-GCM under a key made for the
  result and held in memory alone; the file is its owner's alone, in the
  application's cache, removed with the result, and any a Studio left
  behind removed as it starts.
- **Bound:** a spool holds at most 1 GiB; past it, a result is to be
  exported, not browsed.
- **Dependency:** `aws-lc-rs` 1.18.2, ISC and Apache-2.0, the
  cryptography rustls already builds on; its makers' stable release.
- *Why:* a result of any length is browsed with bounded memory
  (R-SAFE-1), and its rows written to disk are of no use to anyone else
  (R-SEC-2).

#### D26. Studio's defaults for a connection: TLS verified, its name told

- **TLS:** `verify-full` where no layer names a mode: given as the
  environment's layer, below the program's settings and a service, so
  each of those still names its own.
- **Authorities:** the platform's are trusted where the settings name
  none, so `verify-full` has authorities to verify by.
- **Name:** the attribute `application` is `Turborel Studio`, unless the
  settings name one.
- **Layers:** otherwise every setting is turborel-client's, read as it
  reads them: the URI, then the dialog's fields over it, then a service,
  the environment and the client's defaults.
- *Why:* TLS verified by default for every host but a local socket
  (R-SEC-3), and an operator sees which sessions are Studio's.

#### D27. The live tests: one harness, one server, made as it starts

- **Harness:** `core/tests/live` is one test program with a harness of
  its own: it starts the server once, runs each test, and stops the
  server whatever fails, so nothing is left running.
- **Server:** the one `TURBOREL_TEST_SERVER` names, a `turboreld` path,
  or `docker:` and an image, as CI's `ghcr.io/turborel/turborel:nightly`;
  on port 17440, its data under `.claude/live/<pid>`; with TLS, a
  client authority, SERVER.TRUST_LOCAL on, a Unix socket on Unix, and an
  owner of a password.
- **Certificates:** made as it starts by `rcgen` 0.14.10 on aws-lc-rs,
  MIT or Apache-2.0, its makers' stable release; none is committed.
- **Unset:** with no server named, the live tests are skipped.
- *Why:* every connection path is tested against a real server, the one
  CI runs (R-TEST-8), and one harness serves every live test (R-TEST-7).

#### D28. Saved connections: a file of no secret, passwords in the keychain

- **The file:** `connections.json`, in the application's configuration,
  format 1, its owner's alone, at most 4 MiB and 1000 connections.
- **A connection:** an identifier of 16 random octets, a name, its
  folders (at most 8 deep), its settings with no password, its
  environment (development, test or production), its colour, whether it
  is read-only, and whether it is pinned.
- **Its password:** in the keychain as `connection:<identifier>`, under
  the service `com.turborel.studio`; the front end is told whether one
  is saved, and a password typed goes one way, to the backend.
- **Recent:** the 10 used last, the latest first.
- *Why:* a person's connections are kept and grouped as they work, with
  no secret on disk (R-SEC-1, R-SEC-2).

#### D29. Guards on what runs, by Turborel's own parser

- **Classified:** each statement of a script, split as the server splits
  it, is parsed by the `turborel` crate's parser, of the commit D10 pins,
  and classed by the kind of its syntax tree: read, transaction,
  session, write rows, change schema, security, administration, or
  unclassified. A script is as strict as its strictest statement.
- **Fail closed:** what does not parse, dynamic SQL, CALL, compound
  statements and EXECUTE GQL are unclassified, the strictest. A query
  that holds a data change delta table writes rows.
- **Destroys:** every DROP, TRUNCATE, and DELETE or UPDATE without WHERE.
- **The guards:** a statement that destroys, or one unclassified, asks
  first on every connection; a production connection asks before one
  that may write; a read-only one refuses one that may write, or that
  makes a transaction READ WRITE (SQLSTATE 25006), and begins each
  transaction by SET TRANSACTION READ ONLY, so the server refuses what
  the guards might miss.
- **Where:** in the connection manager, so every path a statement takes,
  typed, made by a dialog, or proposed by the assistant, goes through
  them; the front end only shows what to confirm.
- **The floor:** each statement the assistant may never run is marked
  as it is classified (`core/src/guard/classify.rs`), for M9.
- *Why:* a database's own grammar is the one way to know what a
  statement does; guessing from its words fails open.

#### D30. Commands by name: the menus, the keys and the palette

- **Commands:** each a name, a title, a category, a default key and what
  it does, in `ui/commands/commands.ts`.
- **Menus:** the platform's own menu bar, its items Studio's commands by
  name, told to the webview as `studio:menu`; Edit's and Window's items
  are the platform's.
- **Keys:** written `Mod+Shift+P`, `Mod` Cmd on macOS and Ctrl
  elsewhere; each rebindable in the settings, or unbound. The menus show
  no keys, so a key rebound is never run twice.
- **Palette:** every command by its title, filtered as typed.
- *Why:* one list, so a menu, a key and the palette never disagree, and
  every action is reachable by the keyboard (R-UI-1).

#### D31. The front end's state: one store per window

- **The store:** an object the window makes, holding the settings, the
  saved and open connections, the dialog shown and the last failure,
  given to the components by a React context (R-SAFE-4).
- **Actions:** each calls the backend through `ui/ipc/` and changes the
  store with what it gives; a failure is kept as the error shown.
- **No library:** React's own `useSyncExternalStore`.
- *Why:* one place to read and test what the window shows, with no
  dependency.

#### D32. A connection's colour tints the window

- **The colour:** the one a connection is given, else its environment's:
  production #B3261E, test #7A4F00, development none.
- **Tinted:** the window's frame and its status bar, and the
  connection's mark in the explorer, each under white text held to
  WCAG 2.2 AA (R-UI-2).
- *Why:* which database a statement goes to is seen at a glance, and
  production by its red.

#### D33. The catalog: the Information Schema, read as the tree opens

- **The source:** the Information Schema's views alone, as the session's
  user may see them, by queries that change nothing, over the
  connection's own worker; each list at most 20,000 rows, a schema of
  more saying so.
- **Read as opened:** the schemas first, a schema's objects as it opens,
  a table whole as it opens or is selected; kept in the window's store
  until Refresh, or the connection ends.
- **A table's columns:** their types as the server declares them, by a
  description of `SELECT *` of the table, else as COLUMNS gives them; a
  NOT NULL column's check is shown as NOT NULL, not as a check.
- **The server's indexes:** an index whose name holds a period is a
  key's, and one PARTITION_INDEXES names on a partition its table's;
  neither is written by the table's definition.
- **Definitions:** written by Studio of what it read, each name
  qualified and delimited where Turborel's lexer would read it otherwise;
  each kind made again of its definition by a live test.
- **Favourites:** kept with the saved connection, at most 500.
- *Why:* the Information Schema is the standard's description of a
  database, so the explorer shows what a user may see and nothing else.

#### D34. A file saved through the platform's dialog, by the backend

- **Chosen:** `tauri-plugin-dialog` 2.8.4, Tauri's own; Apache-2.0 or
  MIT; on `rfd` 0.17.2, MIT.
- **Backend only:** the plug-in's commands are granted to no window: the
  command `save_text_file` opens the dialog and writes the file the user
  chose, so the webview reaches no file system (R-SEC-5).
- **Bounds:** at most 64 MiB of text, a name of at most 255 characters
  with no separator of a path.
- **Readiness:** a stable 2.x release, of Tauri's own workspace of
  plug-ins.
- *Why:* the platform's dialog is the one a person knows, and choosing
  the file is theirs.

#### D35. Icons: Phosphor's, one set, in the theme's colours

- **Chosen:** `@phosphor-icons/react` 2.1.10, MIT, its own stable
  release, each icon imported from its own module so only those used
  are built.
- **One registry:** `ui/icons/Icon.tsx` names each icon for what it
  stands for, a command, a panel or a kind of object, so the toolbar,
  the palette, the list of keys, the tree, the details and the dock's
  tabs show the same one.
- **Weights:** regular; duotone for emphasis, as a favourite or a pin
  set.
- **Colours:** running green, stopping and cancelling red, committing,
  rolling back, connecting and disconnecting each its own, from the
  theme's tokens, each at least 3:1 on every ground (R-UI-2); every other
  icon the text's.
- **Sizes:** 16 pixels in trees, lists and tabs, 18 in the toolbar; SVG,
  so crisp at any scale.
- **Named:** an icon is hidden from assistive technology; a button of an
  icon alone has an accessible name and a tooltip.
- **The menu bar:** the platform's, without icons, as the platforms'
  own menus seldom have them; its items are the same commands.
- *Why:* a classic database IDE's toolbar and tree are read by their
  icons, and one set keeps them alike everywhere.

#### D36. Worksheets: scripts split as the server splits them, run through the guards

- **Split:** by turborel-client's splitter, as the server splits a
  request of several; each statement's place given in UTF-16 code units,
  as the editor counts, and its class.
- **Judged once:** a script's statements together, by the connection's
  guards (D29), then each run in turn until one fails or the run is
  stopped; CONNECT, SET CONNECTION and DISCONNECT refused, as each
  connection is bound to its session.
- **Markers:** `?` and `:name`, a statement's parameters, given values
  as text or NULL, each cast to the type the server describes; `${name}`,
  a script variable, replaced before the statement is sent. None read in
  a string, a delimited identifier or a comment.
- **Kept:** the worksheets, with their text, a second after they change;
  the history, at most 1000, never of a statement that changes who may
  do what; favourite queries; project folders; each a file of format 1.
- **Files:** only those chosen in the platform's dialog this session, and
  the `.sql` files of project folders, are read or written.
- **Settings:** `historyKept`, `formatKeyWords`, `formatIndent`,
  `formatLineWidth` and `notifyAfterSeconds`, each named for what it
  controls.
- *Why:* what the worksheet runs is what the server would run of the
  same text, and nothing reaches it the guards did not judge.

#### D37. The editor: CodeMirror 6 in Turborel's SQL

- **Chosen:** `@codemirror/state` 6.7.6, `view` 6.43.15, `commands`
  6.11.1, `language` 6.13.1, `search` 6.7.2, `autocomplete` 6.20.4,
  `lang-sql` 6.10.0 and `@lezer/highlight` 1.2.5; MIT; each its makers'
  stable 6.x or 1.x release.
- **Turborel's dialect:** the reserved words from Turborel's own lexer,
  given by the backend; the words its statements read, and its types,
  from its manual's appendix of key words and chapter of data types.
- **Completion:** of the catalog the explorer has read, a table's
  columns read as they are asked for; snippets of fields.
- **Keys:** Studio's commands' keys taken before the editor sees them,
  so each is the same everywhere; the editor's own keys the rest.
- *Why:* an editor of SQL that people know, kept to Turborel's language.

#### D38. A run's end notified by the platform, from the backend

- **Chosen:** `tauri-plugin-notification` 2.8.0, Tauri's own; Apache-2.0
  or MIT; its makers' stable 2.x release.
- **Backend only:** the command `notify_finished` shows it, its title and
  body bounded; the plug-in's commands are granted to no window.
- **When:** a run longer than `notifyAfterSeconds`, ended while the
  window is hidden.
- *Why:* a long statement is waited on in another window, and its end
  should not be missed.

#### D39. Results: paged in a canvas grid, sorted and filtered on the server, values read whole for their viewers

- **Grid:** Glide Data Grid (D13); the next page read as it scrolls
  within 100 rows of the last read; each header its name and declared
  type; at most 500 characters of a value drawn (S-LIMIT-2).
- **Sort and filter:** the query run again within
  `SELECT * FROM (…) AS "Q" (names) WHERE … ORDER BY …`, through the
  guards, with its parameters' values; each column named by its name, or
  by its place where it has none or shares one. Only a query; the old
  result closed once the new has come, kept if it fails.
- **Views:** grid, text, a row as a form, nodes and edges (D15), and a
  plane of spatial values; columns frozen.
- **Values:** a large object sent by its locator is read whole by the
  worker, a chunk of 256 KiB at a time, at most 16 MiB (S-LIMIT-3), a
  character one as text, a binary one in Base64; each page says which
  of its cells came so. Images by their first octets, never SVG.
- **Plane, not map:** a map's tiles would be remote content (R-SEC-4),
  so spatial values are drawn on a plane alone.
- **Status bar:** exact numbers summed as decimals, never through a float
  (R-NUM-1); the average six digits past their scale.
- **Copy:** CSV as turborel-client's export writes it, tab-separated,
  JSON, Markdown and INSERT, each value a literal of its type.
- **Export:** turborel-client's `export`, run by the worker, to the file
  the platform's dialog chooses, opened by the backend (R-SEC-5); a query
  alone, as the guards classify it.
- **Pins and comparisons:** a pinned result kept open as the worksheet
  runs again; two results compared by their rows read, as multisets.
- **Timings:** each run's time and rows kept in the window, compared with
  the run of the same statement on the same connection before.
- **Autocommit:** the session read again as a result's last row is read
  or it is closed, as `fetch-ends` ends its transaction (S-CAP-17).
- *Why:* results of any size shown, sorted and filtered as the database
  would, and every value seen as what it is.

#### D40. Completion: of the place, from the parser's scope and the catalog's cache

- **The place:** read by the statement's words before the cursor: its
  start, after FROM and the like, after a qualifier, after a table of
  FROM, after JOIN … ON, within INSERT's column list, after SELECT *,
  after CAST's AS, or a value expression of a clause.
- **The scope:** the statement's tables, aliases, common table
  expressions and derived tables, read by Turborel's parser through the
  backend, with a name where the cursor is; by its words where it parses
  neither way.
- **Words:** each of Turborel's lists (D37), offered only where its place
  allows.
- **Functions:** the rows of the tables of functions of Turborel's manual,
  copied by `cargo xtask headings` at the pinned commit, and the few its
  manual describes under headings of their own.
- **Cache:** the window's catalog, read further as asked for, never while
  the worksheet runs; read again after a definition changes, or by
  Refresh Catalog.
- **Rank:** kind, then the outermost query's scope, then how often chosen
  this session; matching CodeMirror's own, fuzzy.
- **No comments:** Turborel keeps no comments of objects, so a popup has
  none.
- **Tab:** with the list open, takes the item highlighted, as Enter
  does; with none, completes the word in place where one candidate alone
  begins with it, opens the list where several do, else moves to a
  snippet's next field or indents; Shift+Tab goes back a field or
  outdents; Home and End jump in the list. The keys are the commands
  Complete or Indent and Previous Placeholder or Outdent, bound in the
  editor alone, never by the window's handler of keys, so they may be
  rebound; CodeMirror's tab-focus mode lets Escape, then Tab, leave the
  editor.
- *Why:* completion that knows the statement and the database, and is
  never slower than the typing; the arrows to choose and Tab to take, as
  the owner asked, without trapping the keyboard.

#### D41. Data: values written as the grid shows them

- **Text:** a value given a parameter, by the worksheet's dialog or by the
  grid, is text, cast to the parameter's type as CAST would cast it.
- **Binary:** a binary string's or binary large object's value is written
  in hexadecimal digits, in pairs, as the grid shows it.
- **Large objects:** a value longer than 64 KiB, as long as a row holds,
  is written to the server first by `create_lob`, a chunk of 256 KiB at a
  time, and sent as its locator (`[CLIENT Large objects]`).
- *Why:* what the grid shows can be written back as it is shown, and no
  message carries more than a row holds.

#### D42. Rows edited in the grid, staged, applied in one transaction

- **Where:** any result whose query reads one base table and holds its
  key, the primary key or a unique key of NOT NULL columns; each result
  column the table's of its name. A table's **Edit Rows…** opens its
  first rows, or those a condition keeps, so.
- **Staged:** cells changed, rows added and rows removed, kept in the
  run, until applied, reverted or let go; generated and always-identity
  columns, and large objects not sent whole, not edited.
- **Statements:** DELETE and UPDATE of each row by its key as read, of
  the columns changed alone; INSERT of the columns given values, or
  DEFAULT VALUES; each value a parameter (D41).
- **Applied:** judged by the guards together, then run in a transaction
  of their own, under autocommit too, committed if each UPDATE and DELETE
  changed exactly one row, else rolled back; within the session's
  transaction, if one is active, left to it. The query is run again
  after.
- *Why:* edits that cannot change rows they did not mean to, kept or
  lost together.

#### D43. Imports and exports of a table, through the backend

- **Import:** the file chosen in the platform's dialog, opened by the
  backend, read only if chosen this session (R-SEC-5); previewed by its
  first 20 records; each field taken into a column chosen or skipped;
  imported by turborel-client's `import`, by copy where the server
  grants it, a batch committed at a time, through the guards as an
  INSERT into the table.
- **Export:** a table's rows, or those a condition keeps, by the
  result's export (D39).
- *Why:* data brought in and taken out at any size, the webview reaching
  no file system.

#### D44. Tables made and altered by dialogs that write their DDL

- **Create Table:** the table's name, its columns, each with its name,
  type, NOT NULL, default and key, and its constraints, primary key,
  unique, check or foreign key; the CREATE TABLE shown as it is filled
  in.
- **Alter Table:** an action of ALTER TABLE at a time, each its own
  statement, staged into a script: column added, dropped or renamed, its
  default, NOT NULL or data type set or dropped, a constraint added or
  dropped, the table renamed.
- **Names:** written as Turborel reads them back: bare where a regular
  identifier in upper case and not reserved, else delimited. Types,
  defaults and conditions as the user wrote them.
- **Run:** the DDL opened in a worksheet of the connection, and run there
  if asked, as any script, through its guards, the catalog read again
  after.
- **Generated:** a schema's objects chosen scripted by their definitions
  (D33), types, domains and sequences first, then base tables, views and
  routines, opened in a worksheet.
- *Why:* the DDL is seen, and can be changed, before it runs.

#### D45. Rows compared by the target's key, synced by a script

- **Matched:** by the target's key, which the source must have; compared
  by the columns both have, as the target types them, as their text;
  large objects not compared.
- **Read:** each table whole, in its key's order, at most 100,000 rows a
  side.
- **Script:** UPDATE of the columns that differ, INSERT of the rows the
  target lacks, DELETE of those the source lacks, each value a literal;
  opened in a worksheet of the target's connection, never run by the
  comparison.
- *Why:* two tables made the same by statements read before they run.

#### D46. Models: a schema's tables as a diagram, kept as a file of their own

- **Read:** each base table chosen of a schema, whole, from the catalog
  (D33): its columns, primary key, unique constraints, checks but NOT
  NULL's, foreign keys, and indexes not made for keys; and the schema's
  property graphs, of PROPERTY_GRAPHS, PG_ELEMENT_TABLES, PG_LABELS and
  PG_EDGE_ENDPOINTS.
- **Drawn:** React Flow (D15), each table a node of its columns and
  marks, each foreign key an edge, each graph's edge table a dashed edge
  to its vertex tables; laid out by dagre from left to right, a table
  placed kept; filtered, searched, grouped by schema.
- **Designed:** a table's form of the table dialogs' columns and
  constraints (D44), and its indexes.
- **File:** JSON, `format` `turborel-studio-model`, `version` 1, written
  and read whole, a file of another format, version or shape refused;
  the user's own, where the platform's dialog puts it.
- **Images:** SVG written of the model; PNG of that SVG drawn on a
  canvas, saved through the backend.
- *Why:* a schema seen, and designed, as a picture that is also data.

#### D47. A schema taken to a model, or to another schema, by a script

- **Matched:** tables by schema and name, columns by name, types by their
  standard names, constraints and indexes by what they are, not their
  names.
- **Script:** of Turborel's own statements: CREATE TABLE, ALTER TABLE of
  each form a change needs, DROP TABLE RESTRICT, CREATE INDEX and DROP
  INDEX; ordered so it runs; opened in a worksheet, never run by the
  comparison.
- **Two schemas:** the source's tables taken as the target schema's, and
  the script makes the target match.
- *Why:* every change read before it runs, as Turborel would run it.

#### D48. The query builder: a query written into a worksheet as it is built

- **Parts:** tables picked, each aliased by its first letter and a
  number; joins the foreign keys imply, inner or left; columns, each a
  value or of an aggregate; conditions by AND, each value a literal of
  its column's type; grouping by the columns of no aggregate; order.
- **Written:** into a new worksheet as each part changes, through its
  editor; the worksheet's to edit once the builder closes.
- *Why:* a query begun by pointing, finished as SQL.

#### D49. A window that never goes blank

- **Shown:** a failure in drawing the window shows a panel in its place,
  of its details, with Copy Details, Reset Layout and Reload; one of a
  script or a promise is told in the error banner.
- **Logged:** each is kept in `failures.log`, in Studio's configuration,
  its owner's alone, a line a failure, its lines joined, at most 16,384
  characters, the log begun again past 1 MiB, the old kept beside it. The
  window holds no secret, so the log holds none.
- **Set aside:** a file of Studio's that does not fit, too long, not JSON
  of its shape, of another format, or of a setting out of its bounds, is
  renamed beside itself, `.set-aside-` and the instant after its name, and
  read as none; the window tells it until dismissed. A part of the
  window's state that cannot be loaded leaves the others loaded.
- **Plug-ins:** the dialog and notification plug-ins are added without
  the scripts they give the webview, which is granted none of their
  commands; the notification plug-in's asked, as the page loaded, whether
  notifications are permitted, and was refused (R-SEC-5).
- **Smoke test:** `cargo xtask smoke` launches the built application under
  tauri-driver 2.1.0 and WebKit's WebDriver, on Linux under a virtual
  display, from no app data and from an earlier build's, and holds that
  its toolbar and explorer are drawn, a new worksheet opens by the
  toolbar's button and its editor's context menu opens (D53), no
  failure panel shown and none logged, and the file that does not fit
  told.
- *Why:* a window blank and silent, as d3 under a prototype frozen before
  it ran made it (D22), tells its user nothing; this one tells them, and
  the tests see what they see.

#### D50. The analyzer: rules of the catalog and the plan, each finding's fix as SQL

- **Read:** a schema's base tables whole, and INFORMATION_SCHEMA.SETTINGS,
  by the backend; partitions judged with their partitioned table.
- **Rules:** FK-NO-INDEX, INDEX-DUPLICATE, INDEX-PREFIX, TABLE-NO-KEY
  and SETTING-ADVISED in Rust, of the catalog, so the assistant (M9)
  can read them too; SCAN-NO-INDEX in the window, of the plan it parses
  (D36), with the tables it scans read of the catalog. Each finding is
  its rule's identifier, its object, what it says and its fix; sorted
  by rule, then object.
- **Settings advised:** only those whose values Turborel's Appendix C
  says lose commits or weaken authentication: LOG.COMMIT_SYNC OFF,
  LOG.DURABILITY NONE, SERVER.SCRAM_WITHOUT_TLS ON, SERVER.TRUST_LOCAL
  ON.
- **Fixes:** opened in a worksheet, never run by the analyzer; a
  constraint's index never dropped.
- **Waiting on the server:** statement, table, index and column
  statistics and sizes, each shown unavailable, saying why.
- *Why:* each change explained and reviewed before it runs; the same
  catalog, the same findings.

#### D51. What-if indexes: made, explained and dropped, only when asked

- **How:** CREATE INDEX, EXPLAIN of the statement, then DROP INDEX, each
  through the guards, in the worksheet; not under autocommit, ROLLBACK of
  the EXPLAIN's transaction before the drop; nothing after a make that
  failed; the drop after an EXPLAIN that failed too.
- **Asked first:** a dialog says the index is made for real, apart from
  any transaction, seen by other sessions while it stands.
- **Shown:** the plan before and the plan with the index side by side.
- *Why:* Turborel makes an index apart from any transaction (its
  `create-index.md`), so it cannot be rolled back; a hypothetical index
  waits on the server.

#### D52. Reports and charts: queries shown as tables or charts, the user's kept

- **Built in:** of the Information Schema, defined in Rust, each run by
  the live tests: objects by schema, files, indexes, table privileges,
  sessions, settings changed.
- **The user's:** `reports.json`, format 1, at most 1000, each a name, a
  query and a chart or none.
- **Run:** in a worksheet, as any query, through the guards, its
  parameters asked.
- **Charts:** bars or lines, by hand in SVG, of one scale; at most eight
  series in a fixed order of colours checked together for colour-blind
  separation against each theme's background; a legend of two series or
  more; values and labels in text's colours; the first 200 rows.
- *Why:* a query worth keeping kept with how it is read; no chart
  library for two forms.

#### D53. Context menus everywhere, of the registry, and a new worksheet a click away

- **One menu:** one open at a time, in the window's store; opened by the
  secondary button, Shift+F10 or the context menu key on what has the
  focus; kept within the window; the arrows, Home, End, Right and Left
  move and open submenus, Enter or Space chooses, Escape closes, the
  focus given back.
- **Items:** an item is a command of the registry where one does what
  it does, with its title, icon and key, disabled where it cannot run;
  else the action its button or dialog runs. Of the explorer's rows, a
  result's cells and headers, the editor, a worksheet's tab, and a
  model's tables and diagram.
- **Destructive:** marked in the colour of danger; DROP, ALTER and the
  like run in a worksheet of their own, through the guards, as typed;
  deleting a saved connection asks its name typed.
- **New worksheet:** File > New Worksheet, Mod+N, the toolbar, the plus
  after the centre's tabs, the Start panel, and the explorer's menus,
  the last on that connection, SET SCHEMA run first where the session's
  is another.
- **The webview's own menu:** left out but in fields of text.
- **Hidden columns:** drawn of no width; still copied and exported.
- *Why:* the owner asked for right-click everywhere and one-click
  worksheets; one registry keeps the menus, the palette and the menu bar
  the same.

#### D54. The plan viewer: a summary, a flow, a tree-table, the stages, the raw text last

- **Opened:** by Explain, Explain Analyze, and an EXPLAIN written in a
  script, whose PLAN rows stay the result's; never as raw text first
  unless the setting `planView` says `raw`.
- **Parser:** tolerant: an unknown line an operator of its first word,
  lines before any header a stage of their own; cost, degree, the join
  order, the query's time and each line kept. Tested on Turborel's
  EXPLAIN page's examples and a plan the server gave.
- **Summary:** rows and time; the three costliest by own time, else
  cost; warnings of rules PLAN-FULL-SCAN (10,000 rows), PLAN-SERIAL
  (65,536, EXECUTOR.PARALLEL_MIN_ROWS's default), PLAN-MISESTIMATE (ten
  times), PLAN-MANY-PROBES (10,000) and SCAN-NO-INDEX (D50) with its fix
  and what-if (D51). EXPLAIN tells no spill, so none is warned of.
- **Flow:** React Flow and dagre (D15), bottom to top, lines as thick as
  the logarithm of their rows, heat as a share of the time in the
  second series colour (D52); collapse, search, zoom and fit.
- **Tree-table:** sortable by estimate, actual, loops, probes and time.
- **Compare:** two tree-tables side by side, operators matched by name
  and detail, their figures aside.
- *Why:* the owner found the raw plan too raw; a plan read at a glance,
  its raw text a tab away.

---

## 8. References

- Turborel, `doc/client/02-library.md`, *The Client Library*, and
  `doc/client/02-library-connections.md`, *Settings, Pipelines and
  Pools*: what Studio's connections do.
- Turborel, `doc/sql/07-information-schema.md`, *The Information
  Schema*: what the explorer reads.
- Turborel, `doc/sql/statements/explain.md`, *EXPLAIN*: what the
  analyzer reads.
- W3C, *Web Content Accessibility Guidelines (WCAG) 2.2*: contrast and
  keyboard reach (R-UI).
- Tauri 2's documentation: capabilities, permissions and the content
  security policy.
