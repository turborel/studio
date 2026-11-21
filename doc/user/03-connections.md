# Connections

[Contents](README.md)

A connection is a session of a Turborel server, or of a database Studio
opens itself, embedded. Studio opens a server's through Turborel's own
client library, turborel-client, and an embedded database through
Turborel's embedded library, in its own process ([Embedded
databases](#embedded-databases)). It keeps each on a thread of its own,
so one waiting on its server or its database never holds up the window
or another connection. A connection may be saved, with its settings, its
environment and its colour, and a server's password kept in the
operating system's keychain.

## Opening a connection

**File > New Connection…**, the toolbar's **New Connection**, or the
explorer's **New Connection…** opens the connection dialog. Its fields
are in groups:

| Group | Field | What it says |
|---|---|---|
| Connection | Name | the connection's name, as the explorer shows it |
| | Folder | the folders it is kept in, outermost first, separated by `/`, as `Team / EU` |
| | Environment | Development, Test or Production ([Environments and guards](#environments-and-guards)) |
| | Colour | a colour of its own, `#RRGGBB`, else its environment's |
| | Read-only | each of its transactions is begun READ ONLY |
| | Pinned | it is listed first in the explorer |
| Server | URI | a connection URI, `turborel://…` |
| | Hosts | the servers, comma-separated, each `name`, `name:port`, `[IPv6]:port`, or the path of a Unix socket |
| | Port | the port of each host that names none |
| | User | the user to connect as |
| | Password | the user's password |
| | Save the password in the keychain | keep the password typed, for this connection |
| TLS | TLS mode | `verify-full`, `verify-ca`, `require`, `prefer` or `disable` |
| | Authorities | a PEM file of the certificate authorities trusted |
| | Trust the platform's authorities | `true` to trust the platform's too |
| | Client certificate, Client key | PEM files of a certificate to present, and its key |
| | Server name | the name the server's certificate is checked against, if not the host's |
| | Channel binding | `disable`, `prefer` or `require` |
| More | Service, Service file | a section of a service file to read settings from, and the file |
| | Password file | the password file |
| | Target | `any`, `read-write` or `read-only` |
| | Load balance | `disable`, or `random` to try the hosts in an order drawn for each connection |
| | Connect timeout | whole seconds each step of connecting waits; 0 for no limit |

Each setting is turborel-client's own, of the same name, as Turborel's
[Settings, Pipelines and Pools](https://github.com/turborel/turborel/blob/main/doc/client/02-library-connections.md)
describes it. A field left empty is no setting.

The dialog's buttons are:

- **Save** keeps the connection, and closes the dialog;
- **Save and Connect** keeps it and opens it;
- **Connect without Saving**, of a new connection, opens it and keeps
  nothing;
- **Cancel**, or Escape, closes the dialog.

A connection is saved only with a name, and with a URI, a user or a
service; until then the dialog says what it lacks, and Save is disabled.

If the connection cannot be made, the window shows why, by its SQLSTATE,
SQLCODE and message, above the dock, until it is dismissed.

## Where settings come from

Settings come in layers, each setting taken from the first layer that
has it:

1. the dialog's fields;
2. the URI;
3. the section of the service file the settings or the environment
   name;
4. the environment's variables, as TURBOREL_HOST and TURBOREL_USER;
5. Studio's defaults: TLS mode `verify-full`;
6. turborel-client's defaults: the host `localhost`, the port 7422.

```text
turborel://ann@db1.example:7422,db2.example/?tls_mode=verify-full&tls_roots=/etc/turborel/ca.pem
```

A URI of another scheme, of a setting turborel-client does not know, or
settings that name no user, are refused (SQLSTATE 08001).

Studio tells the server its name, `Turborel Studio`, as the connection
attribute `application`, unless the settings name another. A database's
owner sees it in INFORMATION_SCHEMA.CONNECTIONS, as the column
APPLICATION.

## TLS

A new connection is verified: its TLS mode is `verify-full`, so the
server's certificate must be signed by an authority trusted and be of
the server's name. Where no authorities are named, the platform's are
trusted. A connection to a host that is a path, a Unix socket, or a
named pipe on Windows, uses no TLS, as only its machine reaches it.

A mode of `prefer` or `disable` may connect over plain TCP. A password
is never sent so: such a connection is refused before anything is sent
(SQLSTATE 28000). The status bar shows a connection over plain TCP as
**NOT SECURE**.

A password is proved by SCRAM-SHA-256, and over TLS by
SCRAM-SHA-256-PLUS, bound to the connection; the password never
travels. A user with no password is proved by the client certificate,
if one is named, or else is trusted, as a server does of a client of its
own machine only if its setting SERVER.TRUST_LOCAL is ON.

## Passwords and the keychain

Studio keeps a saved connection's password in the operating system's
keychain: the Keychain on macOS, the Credential Manager on Windows, and
the Secret Service on Linux. It is never written to Studio's files, nor
shown again: the dialog's Password field is always empty, and a password
typed there replaces the one kept only when **Save the password in the
keychain** is checked. Deleting the connection forgets its password.

A connection opened with no password typed proves the one the keychain
keeps, else the password file's, else none.

Where no keychain can be opened, as a Linux session with no Secret
Service, **Save the password in the keychain** is disabled, and the
dialog says why.

## The explorer's connections

The explorer lists:

- **Open**: each connection open, with its colour, an embedded
  database's with a database's icon, and one in memory marked **not
  saved**. Clicking one makes it the active connection, which the status
  bar, the toolbar and the Connection menu act on; **Disconnect** ends
  it.
- **Pinned**: the saved connections pinned.
- **Saved**: every saved connection, in its folders, folders and names
  in order, an embedded database's with its folder's path.
- **Recent**: the ten saved connections used last, the latest first.

A saved connection's buttons, each an icon whose tooltip names it, are
**Connect**, **Edit**, **Pin** or **Unpin**, and **Delete**, which asks
again before it deletes it.
Double-clicking its name connects too.

## Environments and guards

A connection's environment sets its colour and its guards:

| Environment | Colour | Statements that may write |
|---|---|---|
| Development | none | run |
| Test | amber, #7A4F00 | run |
| Production | red, #B3261E | asked about first |

On a production connection, each statement that may change the database
asks first, and runs only once confirmed. On every connection, a
statement that destroys asks first: DROP, TRUNCATE, and DELETE or UPDATE
without WHERE; so does one Studio cannot classify, as dynamic SQL or a
CALL, which may hide one. Studio classifies each statement by Turborel's
own parser, and a script by its strictest statement. EXPLAIN of a query,
and EXPLAIN ANALYZE, which runs its query, are classified as the query
is. EXPLAIN ANALYZE of an INSERT, UPDATE, DELETE or MERGE runs the
change for real, so it is classified as that change: a write, asked
about on production, refused on a read-only connection, and asked about
first if it is a DELETE or UPDATE without WHERE. A statement of dynamic parameters, `?`, is classified as
the server reads it prepared.

A connection set **Read-only** begins each transaction READ ONLY, so the
server refuses a change; and Studio refuses, before sending it, a
statement that may change the database, or that makes a transaction
READ WRITE (SQLSTATE 25006).

Every statement Studio runs on a connection goes through its guards.

## Ending and reconnecting

**Connection > Disconnect** ends the active connection. If its
transaction is open, Studio first asks whether to **Commit** what it
changed, **Roll Back**, or **Cancel** and keep the connection open.
**Reconnect** connects it again, by the settings it was made by, in a
new session; of an embedded database, a new session of the same
database.
**Cancel Statement** cancels the statement it runs, from a connection of
its own to the server; the statement fails, SQLCODE -920, and is undone.
**Commit** and **Rollback** end its transaction.

A connection the server loses, or ends, is shown lost, in the explorer
and the status bar, and takes no more statements until it is
reconnected. When the window is shown again, or the network comes back,
Studio checks each open connection, and connects one lost again, unless
the setting **Check connections as the computer wakes** is off.

Quitting Studio asks alike, once for every connection whose transaction
is open: **Commit** commits each, **Roll Back** rolls each back, and
**Cancel** keeps Studio open. A commit that fails is told, and Studio
stays open. Closing the window a second time within ten seconds of being
asked quits at once, each open transaction rolled back, so a window that
cannot answer never keeps Studio open; with no window left, Studio quits
at once.

## Embedded databases

Turborel runs as a server, and as a library a program embeds. Studio
opens both. An embedded database is opened in Studio's own process, kept
in a folder, or in memory. Every part of Studio works on it as on a
server's connection: worksheets, the explorer, results, plans, modeling,
the analyzer, the monitor, the assistant and Live Sessions, under the
same guards. Each embedded database's session is on a thread of its own,
named `studio-embedded-` and the connection's number, as a server's is
named `studio-connection-` and its number.

The status bar says **Embedded** of a database in a folder, and
**In-memory, not saved** of one in memory, where a server's connection
says how it reaches its server.

### Opening a database

**File > Open Database…**, or the explorer's **Open Database…**, opens a
database another program, or Studio, made. **Choose…** chooses its
folder, with the platform's dialog, and Studio looks at it before
anything is opened: a folder that holds no database is refused, with
**New Database…** offered instead, and nothing is made in it, so a
mistyped path never becomes a new, empty database.

| Field | What it says |
|---|---|
| Database folder | the folder that holds the database |
| Name, Folder in the explorer, Environment, Colour, Read-only | as of a server's connection |
| Act as | the authorization identifier the session acts as; empty for the database's owner |
| Keys directory | the folder of an encrypted database's keys, as `turboreld --keys` names it |
| Checksum key | the name, in the keys directory, of the key of a database whose checksums are keyed, as `turboreld --checksum-key` names it |
| Plug-in directories | the folders an extension's plug-in may be in, separated by `;`, as the setting PLUGINS.DIRECTORIES |

**Open without Saving** opens it; **Save** saves it among the
connections; **Save and Open** does both. A saved database opens its
folder, and never makes a database there.

### Making a database

**File > New Database…** makes a database in a folder that is empty, but
for hidden files, or new. A folder that holds a database is refused, with
**Open Database…** offered instead, and one that holds other files is
refused too. The **Owner** field names the database's owner, offered as
this computer's user's name in upper case; the owner is made with no
password, and its schema, of its name, is made too. **Create and Save**
makes the database and saves it, to be opened, not made, thereafter.

### A database in memory

**File > New In-Memory Database** makes a database kept in memory, a
scratch database to try things in. It is marked **not saved** in the
explorer and the status bar. Nothing of it is written anywhere, and it
is gone as its connection ends. Its owner is this computer's user's name
in upper case.

### A database another program holds

A database is opened by one program at a time, which holds its folder's
`lock` file while it has it open. Studio looks at the lock before it
opens a database: one a server or another program holds is refused as
open in another process. If a Unix socket of a server is in the folder,
or a server answers on this computer's port 7422, the dialog offers
**Connect to Its Server…**, which begins a new connection to it. A
database open in Studio already is not opened a second time.

### Closing, and after a crash

Disconnecting from an embedded database, or quitting Studio, closes it,
once its open transaction is committed or rolled back as Studio asks:
a checkpoint is written, and its lock given up. If Studio, or the
program before it, stopped without closing the database, the next
opening recovers it, as the engine does, keeping every committed
transaction and undoing the rest, and Studio says so above the window
until the notice is dismissed.

Studio's engine is Turborel at the commit Studio is built with
([Versions](../appendix/c-versions.md)). A database another build of
Turborel's alpha made, which this one cannot open, is refused with a
message that says so, and names that commit.

### Encrypted databases

An encrypted database opens with its keys directory, the folder its
keys are in, chosen with the platform's dialog, and its checksum key's
name, if its checksums are keyed. Studio keeps only the folder's path and
the key's name in its files, never a key: the engine reads each key from
the keys directory as it needs it. A database whose keys are not given
is refused with a message that asks for them.

### Settings and plug-ins

An embedded database's settings are read and changed as a server's: in
the monitor's **Settings** tab, or by `SET DATABASE`, kept with the
database ([Administration](12-administration.md)). The server's own
views, as its sessions and counters, are not there, and the monitor says
so.

Studio gives an embedded database the plug-ins `turboreld` gives one:
the SIMD kernels, LZ4 compression, AES-256-GCM and ChaCha20-Poly1305
encryption by the keys directory given, SHA-256 and SHA-512 checksums,
and HMAC-SHA-256 checksums by the checksum key given. The monitor's
**Plug-ins** tab lists each, whether it is loaded, and why not:
HMAC-SHA-256 without a checksum key; an extension's plug-in without
plug-in directories; and a host plug-in (PLUGINS.HOST), which Studio
never starts, so a database whose files, log or keys a host plug-in
keeps opens on its server. The extensions the database has, and their
plug-ins' processes and calls, are listed below them.
