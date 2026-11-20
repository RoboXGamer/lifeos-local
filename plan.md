# LifeOS: next milestones

Updated: 2026-10-29. Status: first local implementations of all seven milestones are built on dev. Checked tasks below describe implemented behavior; unchecked tasks are follow-up scope.

The previous plan is complete per the project owner and is replaced by this roadmap. The existing Solid 2 interface, Tauri desktop shell, local service, CLI, SQLite database, and shared mutation boundary are the starting point.

**Product direction:** LifeOS remembers what happened, turns commitments into actions, handles repeat work, and helps choose what deserves attention next.

## Build order and first release

Build milestones 1-3 for daily usefulness, then 4-5 for project intelligence, then 6 for client obligations. Milestone 7 connects the results to the existing Today experience.

The first implementation includes reusable templates, durable recurring tasks, three automation recipes, manual project checkpoints, read-only repository intelligence, a reviewed obligations ledger, and evidence-based Today suggestions. The engines are deterministic and local; model providers and automatic editor/browser instrumentation remain follow-up work.

## 1. Templates: repeat a useful structure

**Outcome:** Start a project, client engagement, or life routine without rebuilding its checklist and notes.

- [x] Save an item family as a template, including child tasks/notes, tags, descriptions, and relative due dates.
- [ ] Add area-level templates after item-family templates.
- [x] Add variables such as client, project name, amount, and start date. Preview the generated items and destination before applying.
- [x] Create fresh item IDs in one transaction. Keep generated items independent; editing a template never silently changes earlier instances.
- [x] Include starter templates: weekly review, project kickoff, project restart, client onboarding, client delivery/payment follow-up, and college assignment.
- [x] Record the template version used by each instance. Add template editing, duplication, and local JSON import/export without including private instance data.

**Done when:** A client-onboarding template creates its complete task/note family with correctly substituted variables and dates; cancel or failure creates nothing.

## 2. Recurring tasks: remember the next occurrence

**Outcome:** Weekly reviews, bills, backups, maintenance, and follow-ups reliably return when needed.

- [x] Support daily, selected weekdays, weekly, monthly, and every-N-day schedules. Offer both calendar-based repetition and repetition after completion.
- [x] Separate the recurring definition from individual occurrences; retain completion history and allow skip, snooze, pause, and end dates.
- [x] Persist schedules in the local service with timezone, month-end behavior, and an explicit missed-occurrence policy. Default to one outstanding occurrence rather than a flood after a long absence.
- [x] Use a unique occurrence key so restart, retry, or simultaneous desktop/CLI activity cannot generate duplicates. Recover due work after sleep and service restart.
- [x] Run scheduling while the desktop window is closed if the service is running. Add optional startup integration; show that powered-off time is caught up on resume.
- [x] Repeated financial reminders create Planned/Expected entries only; they never mark money as Spent/Received automatically.

**Done when:** A weekly task returns correctly after completion and after a missed week, with preserved history and no duplicates across restart.

## 3. Automations: trigger, condition, action

**Outcome:** Routine coordination happens through small, understandable rules.

- [x] Reuse milestone 2's durable scheduler and add triggers for item creation, status changes, due dates, and inactivity.
- [x] Start with three recipes: a Friday weekly-review checklist; a delivery completion that creates a payment follow-up; an inactive project that prompts a checkpoint/review.
- [x] Add a lightweight desktop/CLI checkpoint saved as a child Note on an item family: what changed, what failed, and the next action. Use tagged item families for the inactivity recipe until milestone 4 adds richer project metadata.
- [x] Support conditions for workspace, area, type, tags, and status; actions create an item, apply a template, update allowed fields, or show an in-app reminder.
- [x] Give each rule a plain-language explanation, preview, enable/pause switch, and run history showing inputs, actions, results, and errors.
- [x] Persist jobs and retries, deduplicate internal effects, and prevent self-triggering loops. Write through the same domain API as desktop and CLI.
- [x] Keep sending messages, arbitrary shell commands, and external payments outside the first release. Later external actions need their own explicit configuration and failure handling.

**Done when:** The three recipes work across service restart; retry cannot duplicate created items, and a user can explain why each automation ran.

## 4. Context Resurrection: return after 45 days

