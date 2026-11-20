<!--
This description is the series' cover letter (CONTRIBUTING.md, Pull
requests). Each commit message still stands alone, in Linux's form.
Base the series on main, keep it rebased, and on revising say what
changed in a comment, not here.
-->

## What and why

<!-- The problem and its impact, then the approach and the choices made.
Link the issue: "Closes #N". -->

## The series

<!-- One line per commit, in order: what it does. Each passes
`cargo xtask verify` on its own. -->

1.

## Testing

<!-- The tests added and what each verifies; for a change that touches
security, what CONTRIBUTING.md asks for it; the server commit run
against. -->

- [ ] `cargo xtask verify` passes
- [ ] `cargo xtask coverage` passes

## What a user sees

<!-- What changes in the window, the files Studio keeps, or what it sends;
"none" if nothing changes. -->

## Checklist (RULES.md §6)

- [ ] One logical change per commit, each passing `cargo xtask verify`
- [ ] Turborel's manual cited in the code (R-DOC-4) and in the tests (R-TRACE-1)
- [ ] Normal and failure tests (R-TEST-2), a failing-first test for a fix (R-TEST-6)
- [ ] No secret disclosed, every command's argument validated, every statement through the guards (R-SEC)
- [ ] No new dependency or setting without a decision (R-DEP-1, R-SAFE-6)
- [ ] CONFORMANCE.md, RULES.md, TODO.md and `doc/` updated where they change (R-DOC-3)
