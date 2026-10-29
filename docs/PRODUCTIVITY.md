# Productivity and local intelligence

These are the first local implementations of the seven milestones in [the plan](../plan.md). They use the existing local service and SQLite database. Repository reports and suggestions use recorded evidence and deterministic rules; no AI provider or external account is required.

## Templates

Open **Templates**, choose a starter or saved template, fill its variables, choose a start date/destination, and review the live preview. **Create these items** creates an ordinary parent and child items atomically. Later template edits do not change created items.

On a top-level item's details, **Save family as template** captures its child items and due-date offsets. Templates can be duplicated, edited through the structure editor, and imported/exported as local JSON. Saved versions are recorded with each application. Starters cover weekly review, kickoff, restart, onboarding, delivery/payment, college assignments, renewals, and backup/restore checks. Area-level templates remain future scope.

## Recurring items

Open an active Task, Expense, or Income and expand **Repeat this item**. Choose daily, selected weekdays, weekly, monthly, or every-N-day repetition, calendar/completion mode, timezone, and optional end date. Monthly calendar repetition keeps the original day when a short month is followed by a longer one.

Occurrences have independent completion history. A long absence creates at most one outstanding occurrence, rather than every missed copy. Use pause, resume, end, skip, or snooze; **Recurring** shows the history and any creation error. Financial copies start Planned/Expected, never automatically Spent/Received.

The scheduler lives in the service and checks approximately every 30 seconds. Closing the window leaves an already running service available. If the service or computer is stopped, due work resumes when the service starts. The Workspace menu offers optional Windows sign-in startup in compiled builds; changing this setting is always explicit. Actual Windows sign-in behavior still needs a live sign-in test.

## Automations and checkpoints

Open **Automations** and add a recipe: Friday weekly review, delivery-to-payment follow-up, or inactive-project checkpoint. New recipes are paused. Preview with a sample item, save, then enable.

Rules support schedule, creation, task-status, due-date, and inactivity triggers; workspace/area/type/tag/status conditions; and item, template, allowed-field update, or in-app reminder actions. Run history explains what ran, why, and any retry/error. Internal action writes do not recursively trigger rules. Jobs survive restart, deduplicate effects, and roll back failed actions before retrying.

Creation rules also receive user-applied template items, recurring occurrences, checkpoints, accepted revival tasks, obligation follow-ups, and manually confirmed payment items. Each creation/status event has a durable identity and internal origin/source ID, recorded in the same transaction as the item and queued runs. Template instances and recurring occurrence keys keep their existing identity rules: retrying a failed transaction creates nothing twice; applying a template again intentionally creates a fresh family. Automation-created items/templates and automation status updates retain their run ID and do not cascade into other event rules. Automation-created items are also excluded from due-date/inactivity scans to prevent chains on later ticks; a later explicit user status change can trigger a status rule.

Top-level items also have **Save a checkpoint**. Record what changed, what failed, and the next action. It becomes a child Note that richer project memory can reuse.

## Context Resurrection and Graveyard Intelligence

Open **Projects**, register an existing top-level item family, and specify the smallest useful outcome, intended audience, value, and selected absolute repository paths. A project can include several repositories. Settings include exclusions and snapshot retention.

**Scan selected repos** captures bounded Git status/history, file inventories, manifests, README/lockfile evidence, and TODO excerpts. It never executes project scripts, tests, deployments, hooks, or remote fetches. Credential filters reduce accidental capture; only select repositories and content you intend to retain. Add selected browser links, editor notes, and terminal outcomes manually.

The resume brief shows recorded work, failed attempts, stopping reason, Git reference, and next action. With no checkpoint, it labels its next step as a suggestion. Source snapshots retain hashes, revisions, missing/stale indicators, and deletion controls. A snapshot describes capture time, not a continuously monitored current state.

Resume, revival planning, and Today's decision memory select the same latest checkpoint, whether it is a structured project checkpoint or a quick child Note. Selection uses creation time, then structured checkpoints before quick notes on equal timestamps, then descending immutable ID within each kind. Source identity is retained; an older stopping reason is not combined with a newer note's next action. Historical notes remain intact. A note without a parsed next action produces a suggested next step rather than claiming one was recorded.

The revival review separates reusable assets, uncertain parts, product value, static readiness, and a proposed shipping path. Accepting a reviewed plan creates deduplicated tasks. Dependency support remains unknown until an explicit upstream check is added; static inspection does not prove that a build or deployment works. Real three-repository revival trials remain pending.

Automatic editor/browser/terminal adapters, online dependency-support lookup, and optional model providers are follow-up scope.

## Promise to payment

Open **Promise to payment** and create a client engagement. Paste conversations or import text/text PDFs. Source revisions and exact passages remain available. Scanned PDFs need pasted text; extraction currently uses explicit currency amounts and ISO dates, with missing terms left unknown.

