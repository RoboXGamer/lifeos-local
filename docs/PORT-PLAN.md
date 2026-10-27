# Port plan — web LifeOS → local-first Tauri app

Source of truth for the product/UX: `C:\Users\A5IN\Coding\projects\lifeos` (Solid 2 beta.29 + Convex + Better Auth).
Target: this repo (Tauri v2 + Solid 2 rc.18 + SQLite, no server).

Rule: **UI is copied, not rewritten.** Only the data/auth layer is replaced.

## As built (final)

The plan below was the pre-port sketch; the shipped shape is smaller and more Solid-native.

- **One reactive store, not per-query SQL reads.** `src/local/store.ts` holds
  `{ profile, workspaces, areas, items, tags, itemTags }` in a Solid store,
  hydrated from SQLite in one pass (`reload()`), with rows reconciled by `_id`.
  `items` already carry their resolved `tags`.
- **Reads are synchronous memos.** `createQuery(fn, args, { initialValue })`
  (`src/local/query.ts`) is a 5-line memo over that store; the ~35 call sites
  kept their original shape, only import paths changed. Nothing suspends, so
  `<Loading>` boundaries simply render.
- **Writes are SQL + reload.** Each `api.*` mutation validates (copied
  `validation.ts`), writes through `@tauri-apps/plugin-sql`, then `reload()`.
  `expectedUpdatedAt` is accepted and ignored — one local writer.
- **Router is Solid Router v2** (`@solidjs/router@2.0.0-next.42`), not TanStack:
  route config objects, plain `<a href>` links, `useParams`/`useSearchParams`.
  The `?item=&mode=` inspector contract is unchanged.
- **Provider** boots the DB, creates the local profile + "My Life" workspace on
  first launch, and gates rendering on `ready` (`src/local/provider.tsx`).
- **Search** is an in-memory case-insensitive title match (FTS5 later).

## Original plan (kept for context)

## Keep / replace / delete

| Web code | Fate |
| --- | --- |
| `src/pages/*`, `src/features/*`, `src/*.css`, `src/Icon.tsx`, `src/Avatar.tsx`, `src/schemas.ts` | **copy as-is**, then fix call sites + rc.18 APIs |
| `src/router.tsx` | keep, minus `/` landing and `/app/login` |
| `convex/schema.ts` | → SQLite migration (done: `src-tauri/migrations/0002_lifeos.sql`) |
| `convex/{items,areas,tags,workspaces,profiles}.ts` | → `src/local/*.ts` typed SQL |
| `convex/lib/validation.ts` | copy verbatim → `src/local/validation.ts` (pure TS) |
| `src/convex/*` (adapter) | **delete** — replaced by Solid 2 native primitives |
| `src/auth/*`, `src/data/convex.ts` | delete |
| `src/LandingPage.*`, `public/screenshots`, `robots.txt` | delete (not a desktop surface) |
| `convex/` (Better Auth, waitlist, seed, generated) | delete |
| `src/updates.ts` | keep — needs a UI home (see Phase 7) |

## Phase 1 — Data layer (`src/local/`)

- `db.ts` — one `Database.load("sqlite:lifeos.db")`, `revision` signal + `bump()`, row mappers
  (SQLite `NULL` → `undefined`, `0/1` → boolean, inject `_id`/`_creationTime`).
- `validation.ts` — verbatim copy.
- `ids.ts` — `newId()` (nanoid), `now()`.
- Domain modules, one function per former Convex function, same args, same return shapes:

| Module | Functions |
| --- | --- |
| `profile.ts` | `ensureProfile()` (single profile + "My Life" workspace + 7 default tags), `current()` |
| `workspaces.ts` | `list`, `listArchived`, `create`, `rename`, `select`, `setArchived`, `removalImpact`, `remove` |
| `areas.ts` | `list`, `listArchived`, `get`, `create`, `update`, `setArchived`, `removalImpact`, `remove` |
| `items.ts` | `list`, `listArchived`, `listByArea`, `listToday`, `listUpcoming`, `listAreaRange`, `search`, `get`, `quickCapture`, `create`, `update`, `setTaskDone`, `setArchived`, `removalImpact`, `remove` |
| `tags.ts` | `list`, `listWithCounts`, `rename`, `remove` |

