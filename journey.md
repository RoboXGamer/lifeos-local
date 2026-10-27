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

**Day 3 — Update pipeline (Oct 27, 2026)**
- Signed update artifacts enabled in the bundle.
- In-app check → download → install → relaunch, with a silent startup check.
- No release host yet, so the flow is wired but not yet exercised end to end.

**Day 4 — The port (Oct 27, 2026)**
- Brought the real LifeOS interface over and deleted the cloud layer outright: no server, no login, no sync.
- One SQLite file now backs a single reactive store: reads are memos, writes go to disk and reload the store.
- Swapped TanStack Router for Solid Router, so the whole stack is Solid-native again.
- Next: walk the real flow on desktop — capture, areas, item families, today, archive and restore.

**Day 5 — Updates that actually ship (Oct 27, 2026)**
- Dropped the placeholder host: the manifest is served from this machine on `127.0.0.1:8123`.
- One command builds the NSIS installer, signs it, and writes `latest.json`; another serves the folder.
- Ran the real loop: 0.1.0 found 0.1.1 in the sidebar, downloaded it, verified the signature, installed, and relaunched as 0.1.1.
- The repo stays at 0.1.0 on purpose, so the update stays testable without bumping anything.

**Next up**
- Walk the real product flow end to end on desktop: capture → areas → item families → today → archive/restore.
- Tray icon + autostart, plus the system-wide capture hotkey.
- Package a signed `.msi` next to the NSIS installer.
- Backup/export, so one SQLite file is never a single point of failure.
- Then the redesign pass on the new product vision.

## What Broke (and How I Fixed It)

- **First build failed: `icons/icon.ico not found`.** Tauri needs a Windows icon resource even when the icon list is empty. Fixed by generating a 1024px icon and running the Tauri icon generator.
- **Ecosystem lag is real.** TanStack's Solid adapters still target Solid 1, so they were dropped for v1. Only the few packages that actually support Solid 2 made the cut.
- **Editing a migration that already ran blocks startup.** SQLx stores a checksum per migration, so the app refused to boot: *"migration 1 was previously applied but has been modified"*. Fix was resetting the dev DB — and the new rule is: applied migrations are immutable, changes go in a new file.
- **The bundler could not download NSIS, but curl could.** Tauri's tool download kept failing with `timeout: global` while the same zip downloaded fine by hand. Fixed by pre-seeding `%LOCALAPPDATA%\tauri\NSIS` with the hashed toolset, so the bundler verifies it and skips the network entirely.
- **The Windows updater artifact is the installer, not a zip.** The publisher expected a `.nsis.zip` from v1 habits; v2 signs the `.exe` itself. One line of artifact matching fixed it.
- **A blank window was a stale dev cache.** An old Vite server held port 1420, so `tauri dev` never started and an older app instance answered instead. Killing the leftovers and clearing `node_modules/.vite` brought the real UI back.

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
