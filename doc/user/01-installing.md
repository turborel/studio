# Installing

[Contents](README.md)

No installer of Turborel Studio is published yet: installers are made
only once Turborel's release is, as
[VERSIONING.md](../../VERSIONING.md) says. Until then, Studio is built
from its source, on the platform it is to run on.

## What a build needs

- **Rust:** the toolchain the repository's `rust-toolchain.toml` names.
  With rustup installed, the first build installs it.
- **Node.js:** release 24 or later, with npm.
- **The platform's webview** and what a build of it needs:
  - **Linux:** WebKitGTK 4.1 and its development files, and a C
    compiler. On Debian and Ubuntu:

    ```
    sudo apt-get install libwebkit2gtk-4.1-dev build-essential pkg-config libxdo-dev librsvg2-dev file
    ```

  - **macOS:** the Xcode command line tools (`xcode-select --install`).
  - **Windows:** the Microsoft C++ Build Tools, and WebView2, which
    Windows 10 and 11 have.

## Building

In a clone of the repository:

```
npm ci
npm exec -- tauri build
```

`npm ci` installs the front end's packages, as `package-lock.json` pins
them. `tauri build` builds the front end and the application, then its
installers for the platform it runs on, under
`target/release/bundle/`: a `.dmg` and an application on macOS, an
`.msi` on Windows, and an `.AppImage` and a `.deb` on Linux. None is
signed.

To run Studio from the source as it is changed, run
`npm exec -- tauri dev` instead.

## The nightly

Studio's latest alpha is built as the pre-release
[nightly](https://github.com/turborel/studio/releases/tag/nightly) after
each change of main that passed every check. It holds an installer of each
platform, at a fixed name, and their SHA-256 sums:

| File | For |
|---|---|
| `turborel-studio-nightly-macos-arm64.dmg` | macOS on Apple silicon |
| `turborel-studio-nightly-windows-x64.msi` | Windows on x64 |
| `turborel-studio-nightly-linux-x64.AppImage` | Linux on x64, any distribution |
| `turborel-studio-nightly-linux-x64.deb` | Debian and Ubuntu on x64 |
| `SHA256SUMS` | the sum of each |

Its notes name the commit of Studio and of turborel-client it was built
from. Each build replaces the last, never with an older commit's.
Anything may change from one build to the next
([VERSIONING.md](../../VERSIONING.md)).

### Checking a file

Check a file against `SHA256SUMS`, in the folder of both:

- **Linux:** `sha256sum --check --ignore-missing SHA256SUMS`
- **macOS:** `shasum -a 256 --check --ignore-missing SHA256SUMS`
- **Windows:** `Get-FileHash turborel-studio-nightly-windows-x64.msi -Algorithm SHA256`
  in PowerShell, and compare its hash with the file's line in
  `SHA256SUMS`.

### Opening a build

The nightly's notes say how each installer is signed. A signed one opens
as any application does:

- **macOS:** signed by the project's Developer ID and notarized by
  Apple, the `.dmg` opens with no question; drag Turborel Studio to
  Applications, and open it.
- **Windows:** signed, the `.msi` installs as any signed installer does.

A build made without the project's certificates, as a build of one's
own, or a nightly the notes call unsigned, asks first:

- **macOS:** the application is signed ad hoc, with no developer's
  certificate, so the first time macOS says it cannot check it: open
  **System Settings > Privacy & Security** and choose **Open Anyway**.
- **Windows:** when SmartScreen says it protected the PC, choose **More
  info**, then **Run anyway**.
- **Linux:** make the AppImage executable,
  `chmod +x turborel-studio-nightly-linux-x64.AppImage`, and run it; or
  install the `.deb` with
  `sudo apt install ./turborel-studio-nightly-linux-x64.deb`.

## A server, or none

Studio connects to a Turborel server of the same release. Turborel's
[Running the Server](https://github.com/turborel/turborel/blob/main/doc/operator/02-turboreld.md)
says how to start one. An embedded database, in a folder or in memory,
needs no server: Studio holds Turborel's engine itself, at the commit
**Help > About** names, and opens one in its own process
([Embedded databases](03-connections.md#embedded-databases)). A database
another alpha build of Turborel made may not open with that engine, and
Studio says so. The latest alpha of Turborel is built for Linux,
macOS and Windows as the pre-release
[nightly](https://github.com/turborel/turborel/releases/tag/nightly),
and as the image `ghcr.io/turborel/turborel:nightly`.

![The About Turborel Studio dialog: Studio's version, and the Turborel commit of its client and engine](../images/about-light.png#gh-light-mode-only)
![The About Turborel Studio dialog: Studio's version, and the Turborel commit of its client and engine](../images/about-dark.png#gh-dark-mode-only)