Extraction creates drafts. Review responsible party, amount/currency, dates, scope, and conditions before accepting. An accepted amendment can replace earlier accepted terms; a newer source alone does not supersede an agreement. Potential conflicts and invoice/accepted-term differences appear in **Needs review**.

New obligation follow-ups retain a baseline of the generated task. Editing accepted terms updates its title and terms excerpt only while those fields still match that baseline; a changed obligation deadline updates a still-managed task date. The initial follow-up date remains as chosen until the obligation deadline changes. Manual field edits are preserved independently, with divergence shown in **Needs review**. Completed, in-progress, archived, or retyped tasks are preserved for manual review. Older follow-ups without a baseline have unknown ownership and are never silently adopted. Reviewed before/after terms are retained in an audit history; retries of an identical review add no duplicate review or task.

Cancelling or superseding a commitment archives its untouched generated follow-up with an audit reason. Customized tasks, completed work, and tasks with child history remain available in ordinary lists and history; obsolete commitment follow-ups are excluded from Today/Upcoming recommendations. Supersession retains the old link and requires an explicit **Create follow-up** for the replacement, with its own deduplicated task. Reaccepting cancelled terms does not reopen archived work automatically. These transitions never rewrite confirmed payments, invoices, or payment allocations. Full terms remain in the ledger when the task excerpt must be shortened.

Record invoices separately from confirmed payments. Unique transaction references prevent duplicate imports. Match receipts to invoices, including partial payments; record refunds against their original receipt and allocation. The ledger uses integer minor units and keeps currencies separate. Linked ordinary financial items appear in LifeOS; changing or deleting one raises a reconciliation exception rather than silently rewriting the ledger.

Accepted obligations and review issues can create deduplicated follow-up tasks. Importing a quotation or invoice never claims that a payment happened. Communication connectors, assisted message drafting, bank synchronization, and automated sending are future scope.

## Today

**Worth your attention** shows up to three suggestions with reasons and source links: waiting work, client payment exceptions, recorded decisions/blockers, maintenance dates, or one bounded shipping task. Enter available time and a real task estimate to make a time-fit suggestion; the app does not invent durations or infer that an unrecorded blocker is absent in reality.

Dismiss, snooze, annotate a correction, and reset saved preferences. New source evidence can resurface an issue. Suggestions deduplicate linked follow-up items. Maintenance currently uses a 14-day lookahead; structured contact history and configurable maintenance lead times remain future scope.

## CLI

The CLI exposes the same records and operations as the desktop. Run `lifeos help` for signatures. `--json` returns complete data.

```text
lifeos --json templates
lifeos template-preview starter:weekly 2026-10-29
lifeos template-apply starter:weekly 2026-10-29
lifeos --json recurring
lifeos --json automations
lifeos --json projects
lifeos --json obligations
lifeos --json attention
lifeos checkpoint ITEM_ID "Finished setup" "Dependency failed" "Review dependency and retry"
lifeos project-scan PROJECT_ID
lifeos project-resume PROJECT_ID
lifeos project-report PROJECT_ID
```

`lifeos query QUERY_NAME [ARGS_JSON]` and `lifeos run OPERATION_NAME ARGS_JSON` expose the feature APIs without duplicating business logic. Both inject the selected workspace; mutation names are restricted to feature namespaces. Examples include `automations.recipes`, `automations.runs`, `projects.sources`, `obligations.details`, `recurrence.save`, and `attention.feedback`. Scheduler test clocks and startup filesystem paths are not remote parameters.

## Verification

The productivity runner includes eleven isolated domain/integration suites. The cross-feature suite exercises templates and recurrence through automation rules, automation action suppression, quick/structured checkpoint parity, accepted obligation amendment/cancellation/supersession, customized/completed task preservation, injected late failures, retries, workspace isolation, and restart persistence. Migration checks cover both the original schema and pre-integration follow-ups with unknown ownership.

The existing local acceptance checks cover typecheck, the bundled service build, authenticated live updates, the compiled CLI/background-service/restart scenario, and native desktop capture in both directions plus all six productivity pages. Packaged installation/upgrade, another machine, real sign-in startup, and a three-real-repository revival trial remain separate acceptance work. Passing these scenarios does not establish universal cross-feature synchronization.

```text
pnpm typecheck
pnpm test:productivity
node scripts/build-service.mjs
node scripts/test_live_server.mjs
node scripts/test_productivity_service.mjs
node scripts/test_desktop_cli.mjs
```

The domain suite uses isolated temporary databases and includes rollback, duplicate/retry protection, workspace isolation, migration from the original schema, full workspace cleanup, and restart persistence. The compiled-service check exercises all seven feature areas without a desktop window. Desktop checks use a separate test app identifier. No test enables real sign-in startup or modifies the user's production database.
