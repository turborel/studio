# Keyboard Shortcuts

[Contents](README.md)

Each of Studio's commands, its menu, and its key by default, on macOS and
on Linux and Windows, in the scheme **Default**. **File > Settings… >
Keys** chooses another scheme, and binds a command to another key, or to
none ([The Window](../user/02-window.md#keys)); the command palette and
**Help > Keyboard Shortcuts** show the keys as they are bound.

The scheme **Function keys** gives three commands keys of their own, the
others keeping those below, on every platform:

- **Run Script**: F5;
- **Run Statement**: F9;
- **Explain**: F6.

![Settings, Keys: the scheme Function keys chosen, each command beside its key, Run Statement on F9, Run Script on F5 and Explain on F6 among them](../images/settings-keys-light.png#gh-light-mode-only)
![Settings, Keys: the scheme Function keys chosen, each command beside its key, Run Statement on F9, Run Script on F5 and Explain on F6 among them](../images/settings-keys-dark.png#gh-dark-mode-only)

| Command | Menu | macOS | Linux, Windows |
|---|---|---|---|
| New Connection… | File | Cmd+Shift+N | Ctrl+Shift+N |
| Open Database… | File | | |
| New Database… | File | | |
| New In-Memory Database | File | | |
| New Worksheet | File | Cmd+N | Ctrl+N |
| Open File… | File | Cmd+O | Ctrl+O |
| Run SQL File… | File | | |
| New Model | File | | |
| Open Model… | File | | |
| Import DDL into Model… | File | | |
| Reopen Closed Worksheet | File | Cmd+Shift+T | Ctrl+Shift+T |
| History… | File | Cmd+Shift+H | Ctrl+Shift+H |
| Disconnect | Connection | | |
| Reconnect | Connection | | |
| Cancel Statement | Connection | Cmd+. | Ctrl+. |
| Refresh Catalog | Connection | | |
| Monitor | Connection | | |
| Analyze Schema… | Connection | | |
| Commit | Connection | | |
| Rollback | Connection | | |
| Run Statement | Worksheet | Cmd+Enter | Ctrl+Enter |
| Run Script | Worksheet | Cmd+Shift+Enter | Ctrl+Shift+Enter |
| Run Script on a Folder's Connections… | Worksheet | | |
| Explain | Worksheet | Cmd+E | Ctrl+E |
| Explain Analyze | Worksheet | Cmd+Shift+E | Ctrl+Shift+E |
| Run to CSV File… | Worksheet | | |
| Run to Native Rows File… | Worksheet | | |
| Query Builder… | Worksheet | | |
| Complete or Indent | Worksheet | Tab | Tab |
| Previous Placeholder or Outdent | Worksheet | Shift+Tab | Shift+Tab |
| Format | Worksheet | Cmd+Shift+F | Ctrl+Shift+F |
| Toggle Comment | Worksheet | Cmd+/ | Ctrl+/ |
| Upper Case | Worksheet | Cmd+Shift+U | Ctrl+Shift+U |
| Lower Case | Worksheet | Cmd+Shift+L | Ctrl+Shift+L |
| Find and Replace… | Worksheet | Cmd+F | Ctrl+F |
| Toggle Bookmark | Worksheet | Cmd+F2 | Ctrl+F2 |
| Next Bookmark | Worksheet | F2 | F2 |
| Previous Bookmark | Worksheet | Shift+F2 | Shift+F2 |
| Go to Definition | Worksheet | F12 | F12 |
| Describe | Worksheet | Cmd+I | Ctrl+I |
| Split Editor | Worksheet | | |
| Outline | Worksheet | | |
| Add to Favourite Queries… | Worksheet | | |
| Autocommit | Worksheet | | |
| Save | File | Cmd+S | Ctrl+S |
| Save As… | File | Cmd+Shift+S | Ctrl+Shift+S |
| Pin Tab | Worksheet | | |
| Close Worksheet | Worksheet | Cmd+Alt+W | Ctrl+Alt+W |
| Close Other Worksheets | Worksheet | | |
| Command Palette… | View | Cmd+Shift+P | Ctrl+Shift+P |
| Settings… | File | Cmd+, | Ctrl+, |
| Theme: System | View | | |
| Theme: Light | View | | |
| Theme: Dark | View | | |
| Zoom In | View | Cmd+= | Ctrl+= |
| Zoom Out | View | Cmd+- | Ctrl+- |
| Actual Size | View | Cmd+0 | Ctrl+0 |
| Assistant | View | | |
| Assistant Settings… | View | | |
| Live Session | Live | | |
| Present | Live | | |
| Join… | Live | | |
| Share Worksheet in Live Session | Live | | |
| End Session | Live | | |
| Leave Session | Live | | |
| Session Records… | Live | | |
| Live Sessions Settings… | Live | | |
| Reset Layout | View | | |
| About Turborel Studio | Help | | |
| Keyboard Shortcuts | Help | F1 | F1 |

Within a dialog, Tab and Shift+Tab move between its fields, and Escape
closes it, and Studio's keys wait until it is closed. In the command
palette, the arrow keys choose a command and Enter runs it. The Edit
menu's keys are the platform's own.

In a worksheet's editor, Studio's keys come first: a key bound to one of
Studio's commands runs it, wherever the cursor is. **Complete or
Indent** and **Previous Placeholder or Outdent**, Tab and Shift+Tab by
default, are the editor's alone ([Worksheets](../user/05-worksheets.md#completion)):
with the completion list open, Tab takes the item highlighted; with
none, it completes the word in place where one candidate alone fits,
opens the list where several do, moves to a snippet's next field, or
indents. Escape, then Tab, leaves the editor, so the keyboard alone
moves the focus on. The editor's own keys are the rest: Ctrl+Space asks
for completion; while the list is open, Up and Down, Page Up and Page
Down, Home and End move through it, Enter takes an item and Escape
closes it; Cmd+Z, or Ctrl+Z, undoes; Alt+Up and Alt+Down move a line; a
click with Cmd, or Ctrl, adds a cursor; Cmd+Alt+[, or Ctrl+Shift+[,
folds a statement, and the same with ] unfolds it.

Shift+F10, or the context menu key, opens the context menu of what has
the focus: a row of the explorer, a cell of a result, the editor, or a
model's diagram ([The Window](../user/02-window.md#context-menus)).
