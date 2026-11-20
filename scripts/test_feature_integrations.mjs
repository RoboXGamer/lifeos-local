import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStorage } from '../server/storage.mjs';
import { readMigrations } from './test-helpers.mjs';
import { installStorageAdapter } from '../src/local/db.ts';
import { api, ensureProfile, runProductivityTasks, tickRecurring } from '../src/local/api.ts';
import { data, reload } from '../src/local/store.ts';
import { automationSchema } from '../src/local/automations.ts';
import { formatMoney } from '../src/local/obligations.ts';

const path = join(mkdtempSync(join(tmpdir(), 'lifeos-integrations-')), 'lifeos.db');
const storage = openStorage(path, readMigrations());
installStorageAdapter(storage);
await ensureProfile();
const workspaceId = data.profile.activeWorkspaceId;
const now = Date.now();
const date = new Date(now).toISOString().slice(0, 10);
const item = id => data.items.find(i => i._id === id);
const jobs = rule => data.automationRuns.filter(r => r.automationId === rule);
const event = id => storage.db.prepare("SELECT * FROM itemMutationEvents WHERE itemId=? AND kind='item_created'").get(id);
const input = (title, extra = {}) => ({ workspaceId, title, type: 'Task', status: 'Todo', areaId: null, parentId: null, priority: null, dueDate: null, amount: null, financialState: null, description: null, tags: [], ...extra });
const edit = (id, patch) => {
  const i = item(id);
  return api.items.update({ ...input(i.title), ...i, type: i.type ?? null, status: i.status ?? null, priority: i.priority ?? null, dueDate: i.dueDate ?? null, description: i.description ?? null, amount: i.amount ?? null, financialState: i.financialState ?? null, itemId: id, ...patch });
};
const rule = (name, trigger, conditions, action, ws = workspaceId) => api.automations.save({ workspaceId: ws, enabled: true, definition: automationSchema.parse({ name, trigger: { kind: trigger }, conditions, action }) });
const tableCounts = () => Object.fromEntries(['items', 'tags', 'itemTags', 'templateInstances', 'itemMutationEvents', 'automationRuns', 'commitments', 'obligationReviews', 'obligationFollowups', 'obligationPayments'].map(t => [t, storage.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));

// Public template -> raw item create -> durable event -> rule -> action, without recursion.
const deliveryRule = await rule('Created delivery', 'item_created', { tags: ['delivery'] }, { kind: 'reminder', title: 'Follow up', tags: ['delivery'] });
const root = await api.templates.apply({ workspaceId, templateId: 'starter:delivery', startDate: date, variables: { client: 'Acme', project: 'Site' } });
const delivery = data.items.find(i => i.parentId === root && i.tags.includes('delivery'));
assert(delivery);
assert.equal(jobs(deliveryRule).length, 1);
assert.equal(jobs(deliveryRule)[0].input.item._id, delivery._id);
assert.equal(jobs(deliveryRule)[0].input.event.origin, 'template');
const instance = storage.db.prepare('SELECT * FROM templateInstances WHERE rootItemId=?').get(root);
assert.equal(event(delivery._id).sourceId, instance._id);
await runProductivityTasks(now + 1000);
await runProductivityTasks(now + 2000);
assert.equal(jobs(deliveryRule).length, 1, 'matching generated reminders must not recursively enqueue');
assert.equal(jobs(deliveryRule)[0].status, 'completed');
assert.equal(event(jobs(deliveryRule)[0].result.itemId).origin, 'automation');
assert.equal(event(jobs(deliveryRule)[0].result.itemId).sourceId, jobs(deliveryRule)[0]._id);

// Failure after items, tags, events and queued runs have been written rolls everything back.
const beforeTemplate = tableCounts();
storage.db.exec("CREATE TRIGGER fail_template BEFORE INSERT ON templateInstances BEGIN SELECT RAISE(ABORT,'injected template failure'); END");
await assert.rejects(api.templates.apply({ workspaceId, templateId: 'starter:delivery', startDate: date, variables: { client: 'Rollback', project: 'Rollback' } }), /injected template/);
assert.deepEqual(tableCounts(), beforeTemplate);
storage.db.exec('DROP TRIGGER fail_template');

// Calendar occurrences have their own provenance/event key; repeated ticks are idempotent.
const recurringSource = await api.items.create(input('Recurring delivery', { tags: ['delivery'], status: 'Done' }));
const schedule = await api.recurrence.save({ workspaceId, itemId: recurringSource, definition: { frequency: 'daily', interval: 1, weekdays: [], mode: 'calendar', timezone: 'UTC', startDate: date, endDate: null } });
const future = now + 2 * 86400000;
const beforeRecurring = jobs(deliveryRule).length;
const countsBeforeOccurrence = tableCounts();
storage.db.exec("CREATE TRIGGER fail_occurrence BEFORE INSERT ON recurrenceOccurrences WHEN NEW.scheduleId='" + schedule + "' BEGIN SELECT RAISE(ABORT,'injected occurrence failure'); END");
await tickRecurring(future);
assert.deepEqual(tableCounts(), countsBeforeOccurrence, 'failed occurrence must roll back items, tags, events and runs');
assert.match(data.schedules.find(s => s._id === schedule).lastError, /injected occurrence/);
storage.db.exec('DROP TRIGGER fail_occurrence');
await tickRecurring(future);
const occurrence = data.occurrences.find(o => o.scheduleId === schedule && o.itemId !== recurringSource);
assert(occurrence);
assert.equal(event(occurrence.itemId).origin, 'recurrence');
assert.equal(event(occurrence.itemId).sourceId, `${schedule}:${occurrence.scheduledDate}`);
assert.equal(jobs(deliveryRule).length, beforeRecurring + 1);
await tickRecurring(future);
await runProductivityTasks(future);
await runProductivityTasks(future + 1000);
assert.equal(data.occurrences.filter(o => o.scheduleId === schedule && o.itemId !== recurringSource).length, 1);
assert.equal(jobs(deliveryRule).length, beforeRecurring + 1);

// Automated templates and updates inherit suppression. Later explicit user edits can trigger.
const templateRule = await rule('Generated family', 'item_created', { tags: ['fanout'] }, { kind: 'apply_template', templateId: 'starter:delivery', variables: { client: 'Bot', project: 'Generated site' } });
const deliveryBeforeFanout = jobs(deliveryRule).length;
await api.items.create(input('Generate family', { tags: ['fanout'] }));
await runProductivityTasks(future + 2000);
const generatedRoot = jobs(templateRule)[0].result.itemId;
for (const i of data.items.filter(i => i._id === generatedRoot || i.parentId === generatedRoot)) assert.equal(event(i._id).origin, 'automation');
assert.equal(jobs(deliveryRule).length, deliveryBeforeFanout);
const statusRule = await rule('Status observed', 'status_changed', { tags: ['autoupdate'], status: 'Done' }, { kind: 'reminder', title: 'Manual completion' });
const updateRule = await rule('Complete automatically', 'item_created', { tags: ['autoupdate'] }, { kind: 'update_item', status: 'Done' });
const autoUpdated = await api.items.create(input('Update internally', { tags: ['autoupdate'] }));
await runProductivityTasks(future + 3000);
assert.equal(item(autoUpdated).status, 'Done');
assert.equal(jobs(updateRule)[0].status, 'completed');
assert.equal(jobs(statusRule).length, 0);
assert.equal(storage.db.prepare("SELECT origin FROM itemMutationEvents WHERE itemId=? AND kind='status_changed'").get(autoUpdated).origin, 'automation');
await api.items.setTaskDone({ itemId: autoUpdated, done: false });
await edit(autoUpdated, { status: 'Done' });
await api.items.setTaskDone({ itemId: autoUpdated, done: true });
assert.equal(jobs(statusRule).length, 1, 'repeating a status must not enqueue again');
const quickRule = await rule('Quick inbox', 'item_created', {}, { kind: 'reminder', title: 'Quick captured' });
const quick = await api.items.quickCapture({ workspaceId, title: 'Quick entry' });
assert.equal(jobs(quickRule).filter(r => r.input.item._id === quick).length, 1);
await api.automations.setEnabled({ workspaceId, automationId: quickRule, enabled: false });
await runProductivityTasks(future + 3500);

// Failed automation action rolls back event metadata as well as items; retry creates one effect.
const retryRule = await rule('Retry integration', 'item_created', { tags: ['retry-integration'] }, { kind: 'create_item', title: 'Retried effect', tags: ['retry-integration'] });
await api.items.create(input('Retry source', { tags: ['retry-integration'] }));
const countsBeforeRetry = tableCounts();
storage.db.exec("CREATE TRIGGER fail_job BEFORE UPDATE OF status ON automationRuns WHEN NEW.automationId='" + retryRule + "' AND NEW.status='completed' BEGIN SELECT RAISE(ABORT,'injected action failure'); END");
await runProductivityTasks(future + 4000);
assert.equal(data.items.filter(i => i.title === 'Retried effect').length, 0);
assert.equal(tableCounts().itemMutationEvents, countsBeforeRetry.itemMutationEvents, 'failed action provenance rolls back');
assert.equal(jobs(retryRule)[0].attempts, 1);
storage.db.exec('DROP TRIGGER fail_job');
await runProductivityTasks(future + 65000);
await runProductivityTasks(future + 66000);
assert.equal(jobs(retryRule)[0].status, 'completed');
assert.equal(data.items.filter(i => i.title === 'Retried effect').length, 1);
assert.equal(jobs(retryRule).length, 1);

// Time-based rules cannot grow chains from their own outputs on later scheduler ticks.
const loopWorkspace = await api.workspaces.create({ name: 'Loop isolation' });
const dueRule = await rule('Due loop guard', 'due_date', { tags: ['loop'] }, { kind: 'create_item', title: 'Due output', tags: ['loop'] }, loopWorkspace);
await api.items.create(input('Due source', { workspaceId: loopWorkspace, tags: ['loop'], dueDate: date }));
await runProductivityTasks(future + 67000);
await runProductivityTasks(future + 68000);
assert.equal(jobs(dueRule).length, 1);

// Quick notes and structured checkpoints feed the same choice, fields and source identity.
const projectRoot = await api.items.create(input('Project root'));
const projectId = await api.projects.create({ workspaceId, itemId: projectRoot, name: 'Integration project', goal: 'Ship', status: 'paused', settings: { repositories: [] } });
const projectScope = { workspaceId, projectId };
const older = await api.projects.checkpoint({ ...projectScope, did: 'Older work', failed: 'Old blocker', whyStopped: 'Decision needed', next: 'Old next' });
const newer = await api.automations.checkpoint({ workspaceId, itemId: projectRoot, did: 'Newer work', failed: 'New blocker', next: 'New next' });
storage.db.prepare('UPDATE projectCheckpoints SET createdAt=? WHERE _id=?').run(100, older);
storage.db.prepare('UPDATE items SET createdAt=? WHERE _id=?').run(200, newer);
await reload();
let resume = api.projects.resume(projectScope);
let decision = api.attention.build({ workspaceId, date }).suggestions.find(s => s.kind === 'decision');
assert.equal(resume.nextAction, 'New next');
assert.equal(resume.failedAttempts, 'New blocker');
assert.equal(resume.checkpointId, newer);
assert.equal(resume.checkpointSource, `item:${newer}`);
assert.equal(resume.nextActionKind, 'recorded');
assert(decision.sourceIds.includes(newer));
assert.equal(decision.sourceIdentity, resume.checkpointSource);
assert.match(decision.detail, /New blocker[\s\S]*New next/);
assert(!decision.detail.includes('Old next'));
storage.db.prepare('UPDATE projectCheckpoints SET createdAt=? WHERE _id=?').run(200, older);
await reload();
resume = api.projects.resume(projectScope);
decision = api.attention.build({ workspaceId, date }).suggestions.find(s => s.kind === 'decision');
assert.equal(resume.nextAction, 'Old next', 'structured wins exact timestamp ties');
assert(decision.sourceIds.includes(resume.checkpointId));
assert.match(decision.detail, /Old next/);
const tieNote = await api.automations.checkpoint({ workspaceId, itemId: projectRoot, did: 'Tie note', failed: 'Tie blocker', next: 'Tie next' });
storage.db.prepare('UPDATE items SET createdAt=? WHERE _id IN (?,?)').run(300, newer, tieNote);
await reload();
resume = api.projects.resume(projectScope);
const expectedNote = [newer, tieNote].sort((a, b) => b.localeCompare(a))[0];
assert.equal(resume.checkpointId, expectedNote);
decision = api.attention.build({ workspaceId, date }).suggestions.find(s => s.kind === 'decision');
assert(decision.sourceIds.includes(expectedNote));
assert.equal(data.projectCheckpoints.length, 1, 'quick notes do not rewrite historical structured records');
await api.items.setArchived({ itemId: newer, archived: true });
await api.items.setArchived({ itemId: tieNote, archived: true });
assert.equal(api.projects.resume(projectScope).nextAction, 'Old next');

// Obligation lifecycle through the public API, with provenance and immutable reviewed terms.
const obligationWorkspace = await api.workspaces.create({ name: 'Obligation isolation' });
const engagementId = await api.obligations.create({ workspaceId: obligationWorkspace, client: 'Acme', name: 'Site terms' });
const scope = { workspaceId: obligationWorkspace, engagementId };
async function commitment(label, body = 'Pay INR 1000 by 2026-11-01') {
  const documentId = await api.obligations.addDocument({ ...scope, label, kind: 'contract', body: `${body}\nReference ${label}` });
  await api.obligations.extract({ ...scope, documentId });
  return data.commitments.find(c => c.documentId === documentId);
}
const details = () => api.obligations.details(scope);
const link = id => details().followups.find(f => f.itemId === id);
const obligationRule = await rule('Follow-up created', 'item_created', { tags: ['waiting'] }, { kind: 'reminder', title: 'Review follow-up' }, obligationWorkspace);
const c = await commitment('Original');
await api.obligations.review({ ...scope, commitmentId: c._id, status: 'accepted' });
const task = await api.obligations.createFollowup({ ...scope, commitmentId: c._id, dueDate: '2026-11-01', exceptionKey: 'ignored-untrusted-key' });
assert.equal(event(task).origin, 'obligation');
assert.equal(link(task).exceptionKey, `commitment:${c._id}`);
assert.equal(jobs(obligationRule).length, 1);
assert.equal(await api.obligations.createFollowup({ ...scope, commitmentId: c._id, dueDate: '2026-11-01' }), task);
await api.obligations.review({ ...scope, commitmentId: c._id, status: 'accepted', dueDate: '2026-12-01', title: 'Revised promise', amount: '1500', conditions: 'Revised conditions' });
assert.equal(item(task).title, 'Revised promise');
assert.equal(item(task).dueDate, '2026-12-01');
assert(item(task).description.includes(formatMoney(150000, 'INR')));
assert.match(item(task).description, /Revised conditions/);
assert.equal(link(task).reconciliation, 'managed');
const reviewsBeforeRepeat = details().reviews.length;
await api.obligations.review({ ...scope, commitmentId: c._id, status: 'accepted', dueDate: '2026-12-01', title: 'Revised promise', amount: '1500', conditions: 'Revised conditions' });
assert.equal(details().reviews.length, reviewsBeforeRepeat);
assert.equal(JSON.parse(details().reviews.at(-1).previous).title, c.title, 'previous accepted terms are retained');
await api.obligations.review({ ...scope, commitmentId: c._id, status: 'cancelled' });
assert.equal(item(task).archived, true);
assert.equal(item(task).status, 'Todo', 'cancellation archives rather than falsely recording work done');
assert.equal(link(task).reconciliation, 'archived');
assert.match(link(task).auditReason, /cancelled/);
const cancellationAudit = JSON.stringify(link(task));
await api.obligations.review({ ...scope, commitmentId: c._id, status: 'cancelled' });
assert.equal(JSON.stringify(link(task)), cancellationAudit);
assert(!api.items.listUpcoming({ workspaceId: obligationWorkspace, afterDate: '2026-10-01' }).some(i => i._id === task));

// Preserve manual fields while independently reconciling fields still owned by the source.
const customized = await commitment('Custom');
await api.obligations.review({ ...scope, commitmentId: customized._id, status: 'accepted' });
const customTask = await api.obligations.createFollowup({ ...scope, commitmentId: customized._id, dueDate: '2026-11-01' });
await edit(customTask, { title: 'My title', description: 'My notes', priority: 1, tags: ['waiting', 'personal'] });
await api.obligations.review({ ...scope, commitmentId: customized._id, status: 'accepted', title: 'Source title', dueDate: '2026-12-15' });
assert.equal(item(customTask).title, 'My title');
assert.equal(item(customTask).description, 'My notes');
assert.equal(item(customTask).dueDate, '2026-12-15');
assert.equal(item(customTask).priority, 1);
assert.equal(link(customTask).reconciliation, 'diverged');
assert(details().exceptions.some(e => e.commitmentId === customized._id));
await edit(customTask, { dueDate: '2026-12-20' });
await api.obligations.review({ ...scope, commitmentId: customized._id, status: 'accepted', dueDate: '2026-12-25' });
assert.equal(item(customTask).dueDate, '2026-12-20', 'manual date is preserved');
await api.obligations.review({ ...scope, commitmentId: customized._id, status: 'cancelled' });
assert.equal(item(customTask).archived, false);
assert.equal(item(customTask).status, 'Todo');
assert(!api.items.listToday({ workspaceId: obligationWorkspace, date: '2026-12-20' }).some(i => i._id === customTask));
assert(!api.items.listUpcoming({ workspaceId: obligationWorkspace, afterDate: '2026-10-01' }).some(i => i._id === customTask));
assert(!api.attention.build({ workspaceId: obligationWorkspace, date: '2026-12-20' }).suggestions.some(s => s.itemId === customTask));
assert(api.items.list({ workspaceId: obligationWorkspace }).some(i => i._id === customTask), 'preserved work remains in ordinary lists');

// Completed work and child history survive amendments/cancellation; confirmed money is untouched.
const completed = await commitment('Completed');
await api.obligations.review({ ...scope, commitmentId: completed._id, status: 'accepted' });
const completedTask = await api.obligations.createFollowup({ ...scope, commitmentId: completed._id, dueDate: '2026-11-01' });
await api.items.setTaskDone({ itemId: completedTask, done: true });
const completedBefore = JSON.stringify(item(completedTask));
await api.obligations.review({ ...scope, commitmentId: completed._id, status: 'accepted', title: 'New completed terms', dueDate: '2027-01-01' });
assert.equal(JSON.stringify(item(completedTask)), completedBefore);
assert.equal(link(completedTask).reconciliation, 'diverged');
const paymentId = await api.obligations.recordPayment({ ...scope, reference: 'CONFIRMED', amount: '1000', currency: 'INR', date: '2026-10-29' });
const paymentBefore = JSON.stringify(data.obligationPayments.find(p => p._id === paymentId));
const paymentItemId = data.obligationPayments.find(p => p._id === paymentId).itemId;
const paymentItemBefore = JSON.stringify(item(paymentItemId));
await api.obligations.review({ ...scope, commitmentId: completed._id, status: 'cancelled' });
assert.equal(JSON.stringify(item(completedTask)), completedBefore);
assert.equal(JSON.stringify(data.obligationPayments.find(p => p._id === paymentId)), paymentBefore);
assert.equal(JSON.stringify(item(paymentItemId)), paymentItemBefore);

// Supersession retires the previous task; replacement gets its own explicit, deduplicated task.
const prior = await commitment('Prior');
await api.obligations.review({ ...scope, commitmentId: prior._id, status: 'accepted' });
const priorTask = await api.obligations.createFollowup({ ...scope, commitmentId: prior._id, dueDate: '2026-11-01' });
const replacement = await commitment('Replacement', 'Pay INR 2000 by 2026-12-30');
await api.obligations.review({ ...scope, commitmentId: replacement._id, status: 'accepted', supersedesId: prior._id });
assert.equal(data.commitments.find(c => c._id === prior._id).status, 'superseded');
assert.equal(item(priorTask).archived, true);
assert.match(link(priorTask).auditReason, /superseded/);
await api.obligations.review({ ...scope, commitmentId: replacement._id, status: 'accepted', supersedesId: prior._id });
const replacementTask = await api.obligations.createFollowup({ ...scope, commitmentId: replacement._id, dueDate: '2026-12-30' });
assert.notEqual(replacementTask, priorTask);
assert.equal(await api.obligations.createFollowup({ ...scope, commitmentId: replacement._id, dueDate: '2026-12-30' }), replacementTask);
await assert.rejects(api.obligations.review({ ...scope, commitmentId: prior._id, status: 'accepted' }), /superseded/);

// Unknown legacy ownership and child work are never guessed away.
const withChildren = await commitment('Child history');
await api.obligations.review({ ...scope, commitmentId: withChildren._id, status: 'accepted' });
const parentTask = await api.obligations.createFollowup({ ...scope, commitmentId: withChildren._id, dueDate: '2026-11-01' });
const child = await api.items.create(input('Child evidence', { workspaceId: obligationWorkspace, type: 'Note', status: null, parentId: parentTask }));
await api.obligations.review({ ...scope, commitmentId: withChildren._id, status: 'cancelled' });
assert.equal(item(parentTask).archived, false);
assert.equal(item(child).archived, false);
const legacy = await commitment('Legacy');
await api.obligations.review({ ...scope, commitmentId: legacy._id, status: 'accepted' });
const legacyTask = await api.obligations.createFollowup({ ...scope, commitmentId: legacy._id, dueDate: '2026-11-01' });
storage.db.prepare('UPDATE obligationFollowups SET managedSnapshot=NULL WHERE itemId=?').run(legacyTask);
await api.obligations.review({ ...scope, commitmentId: legacy._id, status: 'cancelled' });
assert.equal(item(legacyTask).archived, false);
assert.match(link(legacyTask).auditReason, /unknown/);

// A late failure atomically restores accepted terms, task fields, source ownership and audit.
const rollbackBefore = JSON.stringify({ c: data.commitments.find(c => c._id === replacement._id), i: item(replacementTask), f: link(replacementTask), counts: tableCounts() });
storage.db.exec("CREATE TRIGGER fail_reconcile BEFORE UPDATE OF reconciliation ON obligationFollowups BEGIN SELECT RAISE(ABORT,'injected reconcile failure'); END");
await assert.rejects(api.obligations.review({ ...scope, commitmentId: replacement._id, status: 'accepted', dueDate: '2027-02-01', title: 'Must roll back' }), /injected reconcile/);
await reload();
assert.equal(JSON.stringify({ c: data.commitments.find(c => c._id === replacement._id), i: item(replacementTask), f: link(replacementTask), counts: tableCounts() }), rollbackBefore);
await assert.rejects(api.obligations.review({ ...scope, commitmentId: replacement._id, status: 'cancelled' }), /injected reconcile/);
await reload();
assert.equal(item(replacementTask).archived, false);
assert.equal(data.commitments.find(c => c._id === replacement._id).status, 'accepted');
storage.db.exec('DROP TRIGGER fail_reconcile');
await api.obligations.review({ ...scope, commitmentId: replacement._id, status: 'accepted', dueDate: '2027-02-01', title: 'Retried amendment' });
assert.equal(item(replacementTask).title, 'Retried amendment');
assert.equal(item(replacementTask).dueDate, '2027-02-01');

// Workspace boundaries apply to generators, rules, checkpoints, reviews and supersession.
const isolatedBefore = tableCounts();
await assert.rejects(api.templates.apply({ workspaceId: obligationWorkspace, templateId: await api.templates.save({ workspaceId, definition: { name: 'Private', entries: [{ title: 'Private task', type: 'Task' }] } }), startDate: date }), /not found/);
await assert.rejects(api.automations.checkpoint({ workspaceId: obligationWorkspace, itemId: projectRoot, did: 'x', next: 'y' }), /Workspace/);
await assert.rejects(api.obligations.review({ workspaceId, engagementId, commitmentId: replacement._id, status: 'cancelled' }), /not found/);
assert.equal(jobs(deliveryRule).some(r => r.workspaceId !== workspaceId), false);
assert.deepEqual(tableCounts(), isolatedBefore);
assert.throws(() => api.projects.resume({ workspaceId: obligationWorkspace, projectId }), /not found/);

storage.db.close();
const reopened = openStorage(path, readMigrations());
assert.equal(reopened.db.prepare('SELECT title FROM items WHERE _id=?').get(replacementTask).title, 'Retried amendment');
assert(reopened.db.prepare('SELECT COUNT(*) n FROM obligationReviews').get().n > 0);
assert.equal(reopened.db.prepare('SELECT origin FROM itemMutationEvents WHERE itemId=?').get(occurrence.itemId).origin, 'recurrence');
reopened.db.close();
console.log('Cross-feature integrations: generated item rules/provenance/non-recursion/retries, checkpoint parity/ties, obligation amendment/cancel/supersede/customization/completion, rollback/isolation and persistence passed');
