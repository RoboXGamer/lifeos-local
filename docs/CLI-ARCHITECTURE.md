# CLI and desktop: local service design

## Goal

Run LifeOS as an offline-first local service with desktop and command-line clients. Both clients use the same database, domain operations and validation. The desktop receives committed changes over a persistent connection while open. The CLI must work when the desktop window is closed.

## Existing app and Solid 2

The app currently ships as a Vite SPA inside Tauri, with domain operations in `src/local/api.ts` and SQLite accessed through the Tauri SQL plugin. The transaction wrapper holds a Rust SQLite connection while TypeScript mutation code runs. This works in a WebView, but it cannot be called directly by a standalone server or CLI. Sharing only the SQLite file would duplicate validation and mutation behavior.

The installed Solid 2 RC18 includes `live()` server functions and async iterable subscriptions. The installed Vite plugin can compile server functions and exposes `virtual:solid-server-function-handler` for a production host. Enabling them requires a server build and request handler; the existing SPA configuration does not provide either. `live()` supplies a long-lived read with reconnect behavior, not database transactions, process management, local authentication or automatic change detection.

## Intended shape

- A single local service owns domain operations, SQLite migration and transactions. Move the existing rules to a shared server-side core; use the same core from every command, rather than reimplementing them in the CLI.
- The desktop client connects to the local service and consumes a live snapshot or change stream using Solid 2's async primitives. On reconnect, obtain a fresh authoritative snapshot before applying subsequent changes; mutations and live updates must not expose partial transactions.
- The CLI talks to the same service for reads and writes, starts or discovers it when the window is closed, and has usable `--help`, errors, exit codes, and JSON output.
- Keep the database at the existing Windows app-config path, preserve SQLx migration records and applied checksums, and protect existing data during the migration from the Tauri SQL plugin. Test migration from a copy of a real existing schema, never against personal data.
- Keep the service on the local machine. Define a per-user authenticated connection and origin policy, protect discovery credentials, prevent competing service instances, and handle stale discovery information, startup races and incompatible versions.
- Include the server and CLI in installer and updater artifacts, and make process shutdown, recovery and uninstall behavior explicit. No developer runtime should be required on the installed machine.

## Verification gates

1. Existing database opens unchanged; first-run and concurrent startup apply migrations exactly once.
2. A CLI write appears in an already open desktop without a focus change or manual refresh; desktop writes are visible to the CLI.
3. A dropped connection or service restart reconnects and resynchronizes without missing or duplicating state; active clients receive meaningful errors on incompatible versions.
4. Concurrent writes and injected failures preserve the same transactional invariants as the existing app.
5. Build and exercise the installed Windows app and CLI, including upgrade and data preservation; separately document anything not tested on another machine.
