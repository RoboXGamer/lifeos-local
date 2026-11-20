# LifeOS Local

LifeOS is a personal, local-first desktop app for capturing what is on your mind and organizing the parts of life that matter to you. The desktop app and CLI use the same local service and SQLite database; an account or cloud connection is not required.

## What is here

- An inbox for quick capture, with areas and workspaces for organizing items.
- Tasks, notes, events, expenses, income, item families, tags, calendars, Today, and Upcoming.
- Search across item titles, descriptions, types, tags, and area names.
- Archive and restore, plus confirmation before permanent deletion.
- A local CLI and desktop app backed by the same SQLite data and mutation logic.
- A Windows setup package containing the desktop, client assets, and local service.
- Reusable templates, recurring tasks/financial reminders, and durable automation rules.
- Project checkpoints, source snapshots, resume briefs, and read-only repository revival reviews.
- Reviewed client obligations, conflicting terms, invoices, partial payments/refunds, and evidence-based Today suggestions.

See [Productivity and local intelligence](docs/PRODUCTIVITY.md) for the new flows, CLI commands, and first-version limits.

## How it fits together

The Zig desktop shell uses Electrobun and system WebView2. It starts or discovers the Bun service, then opens the Solid 2 interface at the authenticated loopback URL. The service handles shared domain operations and SQLite transactions. The UI consumes the service's `live()` snapshot stream through a Solid async memo, so CLI writes appear in an open window. Solid Primitives handles responsive layout, event listeners, and the shared clock on Today.

The `lifeos` executable acts as both CLI and service launcher. It starts or discovers the service as needed, including when the desktop window is closed. Data remains on the machine; the local server is not a cloud dependency. See [CLI architecture](docs/CLI-ARCHITECTURE.md) for the design and outstanding verification work.

## Prerequisites

For Windows development and packaging, install:

- Node.js 22.12 or newer and pnpm (the project pins pnpm 12.4.1).
- Hutch on `PATH` and the Windows WebView2 runtime. Hutch resolves the Electrobun and Zig versions pinned by the project.
- [Bun](https://bun.com/) to compile the service executable.
- [uv](https://docs.astral.sh/uv/) for the Python utility scripts.

## Run the desktop app

```powershell
pnpm install --frozen-lockfile
pnpm dev:desktop
```

The command builds the service and desktop shell, then opens the UI with Vite live reload. It shares the installed app's local data by default. Set `LIFEOS_DEV_DATA_DIR` before launch to develop against an isolated profile. A running service is reused. To load backend changes, close the app, run `lifeos stop` for the relevant data directory, then restart development.

## Use the CLI

The Windows package includes `lifeos.exe` under `Resources/app/lifeos-service` in the installed app directory. Run it from that folder, or add the folder to your user `PATH`.

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

On Windows, the database is `%APPDATA%\dev.a5in.lifeos\lifeos.db`. The desktop and CLI share this file. Migrations are in [`server/migrations`](server/migrations). Add a new file for schema changes so applied migrations retain their checksums.

```powershell
uv run --no-project scripts/inspect_db.py
```

Back up data you want to keep before migration or uninstall experiments. `scripts/reset-db.py` deletes the database; do not run it unless you intend to discard the local data, and stop the app and service first.

## Build and run Windows Setup

```powershell
pnpm package
```

Run `build/stable-win-x64/LifeOS-Setup.exe` with its neighboring `.installer` folder. To move Setup, extract all of `artifacts/win-x64-LifeOS-Setup.zip` and run the EXE from the extracted folder. For a portable run, extract `artifacts/stable-win-x64-LifeOS.tar.zst` and open `LifeOS/bin/launcher.exe` inside the extracted bundle.

Close the old desktop and stop its local service before switching builds so the newly packaged service supplies the client assets.

## Checks

```powershell
pnpm typecheck
pnpm test:productivity
node scripts/build-service.mjs
bun scripts/test_server_storage.mjs
node scripts/test_search.mjs
node scripts/test_live_server.mjs
node scripts/test_productivity_service.mjs
node scripts/test_habits_service.mjs
pnpm package
pnpm test:desktop
```

The storage, live-service, and desktop checks use isolated data. The desktop smoke test launches the extracted package and exercises capture in both directions with the CLI, plus navigation through the productivity pages.

## In-app updates

Electrobun 2.0.7 provides the updater for the Zig desktop shell. Set the update host and version when packaging a release.

```powershell
$env:LIFEOS_RELEASE_URL = "https://downloads.example.com/lifeos"
$env:LIFEOS_RELEASE_VERSION = "0.1.1"
pnpm package
```

Upload `stable-win-x64-update.json`, `stable-win-x64-checksum.json`, the compressed app archive, and any generated patches to that directory. The Setup ZIP is for the initial install. Keep the app identifier and channel consistent across releases.

In the installed app, open **More → Check for updates**, download the update, and save your work before choosing **Restart to update**. The Zig shell hands the staged update to Electrobun, stops the local service, and exits. The updated app opens the same SQLite database on restart.

The update menu is available in packaged builds with a configured feed. For local testing, use a loopback HTTP feed and build with `hutch electrobun build --env=canary` after `node scripts/build-service.mjs`. Install the older canary, then serve the artifacts for the newer canary at the configured URL. Test with a disposable Windows profile or a disposable database at the default path. The Windows updater relaunch uses the normal user environment, so a session-only `LIFEOS_DATA_DIR` override can be lost on restart.

Publisher-signature enforcement equivalent to the old Tauri updater, MSI distribution, and second-machine testing remain open.

## Project notes

- [Milestones](plan.md) and [build journey](journey.md).
- [CLI architecture](docs/CLI-ARCHITECTURE.md).
- [Previous Tauri Windows testing](docs/WINDOWS-TESTING.md) and [update workflow](docs/UPDATES.md).
