# Habits and progress

Habits describe repeatable intentions, goals describe measurable outcomes, and activities record what actually happened. A single activity can connect an existing task to a habit and its compatible goals without automatically completing the task. All records belong to a LifeOS workspace and use the shared local service and database.

Open **Habits** to create a habit and a measurable goal. For example, create a Rust-practice goal of 600 minutes and a habit targeting 30 minutes on four days each week. Link the habit to that goal, then record 35 minutes against a related task. The habit records one qualifying day and the goal gains 35 minutes once.

Each log records its date, value, unit, source links, optional note, and whether the value is an increment or an absolute reading. A habit linked to a goal uses increments; absolute readings are available directly on a goal, so a daily habit value cannot accidentally reset the goal's cumulative total. Corrections and voids preserve the record's history and recalculate progress; repeating the same explicitly supplied activity ID is idempotent. Rest and skipped days can be recorded separately from completed work. A day without a check-in is unlogged, rather than automatically claimed as either success or failure.

Use Today for a quick check-in, or open the habits page for history and goals. A goal and its linked activities must use compatible units; minutes cannot silently be added to a pages goal. Updating a target applies a new version; past recorded activity keeps its historical context.

## CLI

```text
lifeos --json habits
lifeos --json goals
lifeos --json habit-show HABIT_ID 2026-07-15
lifeos --json goal-show GOAL_ID
lifeos habit-log HABIT_ID 35 2026-07-15 TASK_ID GOAL_ID
```

For a habit with a saved goal link, `lifeos habit-log HABIT_ID 35 2026-07-15` applies the entry to its active linked goals whose date range includes that day. Use the general `lifeos query` and `lifeos run` commands with the `habits`, `goals`, or `activity` namespaces for goal creation, corrections, explicit activity IDs, additional goal links, and standalone goal readings. See `lifeos help` for syntax.

`pnpm test:productivity` runs the isolated habit/progress regression suite alongside the existing checks. Tests use temporary databases, never the user's existing data.
