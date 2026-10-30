import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStorage } from '../server/storage.mjs';
import { installStorageAdapter } from '../src/local/db.ts';
import { api, ensureProfile, runProductivityTasks } from '../src/local/api.ts';
import { data } from '../src/local/store.ts';
import { readMigrations } from './test-helpers.mjs';

// Every run uses a new, isolated database; no production data is touched.
const path = join(mkdtempSync(join(tmpdir(), 'lifeos-habits-')), 'lifeos.db');
const storage = openStorage(path, readMigrations());
installStorageAdapter(storage);
await ensureProfile();
const workspaceId = data.profile.activeWorkspaceId;
const date = '2026-07-15'; // Wednesday; Monday-start week also contains July 13.
const goalId = await api.goals.save({ workspaceId, title: 'Rust practice this year', unit: 'minutes', target: 600, startDate: '2026-01-01', endDate: '2026-12-31' });
const habitId = await api.habits.save({ workspaceId, title: 'Rust practice', unit: 'minutes', dailyTarget: 30, daysPerWeek: 4, timezone: 'Asia/Kolkata', goalIds: [goalId] });
const itemId = await api.items.create({ workspaceId, title: 'Ownership exercise', type: 'Task', status: 'Todo', areaId: null, parentId: null, priority: null, dueDate: null, amount: null, financialState: null, description: null, tags: [] });

// One session is the single source of truth for habit + goal + task association.
const log = { workspaceId, activityId: 'session-audit-unique', habitId, itemId, value: 35, mode: 'increment', date, note: 'Worked through ownership exercises' };
const activityId = await api.activity.log(log);
assert.equal(await api.activity.log(log), activityId, 'Retry with same activity ID is idempotent');
await assert.rejects(api.activity.log({ ...log, value: 36 }), /different record|already/i, 'A reused ID must not silently replace another session');
let habit = api.habits.details({ workspaceId, habitId, date });
assert.equal(habit.todayValue, 35); assert.equal(habit.todayMet, true); assert.equal(habit.weekDaysMet, 1); assert.equal(habit.weekTarget, 4);
let goal = api.goals.details({ workspaceId, goalId });
assert.equal(goal.current, 35, 'One session increments goal only once');
assert.equal(data.items.find(item => item._id === itemId).status, 'Todo', 'Logging effort must not complete a task');
assert.equal(storage.db.prepare('SELECT COUNT(*) n FROM activityEntries WHERE _id=?').get(activityId).n, 1);
assert.equal(storage.db.prepare('SELECT COUNT(*) n FROM activityGoalLinks WHERE activityId=? AND goalId=?').get(activityId, goalId).n, 1);

// Different days count once per day, not once per session, for a flexible four-day week.
await api.activity.log({ workspaceId, activityId: 'session-monday-1', habitId, value: 15, mode: 'increment', date: '2026-07-13' });
await api.activity.log({ workspaceId, activityId: 'session-monday-2', habitId, value: 20, mode: 'increment', date: '2026-07-13' });
habit = api.habits.details({ workspaceId, habitId, date });
assert.equal(habit.weekDaysMet, 2); assert.equal(habit.weekTarget, 4);
assert.equal(api.goals.details({ workspaceId, goalId }).current, 70);

// Editing and voiding changes all derived views while retaining an auditable record.
await api.activity.edit({ workspaceId, activityId, value: 20, date, note: 'Corrected duration' });
habit = api.habits.details({ workspaceId, habitId, date });
assert.equal(habit.todayValue, 20); assert.equal(habit.todayMet, false); assert.equal(habit.weekDaysMet, 1);
assert.equal(api.goals.details({ workspaceId, goalId }).current, 55);
await api.activity.void({ workspaceId, activityId });
assert.equal(api.habits.details({ workspaceId, habitId, date }).todayValue, 0);
assert.equal(api.goals.details({ workspaceId, goalId }).current, 35);
assert.equal(storage.db.prepare('SELECT voided FROM activityEntries WHERE _id=?').get(activityId).voided, 1);
assert(storage.db.prepare('SELECT COUNT(*) n FROM activityRevisions WHERE activityId=?').get(activityId).n >= 2);

// Changing a target today cannot retroactively change an earlier recorded day.
await api.habits.save({ workspaceId, habitId, title: 'Rust practice', unit: 'minutes', dailyTarget: 60, daysPerWeek: 2, timezone: 'Asia/Kolkata', goalIds: [goalId] });
const historical = api.habits.details({ workspaceId, habitId, date: '2026-07-13' });
assert.equal(historical.todayTarget, 30); assert.equal(historical.todayMet, true); assert.equal(historical.weekTarget, 4);
await api.goals.save({ workspaceId, goalId, title: 'Rust practice this year', unit: 'minutes', target: 900, startDate: '2026-01-01', endDate: '2026-12-31' });
assert.equal(api.goals.details({ workspaceId, goalId }).goal.target, 900);
assert.equal(api.goals.details({ workspaceId, goalId, asOfDate: '2026-07-13' }).goal.target, 600, 'Historical goal view keeps its former target');

