import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { openStorage } from '../server/storage.mjs';
import { installStorageAdapter } from '../src/local/db.ts';
import { api, ensureProfile, tickRecurring } from '../src/local/api.ts';
import { data, reload } from '../src/local/store.ts';
import { nextRecurrenceDate, zonedDate } from '../src/local/recurrence.ts';
import { readMigrations } from './test-helpers.mjs';

const directory = mkdtempSync(join(tmpdir(), 'lifeos-recurrence-test-'));
const path = join(directory, 'lifeos.db');
const storage = openStorage(path, readMigrations());
installStorageAdapter(storage);
await ensureProfile();
const workspaceId = data.profile.activeWorkspaceId;
const input = (title, type = 'Task') => ({ workspaceId, title, type, status: type === 'Task' ? 'Todo' : null, areaId: null, parentId: null, tags: ['recurring'], description: null, dueDate: null, priority: null, amount: type === 'Task' ? null : 500, financialState: type === 'Expense' ? 'Spent' : type === 'Income' ? 'Received' : null });
const definition = (overrides = {}) => ({ frequency: 'weekly', interval: 1, weekdays: [], mode: 'calendar', startDate: '2030-01-01', endDate: null, timezone: 'Asia/Kolkata', ...overrides });
const count = scheduleId => storage.db.prepare('SELECT COUNT(*) AS count FROM recurrenceOccurrences WHERE scheduleId=?').get(scheduleId).count;
const pending = scheduleId => storage.db.prepare("SELECT * FROM recurrenceOccurrences WHERE scheduleId=? AND state='pending'").get(scheduleId);
const schedule = scheduleId => storage.db.prepare('SELECT * FROM recurrenceSchedules WHERE _id=?').get(scheduleId);
const complete = itemId => storage.db.prepare("UPDATE items SET status='Done' WHERE _id=?").run(itemId);
const time = date => Date.parse(date + 'T12:00:00Z');

// Month-end retains the 31st after February; timezone dates follow the chosen zone.
const monthly = definition({ frequency: 'monthly', startDate: '2030-01-31' });
assert.equal(nextRecurrenceDate(monthly, '2030-01-31'), '2030-02-28');
assert.equal(nextRecurrenceDate(monthly, '2030-02-28'), '2030-03-31');
assert.equal(zonedDate(Date.parse('2030-01-01T20:00:00Z'), 'Asia/Kolkata'), '2030-01-02');
assert.equal(nextRecurrenceDate(definition({ frequency: 'weekdays', weekdays: [1, 3] }), '2030-01-02'), '2030-01-07');

// A missed month does not flood the inbox, and simultaneous/retried ticks cannot duplicate it.
const seed = await api.items.create(input('Weekly review'));
const weeklyId = await api.recurrence.save({ workspaceId, itemId: seed, definition: definition() });
assert.equal(count(weeklyId), 1);
await tickRecurring(time('2030-02-15'));
assert.equal(count(weeklyId), 1, 'unfinished seed must remain the only outstanding occurrence');
complete(seed);
await Promise.all([tickRecurring(time('2030-02-15')), tickRecurring(time('2030-02-15'))]);
assert.equal(count(weeklyId), 2);
assert.equal(pending(weeklyId).scheduledDate, '2030-02-12');
await tickRecurring(time('2030-02-15'));
assert.equal(count(weeklyId), 2);
assert.equal(storage.db.prepare('SELECT status FROM items WHERE _id=?').get(pending(weeklyId).itemId).status, 'Todo');

// Pausing catches no work; resuming is explicit. Snoozing never changes the calendar identity.
await api.recurrence.control({ workspaceId, scheduleId: weeklyId, action: 'pause' });
assert.equal(schedule(weeklyId).state, 'paused');
await tickRecurring(time('2030-04-01'));
assert.equal(count(weeklyId), 2);
await api.recurrence.control({ workspaceId, scheduleId: weeklyId, action: 'snooze', date: '2030-04-02' });
assert.equal(storage.db.prepare('SELECT dueDate FROM items WHERE _id=?').get(pending(weeklyId).itemId).dueDate, '2030-04-02');
await api.recurrence.control({ workspaceId, scheduleId: weeklyId, action: 'resume' });
assert.equal(schedule(weeklyId).state, 'active');

