# Files

[Contents](README.md)

The files Studio keeps, each a JSON document of format version 1, which
its `format` holds. During the alpha a format changes in place, and a
file of another version is refused, saying so.

Studio keeps them in a folder of the user's own, which only the user may
read: on Unix, the folder is of mode 0700 and each file of mode 0600. A
file is written whole, through a file beside it renamed into its place,
so a crash leaves the old file or the new. None holds a password.

| File | Where | What |
|---|---|---|
| `connections.json` | the configuration | the saved connections |
| `settings.json` | the configuration | the settings ([Appendix B](b-settings.md)) |
| `layout.json` | the configuration | the dock's layout |
| `worksheets.json` | the configuration | the worksheets, with their text |
| `history.json` | the configuration | the history of what ran |
| `queries.json` | the configuration | the favourite queries |
| `projects.json` | the configuration | the project folders |
| `reports.json` | the configuration | the user's own reports |
| `assistant.json` | the configuration | the assistant's settings, of no key |
| `assistant-policy.json` | the configuration | the assistant's policy of each saved connection |
| `assistant-audit.jsonl` | the configuration | the assistant's log, an entry a line |
| `live-sessions.json` | the configuration | Live Sessions' settings |
| `live-sessions-audit.jsonl` | the configuration | Live Sessions' log, an entry a line |
| `live-records/session-*.jsonl` | the configuration | a session's record, kept by its presenter, an entry a line |
| `failures.log` | the configuration | the failures the window did not handle, a line each |
| `turborel-studio-*` | the cache, `results` | a result's pages, sealed, while it is open |

A file of Studio's that does not fit, as one an earlier build wrote of
another shape, too long, not JSON, of another format version, or of a
setting out of its bounds, is set aside: renamed beside itself, with
`.set-aside-` and the instant after its name, so it is kept to be read,
and Studio starts without it. The window says so until the notice is
dismissed.

