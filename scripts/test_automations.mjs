import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStorage } from '../server/storage.mjs';
import { installStorageAdapter } from '../src/local/db.ts';
import { data, reload, setData } from '../src/local/store.ts';
import { createAutomations, automationRecipes, automationSchema } from '../src/local/automations.ts';
import { createTemplates } from '../src/local/templates.ts';

const directory = mkdtempSync(join(tmpdir(), 'lifeos-automation-test-'));
const migrations = readdirSync('src-tauri/migrations').filter(name => /^\d+.*\.sql$/.test(name)).sort().map(name => [Number(name.split('_')[0]), name.replace(/^\d+_|\.sql$/g, ''), readFileSync(join('src-tauri/migrations', name), 'utf8')]);
const storage = openStorage(join(directory, 'lifeos.db'), migrations);
installStorageAdapter(storage);
const now = Date.now();
const workspaceId = randomUUID();
storage.db.prepare('INSERT INTO workspaces (_id,_creationTime,name,archived,createdAt,updatedAt) VALUES (?,?,?,0,?,?)').run(workspaceId, now, 'Automation test', now, now);
let failAfterInsert = false;
async function createItem(input) {
  const id = randomUUID();
  if (!input.title.trim() || input.title.length > 200) throw new Error('Invalid generated title');
  storage.db.prepare('INSERT INTO items (_id,_creationTime,workspaceId,title,areaId,type,status,priority,dueDate,amount,financialState,description,parentId,archived,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)').run(id, now, input.workspaceId, input.title, input.areaId, input.type, input.status, input.priority, input.dueDate, input.amount, input.financialState, input.description, input.parentId, now, now);
  for (const tag of input.tags) {
    const existing = storage.db.prepare('SELECT _id FROM tags WHERE workspaceId=? AND normalizedName=?').get(input.workspaceId, tag.toLowerCase());
    const tagId = existing?._id ?? randomUUID();
    if (!existing) storage.db.prepare('INSERT INTO tags (_id,_creationTime,workspaceId,name,normalizedName,createdAt) VALUES (?,?,?,?,?,?)').run(tagId, now, input.workspaceId, tag, tag.toLowerCase(), now);
    storage.db.prepare('INSERT INTO itemTags (_id,_creationTime,workspaceId,itemId,tagId,createdAt) VALUES (?,?,?,?,?,?)').run(randomUUID(), now, input.workspaceId, id, tagId, now);
  }
  if (failAfterInsert) throw new Error('Injected action failure after write');
  return id;
}
const templates = createTemplates(createItem);
const engine = createAutomations({ createItem, applyTemplate: templates.apply, updateItem: async input => { storage.db.prepare('UPDATE items SET status=?,priority=?,dueDate=? WHERE _id=?').run(input.status, input.priority, input.dueDate, input.itemId); } });
async function refresh() {
  await reload();
  setData(draft => {
    draft.automations = storage.db.prepare('SELECT * FROM automations').all().map(row => ({ ...row, enabled: Boolean(row.enabled), definition: JSON.parse(row.definition) }));
    draft.automationRuns = storage.db.prepare('SELECT * FROM automationRuns').all().map(row => ({ ...row, input: JSON.parse(row.input), result: row.result ? JSON.parse(row.result) : null }));
  });
}
const tx = work => storage.transaction(work, refresh);
const input = (title, tags = [], extra = {}) => ({ workspaceId, title, tags, type: 'Task', status: 'Todo', areaId: null, parentId: null, priority: null, dueDate: null, amount: null, financialState: null, description: null, ...extra });
await refresh();

const deliveryRule = await tx(() => engine.save({ workspaceId, definition: automationRecipes('UTC')[1] }));
assert.equal(data.automations.find(rule => rule._id === deliveryRule).enabled, false, 'New rules must be paused');
await tx(() => engine.setEnabled({ workspaceId, automationId: deliveryRule, enabled: true }));
const delivery = await tx(() => createItem(input('Deliver project', ['delivery'])));
const before = JSON.parse(JSON.stringify(data.items.find(item => item._id === delivery)));
await tx(async () => {
  storage.db.prepare("UPDATE items SET status='Done' WHERE _id=?").run(delivery);
  await engine.afterMutation('items.setTaskDone', { itemId: delivery, done: true }, null, before, now);
});
assert.equal(data.automationRuns.length, 1);
assert.equal(data.automationRuns[0].status, 'pending');
await tx(() => engine.tick({ now }));
assert.equal(data.automationRuns[0].status, 'completed');
assert.equal(data.items.filter(item => item.title.startsWith('Follow up on payment')).length, 1);
await tx(() => engine.afterMutation('items.setTaskDone', { itemId: delivery, done: true }, null, data.items.find(item => item._id === delivery), now));
await tx(() => engine.tick({ now }));
assert.equal(data.automationRuns.length, 1, 'Repeated Done does not retrigger completion');

