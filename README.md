# LifeOS — development branch

LifeOS is a personal, local-first desktop app for capturing what is on your mind and organizing the parts of life that matter to you. The desktop app and CLI use the same local service and SQLite database; an account or cloud connection is not required.

This branch contains the newer local-service and CLI work. It is under active development: the service, CLI, and installer have had focused local testing, but the complete desktop-to-CLI flow, upgrades, and installation on a second machine still need verification. [`main`](../../tree/main) has the earlier desktop-only version.

## What is here

- An inbox for quick capture, with areas and workspaces for organizing items.
- Tasks, notes, events, expenses, income, item families, tags, calendars, Today, and Upcoming.
- Search across item titles, descriptions, types, tags, and area names.
- Archive and restore, plus confirmation before permanent deletion.
- A local CLI and desktop app backed by the same SQLite data and mutation logic.
- A Windows MSI build and a local signed-update workflow.

## How it fits together

The desktop is a Tauri v2 window with a Solid 2 interface. A local service serves the app and handles shared domain operations and SQLite transactions. The desktop subscribes to state through Solid server functions using `live()`, so a CLI write can reach an open window. The service listens on loopback and uses a per-session token for its API.

The `lifeos` executable acts as both CLI and service launcher. It starts or discovers the service as needed, including when the desktop window is closed. Data remains on the machine; the local server is not a cloud dependency. See [CLI architecture](docs/CLI-ARCHITECTURE.md) for the design and outstanding verification work.

## Prerequisites

For Windows development and MSI builds, install:

- Node.js 22.12 or newer and pnpm (the project pins pnpm 12.4.1).
- Rust/Cargo and the Windows prerequisites in the [Tauri setup guide](https://v2.tauri.app/start/prerequisites/).
- [Bun](https://bun.com/) to compile the service executable.
- [uv](https://docs.astral.sh/uv/) for the Python utility scripts and local update server.

## Run the desktop app

```powershell
pnpm install --frozen-lockfile
node scripts/build-service.mjs
pnpm tauri dev
```

Build the service first: the Tauri development app starts the executable from `src-tauri/binaries` and serves the built client from `dist/client`. Run the build script again after changing client or service code. `pnpm dev` alone starts Vite; it is not the complete desktop-and-service setup.

## Use the CLI

An MSI built from this branch is configured to include `lifeos.exe`. Run it from its installation directory, or add that directory to your user `PATH`:

```powershell
lifeos help
lifeos workspaces
lifeos areas
lifeos list
lifeos capture "Call the dentist"
lifeos search "dentist"
lifeos done ITEM_ID
lifeos archive ITEM_ID
lifeos restore ITEM_ID
lifeos --workspace WORKSPACE_ID --json list
lifeos stop
```

Commands use the active workspace by default. `--json` produces machine-readable output; errors go to stderr with a nonzero exit code. `capture` creates an unsorted inbox item; `done` applies to an item already typed as a task. `stop` stops the local service; it will be started again when needed. The installed CLI and service should come from the same build.

## Data and migrations

On Windows, the database is `%APPDATA%\dev.a5in.lifeos\lifeos.db`. The desktop and CLI share this file. Migrations are in [`src-tauri/migrations`](src-tauri/migrations); applied migrations are immutable, so add a new migration for schema changes.

```powershell
uv run --no-project scripts/inspect_db.py
```

Back up data you want to keep before migration or uninstall experiments. `scripts/reset-db.py` deletes the database; do not run it unless you intend to discard the local data, and stop the app and service first.

## Build a Windows MSI

```powershell
pnpm build:msi
```

The MSI is written under `src-tauri/target/release/bundle/msi/`. The build compiles and bundles the local service and client assets. The testing MSI does not require the Tauri updater key and is unsigned unless Windows code signing is separately configured. See [Windows testing](docs/WINDOWS-TESTING.md) for WebView2, installation, and update limitations.

## Checks

```powershell
pnpm typecheck
node scripts/build-service.mjs
bun scripts/test_server_storage.mjs
node scripts/test_search.mjs
node scripts/test_live_server.mjs
```

The storage and live-service checks use isolated test data. `scripts/test_desktop_cli.mjs` exercises the desktop and CLI using a separate test app identifier; it requires Windows, WebView2, and the compiled service. A prior run confirmed CLI-to-desktop updates, but desktop-to-CLI capture and packaged installation still need a fresh end-to-end check.

## Local updates

The updater checks `http://127.0.0.1:8123/latest.json` on the same machine. Publishing requires the updater signing key outside the repository:

```powershell
node scripts/publish-update.mjs --version 0.1.2 --notes "What changed"
pnpm update:serve
```

This is a local test pipeline, not a hosted release service. See [Updates](docs/UPDATES.md) for the signing and serving workflow.

## Project notes

- [Milestones](plan.md) and [build journey](journey.md).
- [CLI architecture](docs/CLI-ARCHITECTURE.md).
- [Windows testing](docs/WINDOWS-TESTING.md) and [local updates](docs/UPDATES.md).
