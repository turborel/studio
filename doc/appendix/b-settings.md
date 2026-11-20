# Settings

[Contents](README.md)

Studio's settings, as **File > Settings…** sets them, are kept in the
file `settings.json`, in Studio's folder of the user's configuration
([Files](d-files.md)). Each is named after what it controls.

| Setting | What it controls | Values | Default |
|---|---|---|---|
| `theme` | The theme | `system`, `light` or `dark` | `system` |
| `zoomPercent` | The window's zoom, in percent | 50 to 300 | 100 |
| `editorFontFamily` | The editor's font, by family; empty for the platform's monospace | at most 128 characters | empty |
| `editorFontPoints` | The editor's font size, in points | 8 to 48 | 13 |
| `keyBindings` | Each command's key where it is not the default, by the command's name; an empty key unbinds it | at most 500, each at most 64 characters | none |
| `reconnectOnWake` | Whether open connections are checked as the window is shown again, or the network comes back, and those lost connected again | `true` or `false` | `true` |

A setting outside its values is refused, and the file is left as it was.
A file Studio cannot read, or of another format, is refused: the window
says why, and Studio goes on with the defaults, which a setting changed
then is saved with.
