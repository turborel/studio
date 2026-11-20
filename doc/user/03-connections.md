# Connections

[Contents](README.md)

A connection is a session of a Turborel server. Studio opens one through
Turborel's own client library, turborel-client, and keeps each on a
thread of its own, so one waiting on its server never holds up the
window or another connection. A connection may be saved, with its
settings, its environment and its colour, and its password kept in the
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

- **Open**: each connection open, with its colour. Clicking one makes it
  the active connection, which the status bar, the toolbar and the
  Connection menu act on; **Disconnect** ends it.
- **Pinned**: the saved connections pinned.
- **Saved**: every saved connection, in its folders, folders and names
  in order.
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
own parser, and a script by its strictest statement. EXPLAIN, and
EXPLAIN ANALYZE, which runs its query, take only a query, and are
classified as it is. A statement of dynamic parameters, `?`, is classified as
the server reads it prepared.

A connection set **Read-only** begins each transaction READ ONLY, so the
server refuses a change; and Studio refuses, before sending it, a
statement that may change the database, or that makes a transaction
READ WRITE (SQLSTATE 25006).

Every statement Studio runs on a connection goes through its guards.

## Ending and reconnecting

**Connection > Disconnect** ends the active connection. **Reconnect**
connects it again, by the settings it was made by, in a new session.
**Cancel Statement** cancels the statement it runs, from a connection of
its own to the server; the statement fails, SQLCODE -920, and is undone.
**Commit** and **Rollback** end its transaction.

A connection the server loses, or ends, is shown lost, in the explorer
and the status bar, and takes no more statements until it is
reconnected. When the window is shown again, or the network comes back,
Studio checks each open connection, and connects one lost again, unless
the setting **Check connections as the computer wakes** is off.
