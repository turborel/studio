# Versioning

How Turborel Studio's releases are numbered, which Turborel each is made
for, and how a release is published.

[Release numbers](#release-numbers) · [Alpha](#alpha) ·
[The server](#the-server) · [Where the version is](#where-the-version-is) ·
[Publishing](#publishing)

---

## Release numbers

Studio has no version scheme of its own (RULES.md D5). Its version is the
number of the Turborel release it is made for, the same number as the
server's: a Turborel release and Studio's release for it share it,
**MAJOR.MINOR.PATCH**, as Turborel's
[VERSIONING.md](https://github.com/turborel/turborel/blob/main/VERSIONING.md)
numbers them, after
[Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

A Studio of a release works with a server of the same release. A fix of
Studio alone, between Turborel's releases, waits for the next release's
number.

## Alpha

Turborel is in alpha, version **0.0.0**, until its first release, and so
is Studio. While the version is 0.y.z nothing is promised: Studio's
behaviour and its files may change in any build. Its files (a model,
saved connections, settings, the layout and the assistant's log) each
carry a format version of 1, and during the alpha a format changes in
place, with no reader of an older layout kept (RULES.md R-FMT-1). The
first stable release is **1.0.0**, with Turborel's.

## The server

Studio speaks to a server through turborel-client, Turborel's own client
library, built from the commit of Turborel's `main` that the workspace's
`Cargo.toml` pins (RULES.md D10), and so speaks the native protocol's
version 1, asking for the capabilities that commit's client asks for.

| Studio | Turborel | Protocol |
|---|---|---|
| 0.0.0 (alpha) | 0.0.0 (alpha) | 1 |

## Where the version is

- The workspace's `Cargo.toml` holds the number, written once, as
  `[workspace.package] version`. `package.json` and
  `src-tauri/tauri.conf.json` carry it too, and a test holds them to it.
- A release is tagged with exactly the tag Turborel's own release
  uses, the same name with the same `v` prefix, as `v0.1.0`, on the
  commit whose `doc/` describes that release. turborel.com's
  documentation site reads the manual, `doc/`, from `main` while there
  is no release, and at each release's tag once there are. A Turborel
  release this repository has no tag for is left out of Studio's docs for
  that version; it never falls back to `main`. If this tag is pushed
  after the server's release, run the docs-site workflow by hand so the
  site picks it up.

## Publishing

Nothing is published, and no release is tagged, until the maintainers
publish a release.
Until then, build Studio from source, as [README.md](README.md) says.

A release is published by the maintainers alone, from a clean checkout of a
pushed commit that has passed `cargo xtask verify` and
`cargo xtask coverage` in CI on every platform:

1. Set the release's number in the workspace's `Cargo.toml`,
   `package.json` and `src-tauri/tauri.conf.json`, in a commit of its
   own.
2. Run the workflow **release** by hand, on that commit. It builds the
   installers, `.dmg`, `.msi`, `.AppImage` and `.deb`, unsigned, and
   keeps them as the run's artifacts. It publishes nothing.
3. Signing and notarization wait for the maintainers' signing
   certificates. The workflow's last step, which tags the release and
   publishes it, is written but disabled until a maintainer enables it. Every installer
   carries `LICENSE`.
