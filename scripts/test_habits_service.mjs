import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Run only after `node scripts/build-service.mjs`; the separate directory keeps
// the compiled service and its SQLite profile isolated from the real app.
const dataDir = mkdtempSync(join(tmpdir(), 'lifeos-habits-service-'));
const exe = resolve('dist/desktop-service/lifeos.exe');
const env = { ...process.env, LIFEOS_DATA_DIR: dataDir, LIFEOS_CLIENT_DIR: resolve('dist/client'), LIFEOS_DISABLE_SCHEDULER: '1' };
function cli(...args) {
  const result = spawnSync(exe, ['--json', ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}
const run = (name, args) => cli('run', name, JSON.stringify(args));
try {
  const goalId = run('goals.save', { title: 'Rust practice', unit: 'minutes', target: 600, startDate: '2026-01-01', endDate: '2026-12-31' });
  const habitId = run('habits.save', { title: 'Practice Rust', unit: 'minutes', dailyTarget: 30, daysPerWeek: 4, timezone: 'Asia/Kolkata', goalIds: [goalId] });
  const itemId = cli('capture', 'Ownership exercise');
  const activityId = cli('habit-log', habitId, '35', '2026-07-15', itemId);
  assert.equal(typeof activityId, 'string');
  const habit = cli('habit-show', habitId, '2026-07-15');
  assert.equal(habit.todayValue, 35); assert.equal(habit.todayMet, true); assert.equal(habit.weekDaysMet, 1); assert.equal(habit.weekTarget, 4);
  assert.equal(cli('goal-show', goalId).current, 35);
  assert(cli('habits').some(h => h._id === habitId)); assert(cli('goals').some(g => g._id === goalId));
  const payload = { activityId: 'cli-idempotent-session', habitId, value: 10, mode: 'increment', date: '2026-07-15' };
  assert.equal(run('activity.log', payload), 'cli-idempotent-session');
  assert.equal(run('activity.log', payload), 'cli-idempotent-session');
  assert.equal(cli('goal-show', goalId).current, 45);
  const stopped = spawnSync(exe, ['stop'], { env, encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(stopped.status, 0, stopped.stderr);
  assert.equal(cli('goal-show', goalId).current, 45, 'Goal survives compiled service restart');
  assert.equal(cli('habit-show', habitId, '2026-07-15').todayValue, 45);
  console.log('Compiled CLI/service: habit, goal, one linked task session, idempotent retry and restart persistence passed');
} finally {
  spawnSync(exe, ['stop'], { env, encoding: 'utf8', windowsHide: true, timeout: 10000 });
}
