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
| `toolbarLabels` | Whether the toolbar's buttons show their labels beside their icons | `true` or `false` | `false` |
| `historyKept` | Whether each statement run is kept in the history ([Worksheets](../user/05-worksheets.md#the-history)) | `true` or `false` | `true` |
| `formatKeyWords` | The case the formatter writes key words in | `upper`, `lower` or `keep` | `upper` |
| `formatIndent` | The formatter's indentation, in spaces | 1 to 8 | 4 |
| `formatLineWidth` | The width the formatter keeps lines within, in characters | 40 to 240 | 100 |
| `notifyAfterSeconds` | How long a run lasts, in seconds, before its end is notified while the window is in the background; 0 for never | 0 to 3600 | 10 |
| `planView` | How a plan is first shown: drawn, or as EXPLAIN's text | `visual` or `raw` | `visual` |

A setting the file lacks takes its default. A setting outside its values is refused, and the file is left as it was.
A file Studio cannot read, or of another format, is refused: the window
says why, and Studio goes on with the defaults, which a setting changed
then is saved with.
