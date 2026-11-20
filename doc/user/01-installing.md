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

## A server to connect to

Studio connects to a Turborel server of the same release. Turborel's
[Running the Server](https://github.com/turborel/turborel/blob/main/doc/operator/02-turboreld.md)
says how to start one. The latest alpha of Turborel is built for Linux,
macOS and Windows as the pre-release
[nightly](https://github.com/turborel/turborel/releases/tag/nightly),
and as the image `ghcr.io/turborel/turborel:nightly`.