**Outcome:** Opening a project shows the last goal, changes, failures, decisions, and exact next step, with evidence.

- [x] Add project metadata linked to an existing item family and workspace. Support multiple repositories per project; an area remains a broader life category.
- [x] Extend the desktop/CLI checkpoint with why I stopped, timestamps, and relevant branch/commit references; preserve the notes collected during the first release.
- [x] Build one shared source/activity store with source IDs, timestamps, project links, content hashes, and links back to original evidence. Preserve source revisions and flag missing or stale evidence.
- [x] Collect Git commits, branches, working-tree summaries, and explicitly selected project notes, terminal outcomes, editor notes, and browser links.
- [ ] Add automatic editor integration and opt-in browser/terminal capture adapters.
- [x] Make capture opt-in by project/source, with exclusions, retention, deletion, and secret filtering. Terminal/browser collection must not become unrestricted history recording.
- [x] Generate a resume brief: last goal; last known working state; failed attempts; unresolved blocker; next action; suggested files and commands. Separate observed facts from inferred suggestions, and never label an untested command as proven.
- [x] Keep checkpoints and source search usable without AI; imported text remains evidence rather than executable instructions.
- [ ] Configure optional local-model/cloud analysis providers.

**Done when:** Reopening a seeded 45-day-old project yields a useful brief with source links; a project with no recorded history says what is unknown instead of inventing a past.

## 5. Project Graveyard Intelligence: revive, salvage, or archive

**Outcome:** An abandoned repository gets a reasoned recommendation and the smallest credible path to shipping.

- [x] Scan user-selected repository roots read-only, including README, manifests, lockfiles, Git state, tests, TODOs, and existing checkpoints. Reuse milestone 4's source store and project identity.
- [x] Produce three sections: reusable assets; obsolete or uncertain parts; minimum shipping scope with blockers. Account for uncommitted work and dependencies between repositories.
- [x] Mark offline dependency freshness and build/deployment verification unknown; repository age alone never proves obsolescence.
- [ ] Add explicit online upstream dependency/support checks.
- [x] Separate product value from technical readiness: ask who needs it, what outcome matters, and whether the original goal still holds. Offer revive, salvage selected parts, or archive recommendations with evidence and confidence.
- [x] Estimate remaining work as ranges with assumptions and a proposed timebox. Clearly distinguish static inspection from an actually verified build/test/deployment; running repository scripts is a separate user-initiated step.
- [x] On acceptance, turn the smallest shipping path into ordinary LifeOS tasks. Never automatically delete repositories, upgrade dependencies, or restart every old project.

**Acceptance scenario:** Three real abandoned repositories each receive a traceable recommendation, a reuse inventory, and an actionable shipping checklist; one is chosen for a timeboxed revival. Automated fixtures verify report generation and accepted-plan deduplication; a real three-repository revival trial remains pending.

## 6. Promise-to-Payment: connect commitments to evidence

**Outcome:** A client engagement shows what was promised, what changed, what is due, what was invoiced, and what was actually received.

- [x] Start with pasted conversations, imported text/PDF documents, and manually recorded or imported payments. Add email/chat integrations after the manual workflow is useful.
- [x] Store clients/engagements, versioned source documents, obligations, invoices, payments, and payment allocations linked to existing tasks and Income/Expense items. Record currency and use exact monetary arithmetic for reconciliation.
- [x] Extract draft obligations with parties, deliverable, amount/currency, due date, conditions, status, confidence, and exact source passage/page. Require review before creating accepted financial obligations.
- [x] Track proposed changes, accepted amendments, cancellation, and supersession. Flag competing terms rather than assuming the newest document is authoritative.
- [x] Detect amount, currency, scope, deadline, and payment-term conflicts. Reconcile deposits, partial payments, refunds, and outstanding balances without double-counting imported records; missing evidence remains unknown.
- [x] Show a commitment timeline and exception queue; turn reviewed obligations and discrepancies into deduplicated ordinary follow-up tasks.
- [ ] Add assisted follow-up message drafting and optional communication integrations.

**Done when:** A quotation, conflicting contract term, accepted amendment, invoice, and partial payment produce the correct outstanding balance and a source-linked explanation of the unresolved discrepancy.

