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
| `turborel-studio-*` | the cache, `results` | a result's pages, sealed, while it is open |

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

## settings.json

```json
{
  "format": 1,
  "theme": "dark",
  "zoomPercent": 110,
  "editorFontFamily": "",
  "editorFontPoints": 13,
  "keyBindings": { "zoom.in": "Mod+Shift+=" },
  "reconnectOnWake": true
}
```

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
