# Security

Report a vulnerability privately, never in a public issue: on the
repository's **Security** tab, choose **Report a vulnerability**. Only the
maintainers see the report.

What counts, for Studio:

- a password, an assistant's key, or anything derived from one, such as
  a SCRAM key, disclosed: given to the webview, written to a file, a log,
  the history, a crash report or the clipboard, sent where it should not
  go, or kept where another program can read it;
- TLS not used, or not verified, where a connection asked for it, or a
  connection that is not secure without the status bar saying so;
- a statement run that the user did not run: by the assistant, by a
  model's tool call, or by anything read from the database;
- a statement that writes, run on a production connection without the
  user's confirmation, or in a transaction not READ ONLY on one set
  read-only; a statement that destroys run without asking;
- a server's reply, a file Studio reads (a model, saved connections, an
  import), or a model's answer, that can crash Studio, run code in it or
  in its webview, or take its memory without bound;
- the webview reaching more than the application's own commands, or
  loading anything from the network;
- data sent to an assistant's provider that the user did not choose to
  send.

A wrong value shown, a lost connection with no attacker, or a crash only
Studio's own misuse can cause is a bug: report it with the **Bug** form,
its impact in the title (CONTRIBUTING.md, Reporting issues). A
vulnerability of the server goes to
[turborel](https://github.com/turborel/turborel/security), and one of a
library Studio is built on, such as Tauri, to that library's repository.

Say in the report:

- what an attacker needs, such as a server of their own, a place on the
  network between Studio and the server, a user of the database, a file
  Studio opens, or a model's answers;
- what they gain;
- the commit you tested (`git rev-parse --short=12 HEAD`), the platform
  and its version;
- the smallest steps that show it.

You will hear back within a week. The fix is made in private and
published with an advisory that credits you, unless you ask not to be
named.

## Threat model

### What Studio protects

- **Secrets:** database passwords and the assistant's keys. They live in
  the operating system's keychain alone, and only the Rust backend reads
  them; the webview sees whether one is saved, never its value.
- **The database:** from statements the user did not mean to run.
  Statements that destroy ask first everywhere, a production connection
  asks before a statement that writes, and a read-only one begins each
  transaction READ ONLY.
- **The data:** row values stay between Studio and the server. They are
  never logged, and reach an assistant's provider only when the user
  includes them, request by request.
- **The user's machine:** from what a server, a file or a model sends.

### From whom

- **The network** between Studio and a server: TLS is verified by
  default for every host but a local socket.
- **A server, or a database's contents,** that is not what it seems:
  every reply's length is bounded before it is read, and names, comments,
  values and routine bodies are shown as text, never run or rendered as
  markup, and given to a model as data, never as instructions.
- **A file** Studio is given to open: a model, saved connections or an
  import, each read with its size bounded and its contents checked.
- **A model's answers:** the assistant's tools read, or propose SQL for
  the user to run; none runs a statement that writes, and none acts
  without the user.

### What Studio trusts

- The operating system, its keychain and the user's account: another
  program the user runs can read what the user can.
- The platform's webview and Tauri, which isolate the webview from the
  system and carry its calls to the backend.
- The certificate authorities the user trusts, or the platform's when the
  user asks for them.
- The libraries it is built from, checked by `cargo deny` and
  `npm audit`, with their versions pinned and their lock files committed.

Studio sends nothing anywhere of its own accord: no telemetry, no
analytics, no updates. The network is touched only by the user's
connections and, when it is turned on, the assistant's provider.
