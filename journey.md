# LifeOS — Build Journey

A local-first desktop app I'm building for myself. One place for my life data, running on my machine, not in someone's cloud.

---

## The Goal

- **LifeOS** is my personal dream project.
- Local-first, offline by default. My data stays on my disk.
- Desktop native, not a browser tab. Tray, autostart, updates, files, database.
- Built in public, one small milestone at a time.

_Detailed product vision: coming in a later entry._

## Why This Stack

- **Tauri v2** — real native shell, small binary, offline-first. Rejected Electron (too heavy), PWA (no real native access), Capacitor (mobile-first).
- **Solid 2 RC** — fine-grained reactivity, no virtual DOM. Fewer moving parts than React for a state-heavy app.
- **Vite 8 + TypeScript 7** — fast dev server, strict types.
- **pnpm** — stable, predictable lockfile.
- **SQLite** — single local file as the source of truth. No server, no sync, no login.
- Rule: **exact version pins**, no floating ranges on prerelease packages.

## Milestones

**Day 1 — Foundation (Oct 27, 2026)**
- Chose the stack and locked every version.
- Scaffolded the Tauri + Solid 2 project, no template magic.
- Got a window to open with a working dev build.

**Day 2 — Local database (Oct 27, 2026)**
- Wired SQLite through the official Tauri SQL plugin.
- First migration creates the `todos` table; the DB file lives in app config, offline by default.
- First real feature: add, complete, and delete todos, persisted on disk.

**Next up**
- Tray icon + autostart.
- Auto-updater.
- `.msi` installer.

## What Broke (and How I Fixed It)

- **First build failed: `icons/icon.ico not found`.** Tauri needs a Windows icon resource even when the icon list is empty. Fixed by generating a 1024px icon and running the Tauri icon generator.
- **Solid 2 needs the new Vite plugin.** The old `vite-plugin-solid` is Solid 1 only. Switched to `@solidjs/vite-plugin` 3.x.
- **Prerelease version mismatch.** `@solidjs/diagnostics` `latest` tag was stale (rc.2), while Solid itself was on rc.18. Had to install from the `next` tag to keep versions aligned.
- **Ecosystem lag is real.** TanStack's Solid adapters still target Solid 1, so they were dropped for v1. Only the few packages that actually support Solid 2 made the cut.
- **Solid 2 removed `createResource`.** Async now lives in computations: an async memo read inside a `<Loading>` boundary, refreshed by bumping a revision signal.

## What I'm Learning

- Prerelease ecosystems reward patience: check tags, not just `latest`.
- Native builds fail on assets, not logic. Icons, manifests, and config bite first.
- Boring local storage beats clever cloud sync when the goal is owning your data.
- Small, committed milestones make the journey easy to tell.

## Ground Rules I'm Keeping

- Local-first or nothing. No feature ships that needs a server.
- Pin versions. Upgrade deliberately, not by accident.
- No library before the problem exists.
- Ship a working window before shipping features.