// Incremental quantities and absolute meter readings must not be summed blindly.
const pagesGoal = await api.goals.save({ workspaceId, title: 'Read a book', unit: 'pages', target: 200, startDate: '2026-01-01', endDate: '2026-12-31' });
await api.activity.log({ workspaceId, activityId: 'pages-increment-1', goalIds: [pagesGoal], unit: 'pages', value: 20, mode: 'increment', date: '2026-07-13' });
await api.activity.log({ workspaceId, activityId: 'pages-absolute', goalIds: [pagesGoal], unit: 'pages', value: 120, mode: 'absolute', date: '2026-07-14' });
await api.activity.log({ workspaceId, activityId: 'pages-increment-2', goalIds: [pagesGoal], unit: 'pages', value: 5, mode: 'increment', date: '2026-07-15' });
assert.equal(api.goals.details({ workspaceId, goalId: pagesGoal }).current, 125);
await api.activity.log({ workspaceId, activityId: 'zz-same-day-absolute', goalIds: [pagesGoal], unit: 'pages', value: 140, mode: 'absolute', date: '2026-07-16' });
await api.activity.log({ workspaceId, activityId: 'aa-same-day-increment', goalIds: [pagesGoal], unit: 'pages', value: 5, mode: 'increment', date: '2026-07-16' });
assert.equal(api.goals.details({ workspaceId, goalId: pagesGoal }).current, 145, 'Same-day readings preserve write order even when IDs sort differently');
await assert.rejects(api.activity.log({ workspaceId, habitId, goalIds: [pagesGoal], value: 15, mode: 'increment', date }), /same unit/i);

// A daily absolute habit reading must not silently reset the entire linked goal.
const beforeAbsolute = api.goals.details({ workspaceId, goalId }).current;
try {
  await api.activity.log({ workspaceId, activityId: 'habit-absolute-check', habitId, value: 10, mode: 'absolute', date });
  assert.equal(api.goals.details({ workspaceId, goalId }).current, beforeAbsolute + 10);
  await api.activity.void({ workspaceId, activityId: 'habit-absolute-check' });
} catch (error) {
  if (error instanceof assert.AssertionError) throw error;
  assert.match(error.message, /absolute|linked|goal/i);
  assert.equal(api.goals.details({ workspaceId, goalId }).current, beforeAbsolute);
}

// Rest/skip is explicit rather than an invented completion.
await api.habits.mark({ workspaceId, habitId, date, status: 'rest' });
assert.equal(api.habits.details({ workspaceId, habitId, date }).todayStatus, 'rest');
assert.equal(api.habits.details({ workspaceId, habitId, date }).todayMet, false);
await api.habits.mark({ workspaceId, habitId, date, status: 'clear' });
assert.notEqual(api.habits.details({ workspaceId, habitId, date }).todayStatus, 'rest');

const other = await api.workspaces.create({ name: 'Different workspace' });
await assert.rejects(api.activity.log({ workspaceId: other, habitId, value: 10, mode: 'increment', date }), /not found|workspace/i);
await assert.rejects(api.activity.edit({ workspaceId: other, activityId, value: 1, date }), /not found|workspace/i);
assert.throws(() => api.goals.details({ workspaceId: other, goalId }), /not found|workspace/i);