const weeklyRule = await tx(() => engine.save({ workspaceId, definition: automationRecipes('UTC')[0], enabled: true }));
storage.db.prepare('UPDATE automations SET nextRunDate=? WHERE _id=?').run('2020-01-03', weeklyRule);
await tx(() => engine.tick({ now }));
await tx(() => engine.tick({ now }));
assert.equal(data.automationRuns.filter(job => job.automationId === weeklyRule).length, 1, 'Missed weekly work is coalesced');
assert.equal(data.items.filter(item => item.title === 'Weekly review').length, 1);
assert.equal(data.items.filter(item => item.parentId === data.items.find(item => item.title === 'Weekly review')._id).length, 3);

const failureRule = await tx(() => engine.save({ workspaceId, enabled: true, definition: automationSchema.parse({ name: 'Retry test', trigger: { kind: 'item_created', timezone: 'UTC' }, conditions: { tags: ['failure-test'] }, action: { kind: 'create_item', title: 'Retry output' } }) }));
const failureSource = await tx(() => createItem(input('Trigger retry', ['failure-test'])));
await tx(() => engine.afterMutation('items.create', {}, failureSource, undefined, now));
const count = data.items.length;
failAfterInsert = true;
await tx(() => engine.tick({ now }));
assert.equal(data.items.length, count, 'Failed action writes roll back to savepoint');
const failedJob = data.automationRuns.find(job => job.automationId === failureRule);
assert.equal(failedJob.status, 'pending'); assert.equal(failedJob.attempts, 1);
failAfterInsert = false;
await tx(() => engine.tick({ now: now + 60001 }));
assert.equal(data.automationRuns.find(job => job._id === failedJob._id).status, 'completed');
assert.equal(data.items.filter(item => item.title === 'Retry output').length, 1);

const checkpoint = await tx(() => engine.checkpoint({ workspaceId, itemId: delivery, did: 'Shipped the client page', failed: 'Upload timeout', next: 'Retry only the missing asset' }));
const note = data.items.find(item => item._id === checkpoint);
assert.equal(note.parentId, delivery); assert.equal(note.type, 'Note');
assert(note.title.startsWith('Checkpoint:')); assert(note.description.includes('What changed\nShipped')); assert(note.description.includes('Next action\nRetry'));
await assert.rejects(tx(() => engine.checkpoint({ workspaceId: 'other-workspace', itemId: delivery, did: 'x', next: 'y' })), /Workspace/);

const project = await tx(() => createItem(input('Old project', ['project'])));
storage.db.prepare('UPDATE items SET updatedAt=? WHERE _id=?').run(now - 20 * 86400000, project);
const inactivityRule = await tx(() => engine.save({ workspaceId, enabled: true, definition: automationRecipes('UTC')[2] }));
await tx(() => engine.tick({ now })); await tx(() => engine.tick({ now }));
assert.equal(data.automationRuns.filter(job => job.automationId === inactivityRule).length, 1, 'Same inactivity episode creates one reminder');
const pendingRule = await tx(() => engine.save({ workspaceId, enabled: true, definition: automationSchema.parse({ name: 'Pause test', trigger: { kind: 'item_created' }, action: { kind: 'reminder' } }) }));
const pendingSource = await tx(() => createItem(input('Pending source')));
await tx(() => engine.afterMutation('items.create', {}, pendingSource, undefined, now));
await tx(() => engine.setEnabled({ workspaceId, automationId: pendingRule, enabled: false }));
assert(data.automationRuns.filter(job => job.automationId === pendingRule).every(job => job.status === 'cancelled'));

storage.db.close();
const reopened = openStorage(join(directory, 'lifeos.db'), migrations);
assert.equal(reopened.db.prepare("SELECT COUNT(*) AS count FROM automationRuns WHERE status='completed'").get().count, 4);
reopened.db.close();
console.log('Automation recipes, transactional retry, deduplication, paused rules, checkpoint evidence, workspace isolation and durable history passed');