Shared internals: `itemWithTags()`, `visibleAreaIds()`, `family()`, `itemCapacity()`, `defaultTags`.

Deliberately dropped: `requireProfile`/`requireWorkspaceOwner` (single local user),
`expectedUpdatedAt` stale-write rejection (single writer), 500-item / 100-area caps
(harmless locally, but they add error paths the UI must handle — keep the 12-tags
and 5,000-char limits since the UI surfaces those messages).

## Phase 2 — Query/mutation primitives

```ts
// read: async memo + revision tracking + <Loading>
const items = createMemo(async () => {
  revision();
  return itemsApi.list({ workspaceId: wsId() });
});

// write: pending + auto invalidation
const save = useMutation(itemsApi.update); // signal-based `pending`, bumps revision on success
```

- `query.ts`: `useQuery(run)` (5 lines), `useRevision()`.
- `mutation.ts`: `useMutation(fn)` → `{ run, pending }`.
- Existing optimistic UI keeps working: `createOptimisticStore` seeded from the memo,
  `action(function* ...)` mutating the draft before the SQL write.
- No refs, no registry, no `"skip"` sentinel.

## Phase 3 — Provider

`src/local/provider.tsx` replaces `src/auth/context.tsx`:

- on start: wait for DB, run `ensureProfile()`, expose `ready` / `error` / `retry`
- same fallback UI ("Preparing your Life OS")
- `ProfileContext` supplies `current()` for `WorkspaceMenu`
- `src/index.tsx`: `ConvexProvider` → `LocalProvider`

## Phase 4 — Router + shell

- routes: `/app/areas`, `/app/areas/$areaId`, `/app/areas/$areaId/calendar`,
  `/app/today`, `/app/upcoming`, `/app/tags`, `/app/archive`, `/app/search`
- `/` → redirect `/app/areas`; drop `/app/login`
- `?item=&mode=` inspector contract untouched
- `App.tsx`: swap `AuthProvider`, drop the "Log in" entry from `WorkspaceMenu`

## Phase 5 — Call-site migration (~35 sites)

`features/items/context.tsx` (largest), `features/workspaces/context.tsx`, then
`pages/{Today,Areas,AreaDetail,AreaCalendar,Tags,Archive,Search}.tsx`.

Pattern per site:

```diff
- const items = createQuery(api.items.list, () => ({ workspaceId: workspaceId() }));
+ const items = createMemo(async () => itemsApi.list({ workspaceId: workspaceId() }));
```

Mutations lose `expectedUpdatedAt` (it comes from the optimistic store today).

## Phase 6 — Solid beta.29 → rc.18

Awaiting the reference diff (`C:\Users\A5IN\Coding\reference\upstream-reference\solid2`).
Known items: two-arg `createEffect`, `createOptimisticStore`/`action` changes,
`<For>`/`<Show>` accessor semantics, `onSettled` lifecycle, `ref={fn}`,
`class={[...]}` arrays, `Portalled` → `Portal`, diagnostics errors
(`STRICT_READ_UNTRACKED`, owned writes).

## Phase 7 — Desktop specifics

- updater card: move to `WorkspaceMenu` footer or a small `/app/settings` route
- asset URLs: `/sprite.svg#id` → import-based (Tauri asset protocol is not root-relative)
- `#area-inspector-host` portal target: keep, but create the host from the shell instead of the page
- window: title LifeOS, min size ~900×600
- Ctrl+Space capture + Ctrl+K search stay in-app; OS-global hotkey later with tray

## Phase 8 — Verify

1. `pnpm typecheck`, `cargo check`
2. `pnpm tauri dev` → bootstrap → workspace switch → area create → item capture/edit/complete → today → archive/restore → delete confirmations
3. `scripts/inspect_db.py` to confirm rows land in SQLite
4. Restart app → data persists

## Open decisions

- Search: `LIKE '%q%'` (simple, fine →10k rows) vs SQLite FTS5.
- Keep `Workspaces` UI as-is (multi-workspace), single local profile.
- Any import path from the old web app (Convex export → JSON → local), or start empty?
