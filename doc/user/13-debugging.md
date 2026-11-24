# Debugging Routines

[Contents](README.md)

Studio debugs a procedure, a function or a trigger written in SQL as it
runs: it stops at breakpoints set at lines of its text, steps through its
statements, and shows its call stack, each frame's parameters, variables
and cursors. The debugger is a second connection, opened beside the one
the routine runs on, of the same server and user, or a second session of
the same embedded database, attached to that connection's session
([Debugging Routines](https://github.com/turborel/turborel/blob/main/doc/user/11-debugging.md)).

## Starting

**Debug…** of a procedure or function in the explorer, or the **Debug**
tab of its details, and **Debug…** of a trigger, debug it on that
connection. Studio opens the debugging connection, attaches it to the
connection's session and opens the **Debugger** panel, the routine's text
in it. Debugging another routine stops the one before. **Debug >
Debugger** shows the panel again.

Then whatever runs the routine on that connection pauses at the
breakpoints set: a CALL in one of its worksheets, as `CALL
RAISE_PRICES(10)`, a query of a function, or a statement that fires the
trigger. While its session is paused, the worksheet waits, and the
debugger shows where.

## Breakpoints

The panel shows the routine's text, a line each, its line numbers in a
gutter. A click of a line's gutter sets a breakpoint there, marked in the
gutter, and a click again clears it. **Shift** and a click asks for a
condition over the frame's parameters and variables, as `PCT > 5`: that
breakpoint pauses only where it is true. A breakpoint at a line pauses
each statement that begins on it.

The lines are numbered of the routine's text. Turborel counts them of
the routine's definition as it was written, which no view shows yet, so
Studio numbers them of the CREATE it writes of the routine, its head on
the first line and its body as written below. Where the head was written
on more lines, the numbers differ: so at each pause Studio checks that
the paused statement begins where its text says, and where it does not,
says so and marks no line.

## When it pauses

At a pause the panel says why, **Paused at breakpoint 1.** or
**Paused.** at a step's end, and marks the paused line. Below are:

- **Call stack:** each frame, the innermost first, as `#1 PROCEDURE
  DEMO.RAISE_PRICES line 4, column 3`. A frame of a routine you hold no
  DEBUG on is named alone, and never pauses. A click chooses a frame.
- **Parameters**, **Variables** and **Cursors** of the frame chosen: each
  parameter and variable with its type and value, NULL shown as such, and
  each cursor, open or closed, with its query. A trigger's parameters are
  its transition variables.

## Stepping

| Command | What it does | Default | Function keys |
|---|---|---|---|
| **Continue** | runs to the next breakpoint, or to the end | F8 | Shift+F8 |
| **Step Into** | pauses at the next statement, within a routine it invokes too | F11 | F7 |
| **Step Over** | pauses at the next statement of the same frame, or of the one it returns to | F10 | F8 |
| **Step Out** | pauses at the next statement of the frame this one returns to | Shift+F11 | Shift+F7 |
| **Interrupt** | pauses the running session at its next statement | Shift+F8 | Cmd+Shift+F8, Ctrl+Shift+F8 |
| **Stop Debugging** | detaches; the session goes on as if never debugged | Shift+F5 | Cmd+F2, Ctrl+F2 |

They are the panel's tools and the **Debug** menu's items, each enabled
where the session allows it: the steps and Continue while it is paused,
Interrupt while it runs. The keys are those of the scheme chosen
([Appendix A](../appendix/a-keyboard.md)).

## When a pause ends by itself

A paused session holds what it holds, its locks among them. It waits for
its debugger at most the database's setting DEBUGGER.PAUSE_TIMEOUT_MS,
five minutes unless set, and then goes on by itself; the panel says
**The pause timed out**. **Cancel Statement** of the paused worksheet
ends the pause, its statement failing as cancelled, and the panel says
so. A session that ends detaches its debugger, and the panel says
**The session ended**; Stop Debugging, or closing the connection, lets
the session go on.

## Who may debug what

You may debug the routines you own, and those you hold DEBUG on, and a
trigger of a schema you own. A breakpoint in another routine is refused,
SQLSTATE 42000, and the panel says how DEBUG is granted, by the
routine's owner:

```sql
GRANT DEBUG ON PROCEDURE DEMO.RAISE_PRICES TO ANN;
```

Your debugger attaches only to your own connection's session, as Studio
opens it of the same user; its server must grant the capability
`debugger`.

## Embedded databases

An embedded database is debugged the same way: the debugger is a second
session of the database, in Studio's own process, attached to the
session of the connection the routine runs on.