// Target crossings enqueue durable, workspace-scoped automation jobs only once.
const triggeredGoal = await api.goals.save({ workspaceId, title: 'Two sessions', unit: 'times', target: 2, startDate: '2026-01-01', endDate: '2026-12-31' });
const triggeredHabit = await api.habits.save({ workspaceId, title: 'Practice daily', unit: 'times', dailyTarget: 1, daysPerWeek: 4, timezone: 'UTC', goalIds: [triggeredGoal] });
const rule = (name, kind, entityId) => ({ name, trigger: { kind, entityId, timezone: 'UTC' }, action: { kind: 'reminder', title: `${name}: {{title}}` } });
const habitRule = await api.automations.save({ workspaceId, enabled: true, definition: rule('Habit reached', 'habit_target_met', null) });
const goalRule = await api.automations.save({ workspaceId, enabled: true, definition: rule('Goal reached', 'goal_target_reached', triggeredGoal) });
const itemRule = await api.automations.save({ workspaceId, enabled: true, definition: rule('Item created', 'item_created', null) });
const otherRule = await api.automations.save({ workspaceId: other, enabled: true, definition: rule('Other workspace', 'habit_target_met', null) });
const event1 = { workspaceId, activityId: 'trigger-first', habitId: triggeredHabit, value: 1, mode: 'increment', date, itemId };
const event2 = { workspaceId, activityId: 'trigger-second', habitId: triggeredHabit, value: 1, mode: 'increment', date, itemId };
await api.activity.log(event1);
assert.equal(data.automationRuns.filter(r => r.automationId === habitRule).length, 1, 'The first crossing queues the habit rule');
assert.equal(data.automationRuns.filter(r => r.automationId === goalRule).length, 0, 'Partial progress cannot queue goal completion');
await api.activity.log(event2); await api.activity.log(event2);
assert.equal(data.automationRuns.filter(r => r.automationId === habitRule).length, 1, 'Additional logs and retries do not queue a second habit rule');
assert.equal(data.automationRuns.filter(r => r.automationId === goalRule).length, 1, 'Goal crossing queues exactly one rule');
assert.equal(data.automationRuns.filter(r => r.automationId === otherRule).length, 0, 'Progress events stay in their workspace');
await runProductivityTasks();
assert.equal(data.automationRuns.filter(r => [habitRule, goalRule].includes(r.automationId) && r.status === 'completed').length, 2);
assert.equal(data.automationRuns.filter(r => r.automationId === itemRule).length, 0, 'Automation-generated reminders do not cause self-triggering item rules');
await api.activity.edit({ workspaceId, activityId: event1.activityId, value: 0.2, date });
await api.activity.void({ workspaceId, activityId: event2.activityId });
assert.equal(data.automationRuns.filter(r => [habitRule, goalRule].includes(r.automationId)).length, 2, 'Corrections and voids do not trigger celebrations');
await api.activity.log({ workspaceId, activityId: 'trigger-recross', habitId: triggeredHabit, value: 1.8, mode: 'increment', date });
assert.equal(data.automationRuns.filter(r => r.automationId === habitRule).length, 1, 'Re-crossing the same habit/day stays deduplicated');
assert.equal(data.automationRuns.filter(r => r.automationId === goalRule).length, 1, 'Re-crossing the same goal/target stays deduplicated');

// An automation-queue failure rolls back the newly recorded activity as well.
const rollbackHabit = await api.habits.save({ workspaceId, title: 'Rollback habit', unit: 'times', dailyTarget: 1, daysPerWeek: 1, timezone: 'UTC' });
storage.db.exec("CREATE TRIGGER fail_progress_enqueue BEFORE INSERT ON automationRuns BEGIN SELECT RAISE(ABORT,'injected progress queue failure'); END");
await assert.rejects(api.activity.log({ workspaceId, activityId: 'failed-progress-event', habitId: rollbackHabit, value: 1, mode: 'increment', date }), /injected progress queue failure/);
storage.db.exec('DROP TRIGGER fail_progress_enqueue');
assert.equal(storage.db.prepare('SELECT COUNT(*) n FROM activityEntries WHERE _id=?').get('failed-progress-event').n, 0);
assert.equal(api.habits.details({ workspaceId, habitId: rollbackHabit, date }).todayValue, 0);
await api.activity.log({ workspaceId, activityId: 'failed-progress-event', habitId: rollbackHabit, value: 1, mode: 'increment', date });
assert.equal(api.habits.details({ workspaceId, habitId: rollbackHabit, date }).todayMet, true);

// A mid-write database error must leave neither activity nor derived goal links.
const before = storage.db.prepare('SELECT COUNT(*) n FROM activityEntries').get().n;
storage.db.exec("CREATE TRIGGER fail_activity_goal BEFORE INSERT ON activityGoalLinks BEGIN SELECT RAISE(ABORT,'injected activity link failure'); END");
await assert.rejects(api.activity.log({ workspaceId, activityId: 'failed-session', habitId, value: 45, mode: 'increment', date }), /injected activity link failure/);
storage.db.exec('DROP TRIGGER fail_activity_goal');
assert.equal(storage.db.prepare('SELECT COUNT(*) n FROM activityEntries').get().n, before, 'Activity and goal links roll back together');
assert.equal(api.goals.details({ workspaceId, goalId }).current, 35);

storage.db.close();
const reopened = openStorage(path, readMigrations());
assert.equal(reopened.db.prepare('SELECT COUNT(*) n FROM activityEntries WHERE workspaceId=?').get(workspaceId).n, before);
assert.equal(reopened.db.prepare('SELECT COUNT(*) n FROM activityRevisions WHERE activityId=?').get(activityId).n >= 2, true);
reopened.db.close();
console.log('Habits: linked activity and task, flexible weekly targets, idempotency, edits/undo, explicit rest, workspace isolation, transactional rollback and restart passed');
