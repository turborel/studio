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
  send;
- in a Live Session: a connection's setting or secret in what is shared;
  a value shared that the settings keep back; a viewer admitted who was
  not approved, or who reaches the presenter's connection; a relay, or
  anyone between, reading what is shared; an invitation used twice or
  after it expired;
- an act of administration run that the user did not choose, or a
  password of one kept anywhere.

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
- **The user's machine:** from what a server, a file, a model or a Live
  Session's peer sends.
- **What a presenter shares:** only the tabs picked, filtered by the
  backend before they leave: never a connection, its settings or a
  secret; of production, no values unless the session says.

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
- **A Live Session's network and relay:** QUIC with TLS 1.3, the
  certificate made for the session pinned by the invitation's
  fingerprint; through a relay, a TLS 1.3 session of the two ends inside
  what the relay passes, which it cannot read.
- **Someone with an invitation who is not invited:** an invitation is
  used once and expires; each viewer is admitted by name after the two
  safety codes are compared, and may be removed at any time.
- **A viewer:** it is shown what is shared and nothing more: it has no
  session on the database, and its suggestions run only as the
  presenter runs them.

### What Studio trusts

- The operating system, its keychain and the user's account: another
  program the user runs can read what the user can.
- The platform's webview and Tauri, which isolate the webview from the
  system and carry its calls to the backend.
- The certificate authorities the user trusts, or the platform's when the
  user asks for them.
- The libraries it is built from, checked by `cargo deny` and
  `npm audit`, with their versions pinned and their lock files committed.
- A viewer of a Live Session, with what it is shown: what reaches a
  viewer's screen can be kept, by a photograph if not by copying. The
  setting that stops copying stops it in Studio, no more.
- The channel an invitation is sent over, for as long as the invitation
  lives: whoever has it may ask to join, and is refused unless the
  presenter admits them by name and safety code.

### What it keeps, and where

- The history keeps the statements run, unless **Keep a history of what runs** is
  off; no statement of security, such as one with a password, is kept.
- A worksheet keeps its text, as the user wrote it, in `worksheets.json`.
- `failures.log` keeps what the window told of a failure it did not
  handle, which may quote a server's message.
- The assistant's log and Live Sessions' log keep what was asked, done
  and shared, never a key, a secret, a row's value nor a workspace.
- A saved embedded database keeps, in `connections.json`, its folder,
  its keys directory's path and its checksum key's name, never a key:
  the engine reads each key from the keys directory as it needs it. An
  embedded database's folders reach the backend only as the platform's
  dialog chose them, or as they were saved, so the window cannot name
  another folder to open or make a database in.

Studio sends nothing anywhere of its own accord: no telemetry, no
analytics, no updates. The network is touched only by the user's
connections, the assistant's provider when it is turned on, and a Live
Session the user presents or joins, directly or through the relay the
settings name.