## 7. Bring intelligence into Today

**Outcome:** The app makes a small number of useful recommendations grounded in the records above.

- [x] **Waiting On radar:** Surface waiting replies, approvals, deliverables, and payments with source notes and dated follow-up tasks. The last item edit is clearly distinguished from a contact timestamp.
- [ ] Add structured contact history and separate last-contact timestamps.
- [x] **Decision memory:** Surface why a project was paused or an approach rejected, and what would justify revisiting it. Build this into project context.
- [x] **One shippable thing:** Suggest the smallest useful outcome that fits today's available time and current blockers. Let the user choose; do not auto-resurrect every promising project.
- [x] **Life-maintenance radar:** Use maintenance tags, starter templates, and recurrence for renewals, subscriptions, backups, and document deadlines; Today uses a 14-day lookahead.
- [ ] Make maintenance alert lead times configurable.
- [x] Add a compact review section to Today with at most three prioritized suggestions and a reason for each. Allow dismiss, snooze, and correction; prevent duplicate alerts across features.

**Done when:** A weekly review answers what needs attention, what is waiting on someone else, and what can realistically ship next, with every recommendation traceable to local records.

## 8. Habits and progress as core LifeOS records

**Outcome:** One activity connects what was planned, what actually happened, and the goal it moved.

- [x] Create habits and measurable goals in an Area, with flexible weekly habit targets and timezone-aware daily check-ins.
- [x] Record a single activity from Today, a linked Task, or the CLI; update the associated habit and linked goals from that same record without completing the Task implicitly.
- [x] Support counts, durations and numeric values, with explicit additive versus absolute measurements; prevent duplicate records and incompatible units.
- [x] Preserve activity history and historical targets when definitions change. Corrections, voids, skipped/rest days, pauses, and unlogged days must remain distinguishable.
- [x] Offer daily and weekly progress, source-linked history, task/goal drill-down, and Today check-ins. Share the local service, transactional writes, workspace isolation and live updates with other LifeOS features.

**Done when:** Logging 35 minutes on a Rust practice Task meets a 30-minute habit target and adds exactly 35 minutes to its linked goal; correcting or voiding that same entry updates both views consistently.

## Integration rules

- Keep the current stack. Desktop and CLI call the existing local service; scheduling, ingestion, analysis jobs, and all writes belong there rather than in UI timers or a second backend.
- Keep existing tasks, notes, events, income, expenses, tags, areas, and item families as the actionable records. Add dedicated metadata/tables for schedules, templates, project sources, and financial reconciliation as their milestones require them.
- Apply new immutable migrations, preserve existing workspace isolation, and retain transactional writes and live desktop updates. Scope imports, rules, sources, and generated tasks to their owning workspace.
- Share the project/source pipeline between Context Resurrection and Graveyard Intelligence; reuse its provenance model for Promise-to-Payment. Avoid separate AI memory systems for each feature.
- Start source retrieval with simple local search; evaluate [SQLite FTS5](https://www.sqlite.org/fts5.html) when source volume warrants it. A vector database is not a prerequisite.
- Keep local capture, recurrence, rules, and accepted records functional offline. AI enriches evidence; it must not manufacture history, payment status, or completed work. Show source freshness and analysis/model provenance.
- Preserve the existing navigation: templates in creation flows, recurrence in the item inspector, automations in workspace settings, project intelligence on project views, and actionable exceptions in Today.
- Verify each milestone with its stated scenario, relevant domain tests, and desktop/CLI behavior before marking it complete. This document is a plan, not evidence that the new features have shipped.

## Explicitly later

Local verification passes: typecheck, all twelve isolated domain suites, production client/service build, authenticated live updates, compiled CLI workflows/background scheduling/restart, and native desktop capture in both directions plus six productivity pages. The habit-to-goal activity scenario is covered by domain and compiled-service tests; desktop verification covers navigation and rendering. Tests use temporary data. Packaged upgrade/installation, second-machine behavior, Windows sign-in, and real-repository revival trials remain separate acceptance work.

A public template marketplace, universal app/activity recording, a general visual workflow builder, autonomous external messaging/payments, and automatic repository rewrites are outside these initial milestones. Add integrations only when a real daily workflow requires them.