`failures.log` is no JSON document, nor is `assistant-audit.jsonl`
([assistant-audit.jsonl](#assistant-auditjsonl)). Each line of
`failures.log` is the second it was written, since 1970, then what the window told of a failure, its lines
joined, at most 16,384 characters. Past 1 MiB it is begun again, the
old kept as `failures.log.old`. It holds no secret.

The configuration's folder is, on macOS,
`~/Library/Application Support/com.turborel.studio`; on Linux,
`~/.config/com.turborel.studio`; on Windows,
`%APPDATA%\com.turborel.studio`. The cache's is, on macOS,
`~/Library/Caches/com.turborel.studio`; on Linux,
`~/.cache/com.turborel.studio`; on Windows,
`%LOCALAPPDATA%\com.turborel.studio`.

## connections.json

The saved connections, each with no password, and those used last:

```json
{
  "format": 1,
  "connections": [
    {
      "id": "6f1c0e2a9b3d4c5e8f7a6b5c4d3e2f10",
      "name": "Orders",
      "folder": ["Team", "EU"],
      "spec": {
        "host": "db1.example,db2.example",
        "user": "ann",
        "tlsMode": "verify-full",
        "tlsRoots": "/etc/turborel/ca.pem"
      },
      "environment": "production",
      "colour": null,
      "readOnly": true,
      "pinned": true,
      "favourites": [{ "kind": "TABLE", "schema": "ANN", "name": "ORDERS" }]
    },
    {
      "id": "0a9b8c7d6e5f40312a3b4c5d6e7f8091",
      "name": "Sales (local)",
      "folder": ["Local"],
      "spec": {},
      "environment": "development",
      "colour": null,
      "readOnly": false,
      "pinned": false,
      "favourites": [],
      "embedded": {
        "directory": "/Users/ann/databases/sales",
        "keys": "/Users/ann/databases/sales-keys",
        "checksumKey": "CHECKSUMS",
        "pluginDirectories": null,
        "user": null
      }
    }
  ],
  "recent": ["6f1c0e2a9b3d4c5e8f7a6b5c4d3e2f10"]
}
```

`spec` holds the connection's settings, each of turborel-client's by its
name: `uri`, `host`, `port`, `user`, `tlsMode`, `channelBinding`,
`connectTimeout`, `service`, `serviceFile`, `passfile`, `target`,
`loadBalance`, `tlsRoots`, `tlsSystemRoots`, `tlsCertificate`, `tlsKey`
and `serverName`. A key not of these is refused. `environment` is
`development`, `test` or `production`, and `colour` is `#RRGGBB` or
null. `favourites` lists the connection's favourite objects
([The Object Explorer](../user/04-explorer.md#favourites)), at most 500,
each by its kind, `TABLE` (of a table or view), `ROUTINE` (by its
specific name), `SEQUENCE`, `DOMAIN` or `TYPE`, its schema and its name;
it may be left out, for none.

`embedded`, of a saved embedded database
([Connections](../user/03-connections.md#embedded-databases)), names its
`directory`; its keys directory, `keys`, and its checksum key's name,
`checksumKey`, never a key; its plug-in directories, `pluginDirectories`,
separated by `;`; and the identifier its session acts as, `user`, null
for the database's owner. Its `spec` is empty. A connection with no
`embedded` is a server's.

## settings.json

```json
{
  "format": 1,
  "theme": "dark",
  "zoomPercent": 110,
  "editorFontFamily": "",
  "editorFontPoints": 13,
  "keyBindings": { "zoom.in": "Mod+Shift+=" },
  "reconnectOnWake": true,
  "toolbarLabels": false,
  "historyKept": true,
  "formatKeyWords": "upper",
  "formatIndent": 4,
  "formatLineWidth": 100,
  "notifyAfterSeconds": 10,
  "planView": "visual",
  "analyzeKeepsChanges": false
}
```

A setting the file lacks is its default.

## layout.json

The dock's own description of its panels and groups, kept as the dock
gives it:

```json
{
  "format": 1,
  "dock": { "grid": {}, "panels": {} }
}
```

It is at most 1 MiB. A layout of panels this release has not is laid
out afresh.

## worksheets.json

The worksheets, in their tabs' order, each with its text, kept a moment
after it last changes ([Worksheets](../user/05-worksheets.md#keeping-worksheets)):

```json
{
  "format": 1,
  "worksheets": [
    {
      "id": "6f1c0e2a9b3d4c5e8f7a6b5c4d3e2f11",
      "title": "report.sql",
      "text": "SELECT * FROM STAFF",
      "connection": "6f1c0e2a9b3d4c5e8f7a6b5c4d3e2f10",
      "pinned": false,
      "path": "/home/ann/sql/report.sql",
      "modified": false
    }
  ]
}
```

`connection` is the saved connection's identifier, or null; `path` the
file the worksheet was saved to or opened from, or null; `modified`
whether its text has changed since. At most 200 worksheets are kept,
each text at most 16 MiB.

## history.json

The statements run, the latest first, at most 1000, each at most 64 KiB
([Worksheets](../user/05-worksheets.md#the-history)):

```json
{
  "format": 1,
  "entries": [
    {
      "sql": "SELECT * FROM STAFF",
      "at": 1795000000000,
      "connection": "Orders",
      "saved": "6f1c0e2a9b3d4c5e8f7a6b5c4d3e2f10",
      "millis": 4,
      "rows": 3,
      "sqlstate": "00000"
    }
  ]
}
```

`at` is when it ran, in milliseconds since 1970-01-01 UTC; `rows` the
rows it gave or changed, or null. A statement that changes who may do
what is never kept.

## queries.json

The favourite queries, at most 1000:

```json
{
  "format": 1,
  "queries": [{ "id": "q1", "name": "All staff", "sql": "SELECT * FROM STAFF" }]
}
```

## projects.json

The project folders, at most 100:

```json
{
  "format": 1,
  "folders": ["/home/ann/sql"]
}
```

## reports.json

The user's own reports ([The Analyzer](../user/09-analyzer.md#reports)),
at most 1000, each of its identifier, name and query, and its chart, or
null to show its rows as a table. A chart is of a `kind`, `bar` or
`line`; the column whose values name its rows, `label`; and the columns
whose numbers it draws, `values`, one to eight:

```json
{
  "format": 1,
  "reports": [
    {
      "id": "r1",
      "name": "Sales by Region",
      "sql": "SELECT REGION, SUM(AMOUNT) AS TOTAL FROM ANN.SALES GROUP BY REGION ORDER BY REGION",
      "chart": { "kind": "bar", "label": "REGION", "values": ["TOTAL"] }
    }
  ]
}
```

## assistant.json

The assistant's settings ([The Assistant](../user/10-assistant.md#turning-it-on)):
whether it is on, `enabled`; the model it asks, `provider`, `claude`
or `own`; Claude's model, `claudeModel`; and the user's own model,
`own`, of its base URL, model, wire format, `chatCompletions` or
`anthropic`, and whether it calls tools. Its keys are kept in the
keychain alone, never here.

```json
{
  "format": 1,
  "enabled": true,
  "provider": "own",
  "claudeModel": "claude-opus-5-5",
  "own": {
    "baseUrl": "http://localhost:11434",
    "model": "local-model",
    "wire": "chatCompletions",
    "tools": true
  }
}
```

## assistant-policy.json

The assistant's policy of each saved connection, by the connection's
identifier, at most 1000 ([The policy](../user/10-assistant.md#the-policy)).
Its `level` is `off`, `explainOnly`, `read` or `proposeChanges`. The
classes allowed and denied, `allowClasses` and `denyClasses`, are of
`read`, `transaction`, `session`, `writeRows`, `changeSchema`,
`security`, `administration` and `unclassified`; an empty list of those
allowed allows each. The lists of schemas and tables hold at most 500,
each `SCHEMA` or `SCHEMA.TABLE`. A connection the file does not name
has its environment's policy. **Export Policies…** writes this file
whole, and **Import Policies…** reads one of its shape.

```json
{
  "format": 1,
  "connections": {
    "9f2c4e1a": {
      "level": "read",
      "preview": true,
      "redactLiterals": false,
      "allowClasses": [],
      "denyClasses": ["security"],
      "allowObjects": [],
      "denyObjects": ["ANN.PAY"],
      "hidden": ["HR"],
      "limits": { "rows": 100, "statementSeconds": 30, "toolCalls": 20, "tokens": 64000 },
      "login": "HELPER"
    }
  }
}
```

## assistant-audit.jsonl

The assistant's log ([The log](../user/10-assistant.md#the-log)): a line
of JSON each request, of format 1, its time in seconds since 1970, the
provider, the model that answered, the connection's name, the kinds of
context sent, each tool call and what became of it, how it stopped, and
its tokens. Past 1 MiB it is begun again, the old let go; a line of
another format, or that is no entry, is passed over. It holds no key,
nor a row's value.

```json
{"format":1,"time":1795046400,"provider":"claude","model":"claude-opus-5-5","connection":"Orders","sent":["schema","sql"],"tools":[{"name":"run_query","outcome":"approved"}],"stop":"toolUse","usage":{"input":5120,"output":240,"cacheRead":4800,"cacheWritten":0}}
```

## live-sessions.json

Live Sessions' settings ([Live Sessions](../user/11-live-sessions.md#the-settings)):
whether sessions are on, `enabled`; the name others see, `name`; what
each environment shares, `share`, and whether its values too,
`values`; the rows of a result shared, `rowLimit`, from 1 to 10,000;
the columns whose values are masked, `maskedColumns`, at most 500;
whether viewers may copy, `allowCopy`; whether a viewer may be granted
Suggest, `allowSuggest`; the most viewers, `maxViewers`, from 1 to 64;
an invitation's minutes, `inviteMinutes`, from 1 to 60; how a presenter
is reached, `connectivity`; whether a session may widen these,
`locked` false, or not; and what sessions keep of themselves,
`records`: whether a session may be recorded, `allowed`, whether each
is recorded from its start, `byDefault`, and whether a record is sealed
under a key kept in the keychain, `sealed`.

```json
{
  "format": 1,
  "enabled": true,
  "name": "Ann",
  "environments": {
    "development": { "share": true, "values": true },
    "test": { "share": true, "values": true },
    "production": { "share": true, "values": false }
  },
  "rowLimit": 100,
  "maskedColumns": ["SALARY"],
  "allowCopy": false,
  "allowSuggest": true,
  "maxViewers": 10,
  "inviteMinutes": 10,
  "connectivity": {
    "direct": true,
    "port": 0,
    "advertise": [],
    "relay": false,
    "relayAddress": "",
    "relayFingerprint": ""
  },
  "locked": false,
  "records": { "allowed": true, "byDefault": false, "sealed": false }
}
```

## live-sessions-audit.jsonl

Live Sessions' log ([Live Sessions](../user/11-live-sessions.md#the-log)):
a line of JSON each event, of format 1, its time in seconds since 1970,
what happened, `what`, of whom, `who`, a participant's name, and more
of it, `detail`, as a suggestion's SQL, at most 4096 characters. It is
begun again past 1 MiB, the old let go. It holds no workspace, nor a
secret.

```json
{"format":1,"time":1795046400,"what":"admitted","who":"Bob","detail":null}
```

## live-records

A session's record ([Live Sessions](../user/11-live-sessions.md#records)),
in `live-records`, a file a session, `session-` and the instant it began
and the start of the session's identifier, its owner's alone. Its first
line is its head, of format version 1: the session, the presenter, when
it began in milliseconds since 1970, and whether it is sealed:

```json
{"format":"turborel-studio-live-record","version":1,"session":"0f0f…","presenter":"Ann","started":1795046400000,"sealed":false}
```

Each line after is an entry: a workspace as it was shared, `shared`,
with who presented it if a viewer did; a viewer's suggestion,
`suggested`; a viewer who came or went, `joined` and `left`; and its
end, `ended`. Each holds what was sent and nothing more, its masks and
row limit applied. A sealed record's entries are each sealed with
AES-256-GCM under the key the keychain keeps as `live-records-key`, in
base64 of the URL's alphabet: a nonce, then the entry and its tag.

## A model's file

A model ([Schema Modeling](../user/08-modeling.md)) is a file of the
user's own, where **Save Model As…** puts it, not in Studio's folder. It
is a JSON document whose `format` is `turborel-studio-model` and whose
`version` is 1; a file of another format or version, or whose tables are
not of the shape below, is refused, saying why.

```json
{
  "format": "turborel-studio-model",
  "version": 1,
  "name": "Sales",
  "tables": [
    {
      "schema": "ANN",
      "name": "DEPT",
      "columns": [
        {
          "name": "ID",
          "type": "INTEGER",
          "notNull": true,
          "default": null
        },
        {
          "name": "NAME",
          "type": "VARCHAR(20)",
          "notNull": false,
          "default": "'none'"
        }
      ],
      "primaryKey": {
        "name": "DEPT_PRIMARY1",
        "columns": [
          "ID"
        ]
      },
      "uniques": [],
      "checks": [],
      "foreignKeys": [],
      "indexes": [],
      "position": {
        "x": 300,
        "y": 0
      }
    },
    {
      "schema": "ANN",
      "name": "STAFF",
      "columns": [
        {
          "name": "ID",
          "type": "INTEGER",
          "notNull": true,
          "default": null
        },
        {
          "name": "DEPT",
          "type": "INTEGER",
          "notNull": false,
          "default": null
        }
      ],
      "primaryKey": {
        "name": null,
        "columns": [
          "ID"
        ]
      },
      "uniques": [],
      "checks": [
        {
          "name": "STAFF_ID",
          "condition": "ID > 0"
        }
      ],
      "foreignKeys": [
        {
          "name": "STAFF_DEPT",
          "columns": [
            "DEPT"
          ],
          "references": {
            "schema": "ANN",
            "table": "DEPT",
            "columns": [
              "ID"
            ]
          },
          "onDelete": "SET NULL",
          "onUpdate": "NO ACTION"
        }
      ],
      "indexes": [
        {
          "name": "STAFF_BY_DEPT",
          "columns": [
            "DEPT"
          ],
          "method": "btree"
        }
      ],
      "position": {
        "x": 0,
        "y": 0
      }
    }
  ],
  "graphs": []
}
```

Each table has its schema and name; its columns, each with its type as
SQL writes it, whether it is NOT NULL, and its default as SQL writes it,
or null; its primary key, or null, and its unique constraints, each of
its name, or null, and its columns; its checks, each of its name and
condition; its foreign keys, each of its name, its columns, the table and
columns it references, and its rules; its indexes, each of its name, its
columns and its method; and its place in the diagram, or null where it
has none. `graphs` holds the property graphs read with the tables, each
of its schema, name and element tables.
