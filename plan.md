# LifeOS milestones

These milestones are ordered: make local writes reliable, make search match its promise, then package the app for testing on other Windows machines.

## 1. Harden multi-step writes

**Goal:** Adopt Convex's transactional mutation model for the local SQLite app. A mutation's reads, validation, and writes form one isolated unit: either all its changes commit, or none do. Convex calls these **transactions**; the relevant properties are **atomicity** and **isolation**. Convex also uses optimistic concurrency control for its transactional guarantees, but we do not need to reproduce its distributed implementation to get a reliable local mutation boundary. See [Convex's mutation API](https://docs.convex.dev/api/modules/server) and [transaction documentation](https://docs.convex.dev/components/using#transactions).

### Verified approach

The installed `tauri-plugin-sql` 2.6.0 uses a SQLx connection pool and executes individual statements through that pool. The frontend's `Database` object therefore does not guarantee that separate calls use the same physical connection. Implement the mutation boundary in Rust with a held SQLite connection and transaction; keep the existing database file and migrations. Move each mutation's state-dependent validation and writes into that boundary, while preserving the UI-facing API and local-first behavior. Coordinate commits and store refreshes so overlapping local operations cannot publish stale snapshots. SQLite locking protects database writes across processes; refreshing another running instance's in-memory store requires explicit coordination and must be addressed or the app must enforce a single instance.

### Work

- [ ] Audit every local mutation and bootstrap operation for dependent reads and multiple writes, including item creation and editing with tags, family moves and archive/restore, item/area/workspace deletion, workspace selection, and first-run setup.
- [ ] Implement a transaction boundary that keeps all database reads and writes for a mutation on the same SQLite connection and commits or rolls back as a unit. Verify the Tauri SQL plugin's connection behavior first; a sequence of separate frontend `execute` calls must not be assumed to share a transaction. If necessary, put transactional operations behind Rust commands with an explicitly held connection.
- [ ] Make validation that depends on current data run against the transaction's authoritative database state. Define how concurrent mutations are serialized or otherwise isolated, including writes initiated from multiple windows or app instances.
- [ ] Publish or reload the reactive store only after a successful commit. On failure, roll back, surface the error, and reconcile any optimistic UI state with the persisted data. Handle a successful commit followed by a failed refresh without claiming the database write was rolled back or blindly retrying it.
- [ ] Keep applied migrations immutable; use a new migration for any schema changes.

### Done when

- [ ] Successful mutations persist their full result after restart; invalid operations leave the database unchanged.
- [ ] Failure-injection tests interrupt tag replacement, a family operation, and a multi-table deletion after at least one write and prove that no partial changes remain.
- [ ] Concurrent mutation tests exercise the chosen isolation strategy and check that data and the visible store converge to the committed state.
- [ ] The desktop flow works for capture, edit, family operations, archive/restore, and deletion, including error handling.

## 2. Fix search expectations

**Goal:** Make search find what the interface promises: titles, notes/descriptions, item types, tags, and area names.

**Current finding:** Both search interfaces already perform enriched matching locally, but `api.items.search` matches only titles. The search page combines both paths, while the panel uses its own filter. Consolidate the matching rules and verify actual behavior before treating any particular field as broken.

### Work

- [ ] Implement case-insensitive matching across the promised fields in the local search path. Keep it local and start with the existing in-memory store; add an index only if measured performance warrants one.
- [ ] Preserve workspace isolation, visibility and archive rules, and result limits. Define and consistently apply behavior for empty input and matching multiple fields.
- [ ] Check both the search page and search panel, and update their copy if any supported behavior differs.

### Done when

- [ ] Tests cover a match in each advertised field, case differences, empty and missing values, archived items/areas, and workspace isolation.
- [ ] The desktop UI returns the expected results and opens the selected item.

## 3. Build an MSI for testing on other machines

**Goal:** Produce a Windows installer that can be copied to another machine and used to test LifeOS as a standalone app.

**Current finding:** This Windows machine has Rust, Cargo, pnpm, and the existing Tauri updater key. The current release script builds NSIS only; no MSI or cached WiX toolset was found in the inspected bundle/tool directories. A successful MSI build, its prerequisites, and testing on another machine remain to be verified. Availability of a separate Windows code-signing certificate has not been established.

### Work

- [ ] Build an MSI on Windows using Tauri's WiX bundler, document the exact command, prerequisites, artifact location, app version, and target architecture. See [Tauri's Windows installer guide](https://v2.tauri.app/distribute/windows-installer/).
- [ ] Decide and document the WebView2 installation mode: the default bootstrapper may need internet if the runtime is missing; the offline installer increases package size but supports offline setup.
- [ ] Distinguish the updater's artifact signature from Windows Authenticode signing. Document the installer signing status and any Windows warnings testers may encounter; do not assume the existing updater key signs the MSI for Windows.
- [ ] Document that the existing update endpoint points to each machine's own `127.0.0.1`: installing on another machine does not give it remote updates. Remote update distribution is a separate decision.
- [ ] Document install, launch, upgrade/reinstall, and uninstall steps, including where the app stores its SQLite database and what happens to that data on uninstall. Never package the developer's existing database or signing key.

### Done when

- [ ] The MSI installs and launches on a second Windows machine without the development toolchain.
- [ ] A tester creates data, exits and reopens the installed app, and confirms persistence; basic capture, search, and archive/restore work.
- [ ] Reinstall or upgrade and uninstall behavior are tested and documented, including whether existing data is preserved. Any untested behavior is explicitly noted.