// Completion-based schedules count from the completion date and retain finished history.
const cleanSeed = await api.items.create(input('Clean filters'));
const completionId = await api.recurrence.save({ workspaceId, itemId: cleanSeed, definition: definition({ frequency: 'interval', interval: 10, mode: 'completion' }) });
assert.equal(schedule(completionId).nextDate, null);
complete(cleanSeed);
await tickRecurring(time('2030-02-01'));
assert.equal(schedule(completionId).nextDate, '2030-02-11');
await tickRecurring(time('2030-02-10'));
assert.equal(count(completionId), 1);
await tickRecurring(time('2030-02-20'));
assert.equal(count(completionId), 2);
assert.equal(pending(completionId).scheduledDate, '2030-02-11');

// Skip is retained in history and skipping the original item does not stop its schedule.
const skipSeed = await api.items.create(input('Backup'));
const skipId = await api.recurrence.save({ workspaceId, itemId: skipSeed, definition: definition() });
await api.recurrence.control({ workspaceId, scheduleId: skipId, action: 'skip' });
assert.equal(storage.db.prepare('SELECT state FROM recurrenceOccurrences WHERE itemId=?').get(skipSeed).state, 'skipped');
await tickRecurring(time('2030-01-08'));
assert.equal(count(skipId), 2);
assert.equal(schedule(skipId).state, 'active');

// Bills never clone a historical actual payment as another actual payment.
const bill = await api.items.create(input('Internet bill', 'Expense'));
const billId = await api.recurrence.save({ workspaceId, itemId: bill, definition: definition({ startDate: '2030-01-31', frequency: 'monthly' }) });
await tickRecurring(time('2030-01-31'));
assert.equal(storage.db.prepare('SELECT financialState FROM items WHERE _id=?').get(pending(billId).itemId).financialState, 'Planned');

// A failed insertion rolls back the new item but leaves a visible, retryable schedule error.
const failSeed = await api.items.create(input('Failure recovery'));
const failId = await api.recurrence.save({ workspaceId, itemId: failSeed, definition: definition() });
complete(failSeed);
storage.db.exec("CREATE TRIGGER fail_recurrence BEFORE INSERT ON items WHEN NEW.title='Failure recovery' BEGIN SELECT RAISE(ABORT, 'injected recurrence failure'); END");
await tickRecurring(time('2030-01-08'));
assert.match(schedule(failId).lastError, /injected recurrence failure/);
assert.equal(count(failId), 1);
assert.equal(storage.db.prepare("SELECT COUNT(*) AS count FROM items WHERE title='Failure recovery'").get().count, 1);
storage.db.exec('DROP TRIGGER fail_recurrence');
await tickRecurring(time('2030-01-08'));
assert.equal(count(failId), 2);
assert.equal(schedule(failId).lastError, null);

// End dates stop future occurrences; archiving sources pauses generation without losing history.
const endSeed = await api.items.create(input('Short routine'));
const endId = await api.recurrence.save({ workspaceId, itemId: endSeed, definition: definition({ endDate: '2030-01-02' }) });
complete(endSeed); await tickRecurring(time('2030-02-01'));
assert.equal(schedule(endId).state, 'ended'); assert.equal(count(endId), 1);
await api.items.setArchived({ itemId: seed, archived: true });
assert.equal(schedule(weeklyId).state, 'paused');
await assert.rejects(api.recurrence.save({ workspaceId, itemId: cleanSeed, definition: definition({ timezone: 'Invalid/Timezone' }) }), /timezone/);
const other = await api.workspaces.create({ name: 'Other' });
await assert.rejects(api.recurrence.control({ workspaceId: other, scheduleId: completionId, action: 'end' }), /not found/);
await api.workspaces.setArchived({ workspaceId, archived: true });
assert.equal(schedule(completionId).state, 'paused', 'Workspace archive must be seen inside the same mutation, not a later store refresh');
await reload();
assert.equal(api.recurrence.list({ workspaceId: other }).length, 0);
const preserved = storage.db.prepare('SELECT COUNT(*) AS count FROM recurrenceOccurrences').get().count;
storage.db.close();
const reopened = openStorage(path, readMigrations());
assert.equal(reopened.db.prepare('SELECT COUNT(*) AS count FROM recurrenceOccurrences').get().count, preserved);
reopened.db.close();
console.log('Recurrence: calendar, weekdays, month-end, timezone, completion, catch-up, idempotency, controls, financial reset, rollback/retry, isolation and persistence passed');
