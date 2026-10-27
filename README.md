**Plan:** pnpm + Tauri v2 + Solid 2 RC (rc.18) + Vite 8.3.5 + TS 7.0.2 — SQLite local (`tauri-plugin-sql`), koi TanStack nahi.

**Order:** scaffold → window + SQLite CRUD → tray/autostart → updater → `.msi` build.

**Dev notes**

- Migrations: `src-tauri/migrations/`. Applied migrations are immutable — a change goes in a new file (`0002_*.sql`).
- Reset the local DB after a schema change in dev: `uv run --no-project scripts/reset-db.py` (stop `pnpm tauri dev` first).
- DB file: `%APPDATA%\dev.a5in.tauri-solid-draft1\lifeos.db`.
- Inspect it: `uv run --no-project scripts/inspect_db.py`.
- Permissions: `sql:default` grants only load/select/close — writes need `sql:allow-execute` in `capabilities/default.json`.
