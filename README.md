<p align="center">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="artwork/studio-logo-white.svg">
      <img src="artwork/studio-logo.svg" alt="Turborel Studio" width="480">
    </picture>
</p>

> Turborel Studio is in alpha, meaning, version 0.0.0. Its version is
> the number of the Turborel release it is made for, and the alpha is
> made for Turborel 0.0.0. Anything may change from one build to the
> next, its files and behaviour alike. See [VERSIONING.md](VERSIONING.md).
> The latest Turborel alpha is built for Linux, macOS and Windows as the
> pre-release
> [nightly](https://github.com/turborel/turborel/releases/tag/nightly),
> and as the image `ghcr.io/turborel/turborel:nightly`.

Turborel Studio is the desktop database IDE for
[Turborel](https://github.com/turborel/turborel), a relational database
system. It connects to a Turborel server, `turboreld`, through
Turborel's own client library, turborel-client, and gives a person who
works with the database one window for it:

- a Connections and Object Explorer tree of the catalog;
- tabbed SQL worksheets, each with its results and messages;
- a results grid that reads a query's rows a page at a time;
- editing a table's rows, and dialogs that write DDL;
- schema diagrams, models designed offline and compared with a live
  schema, and schema compare;
- an analyzer of indexes and plans;
- an assistant, off until the user turns it on;
- a monitor of the server, its sessions, users and replication.

It runs on Linux, macOS and Windows, built with Tauri: a Rust backend
over turborel-client, and a front end in TypeScript and React. Passwords
and keys stay in the operating system's keychain, and the webview never
sees them ([SECURITY.md](SECURITY.md)).

Studio is built in milestones, M0 to M11. [CONFORMANCE.md](CONFORMANCE.md)
says what it supports of Turborel, row by row, and [TODO.md](TODO.md)
what is open.

## Requirements

- Linux, macOS or Windows, with the platform's webview: WebKitGTK 4.1 on
  Linux, WKWebView on macOS, WebView2 on Windows
  ([RULES.md](RULES.md) D3).
- A Turborel server of the same release
  ([running the server](https://github.com/turborel/turborel/blob/main/doc/operator/02-turboreld.md)).

## Building

No build is published yet. Studio's installers are made only once the
owner says, with Turborel's release ([VERSIONING.md](VERSIONING.md)).
Until then, build it from source, as
[Installing](doc/user/01-installing.md) says: Rust (the toolchain
`rust-toolchain.toml` names), Node.js 24 or later, and the platform's
webview and its build dependencies.

```
npm ci
npm exec -- tauri build
```

## The manual

[doc/](doc/README.md) is the manual: a User's Guide and Appendices,
published at https://turborel.com/docs/studio/. Each chapter is written
as the milestone that fills it lands. The SQL Studio runs, and the
server, are described in Turborel's own manual,
[The Turborel Documentation Set](https://github.com/turborel/turborel/blob/main/doc/README.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before making a change: how a
change is made, its commit message, pull requests and issues. Every
change passes `cargo xtask verify`. [RULES.md](RULES.md) says how Studio
is designed, written and verified, [CONFORMANCE.md](CONFORMANCE.md) what
it supports of Turborel, and [TODO.md](TODO.md) lists open work.

## Security

Report a vulnerability privately, never in a public issue, as
[SECURITY.md](SECURITY.md) says.

## License and trademark

The code is under the BSD-2-Clause Plus Patent License, in
[LICENSE](LICENSE). The name Turborel and its logos, Studio's icon among
them, are not: [TRADEMARK.md](TRADEMARK.md) says how they may be used.
