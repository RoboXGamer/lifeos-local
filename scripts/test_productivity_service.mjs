import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'lifeos-productivity-service-'));
const exe = resolve('src-tauri/binaries/lifeos-x86_64-pc-windows-msvc.exe');
const env = { ...process.env, LIFEOS_DATA_DIR: dataDir, LIFEOS_CLIENT_DIR: resolve('dist/client'), LIFEOS_SCHEDULER_INTERVAL_MS: '1000' };
function cli(...args) {
  const result = spawnSync(exe, ['--json', ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}
const run = (name, args) => cli('run', name, JSON.stringify(args));
async function call(name, args) {
  const info = JSON.parse(readFileSync(join(dataDir, 'service.json'), 'utf8'));
  const response = await fetch(`http://127.0.0.1:${info.port}/api`, { method: 'POST', headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'mutation', name, args }) });
  const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body.result.result;
}
try {
  const workspaceId = cli('workspaces')[0].id;
  const date = new Date().toLocaleDateString('en-CA');
  const templates = cli('templates'); assert(templates.length >= 6);
  const templateArgs = ['starter:client', date, JSON.stringify({ client: 'Compiled client', amount: '5000' })];
  const preview = cli('template-preview', ...templateArgs); assert.equal(preview.items.length, 4);
  const root = cli('template-apply', ...templateArgs); assert.equal(typeof root, 'string');
  cli('checkpoint', root, 'Finished setup', 'One dependency failed', 'Review dependency and retry');
  const task = await call('items.create', { workspaceId, title: 'Compiled service delivery', areaId: null, type: 'Task', status: 'Todo', priority: 2, dueDate: date, amount: null, financialState: null, description: null, parentId: null, tags: ['delivery'] });
  const scheduleId = cli('repeat', task, JSON.stringify({ frequency: 'weekly', interval: 1, weekdays: [], mode: 'calendar', startDate: date, endDate: null, timezone: 'Asia/Kolkata' }));
  assert(cli('recurring').some(schedule => schedule._id === scheduleId));
  const recipes = cli('query', 'automations.recipes');
  const ruleId = run('automations.save', { definition: recipes.find(rule => rule.trigger.kind === 'status_changed'), enabled: true });
  cli('done', task);
  let runs;
  for (let i = 0; i < 30; i++) { runs = cli('query', 'automations.runs'); if (runs.some(run => run.automationId === ruleId && run.status === 'completed')) break; await new Promise(resolve => setTimeout(resolve, 200)); }
  assert(runs.some(run => run.automationId === ruleId && run.status === 'completed'), 'Background scheduler did not process the queued rule');
  assert(cli('search', 'Follow up on payment').some(item => item.tags.includes('waiting')));
  const repo = join(dataDir, 'selected-repo'); mkdirSync(repo); writeFileSync(join(repo, 'README.md'), '# Fixture\nA small useful product'); writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fixture' }));
  const projectId = run('projects.create', { itemId: root, name: 'Compiled project', goal: 'Ship one useful feature', audience: 'Client', valueStatement: 'Existing code solves a need', status: 'active', settings: { repositories: [repo], exclusions: [], retentionDays: 365 } });
  cli('project-scan', projectId);
  assert.equal(cli('project-resume', projectId).nextAction, 'Review dependency and retry');
  assert(cli('project-report', projectId).reusable.length > 0);
  const engagementId = run('obligations.create', { client: 'Compiled client', name: 'Service test' });
  const invoiceId = run('obligations.addInvoice', { engagementId, reference: 'COMP-1', amount: '5000', currency: 'INR', dueDate: date });
  run('obligations.recordPayment', { engagementId, reference: 'COMP-PAY', amount: '1000', currency: 'INR', date, invoiceId });
  assert.equal(cli('query', 'obligations.details', JSON.stringify({ engagementId })).invoices[0].outstandingMinor, 400000);
  assert(cli('attention').suggestions.length <= 3);
  const stopped = spawnSync(exe, ['stop'], { env, encoding: 'utf8', windowsHide: true }); assert.equal(stopped.status, 0, stopped.stderr);
  assert(cli('recurring').some(schedule => schedule._id === scheduleId), 'Schedule not persisted across service restart');
  assert(cli('projects').some(project => project._id === projectId));
  assert.equal(cli('query', 'obligations.details', JSON.stringify({ engagementId })).invoices[0].outstandingMinor, 400000);
  console.log('Compiled CLI/service: templates, checkpoints, recurrence, background automation, repository resume/revival, payment balance, Today and restart persistence passed');
} finally { spawnSync(exe, ['stop'], { env, encoding: 'utf8', windowsHide: true, timeout: 10000 }); }
