import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { openStorage } from '../server/storage.mjs';
import { installStorageAdapter } from '../src/local/db.ts';
import { api, ensureProfile } from '../src/local/api.ts';
import { data, reload } from '../src/local/store.ts';
import { buildAttention } from '../src/local/attention.ts';
import { addDays } from '../src/local/templates.ts';
import { localDateKey } from '../src/features/items/dates.ts';
import { readMigrations } from './test-helpers.mjs';

const directory = mkdtempSync(join(tmpdir(), 'lifeos-attention-test-'));
const path = join(directory, 'lifeos.db');
const storage = openStorage(path, readMigrations());
installStorageAdapter(storage); await ensureProfile();
const workspaceId = data.profile.activeWorkspaceId;
const today = localDateKey();
const input = (title, changes = {}) => ({ workspaceId, title, type: 'Task', status: 'Todo', priority: 2, areaId: null, parentId: null, dueDate: null, amount: null, financialState: null, description: null, tags: [], ...changes });
const attention = (args = {}) => buildAttention({ workspaceId, date: today, ...args });

// An empty workspace has no invented advice. Time fit requires both a saved estimate and a capacity.
assert.deepEqual(attention().suggestions, []);
const shipping = await api.items.create(input('Ship a tiny useful fix'));
let suggestion = attention().suggestions.find(s => s.itemId === shipping);
assert(suggestion); assert.match(suggestion.reason, /unverified/); assert.equal(suggestion.estimatedMinutes, null);
await api.attention.estimate({ workspaceId, itemId: shipping, minutes: 25 });
assert.equal(attention({ availableMinutes: 15 }).suggestions.some(s => s.itemId === shipping), false);
await api.attention.estimate({ workspaceId, itemId: shipping, minutes: 10 });
suggestion = attention({ availableMinutes: 15 }).suggestions.find(s => s.itemId === shipping);
assert.match(suggestion.reason, /10 minutes/); assert.match(suggestion.reason, /15 available minutes/);
await assert.rejects(api.attention.estimate({ workspaceId, itemId: shipping, minutes: -1 }));

// Pending/blocked work, and work in paused projects, cannot be recommended as currently shippable.
const blockedParent = await api.items.create(input('Blocked project', { tags: ['blocked'], priority: 1 }));
const blockedChild = await api.items.create(input('Blocked child', { parentId: blockedParent, priority: 1 }));
await api.attention.estimate({ workspaceId, itemId: blockedChild, minutes: 5 });
assert.equal(attention({ availableMinutes: 15 }).suggestions.some(s => s.itemId === blockedChild), false);
const projectRoot = await api.items.create(input('Paused prototype', { type: 'Note', status: null }));
const projectId = await api.projects.create({ workspaceId, itemId: projectRoot, name: 'Paused prototype', goal: 'Ship one useful view', audience: 'Me', valueStatement: 'Remember decisions', status: 'paused', settings: { repositories: [], exclusions: [], retentionDays: 365 } });
const pausedChild = await api.items.create(input('Do not silently revive this', { parentId: projectRoot, priority: 1 }));
await api.attention.estimate({ workspaceId, itemId: pausedChild, minutes: 5 });
await api.projects.checkpoint({ workspaceId, projectId, did: 'Built the first screen', failed: 'Export failed on large files', whyStopped: 'Need a reproducible fixture', next: 'Create the smallest failing export fixture' });
assert.equal(attention({ availableMinutes: 15 }).suggestions.some(s => s.kind === 'shipping' && s.itemId === pausedChild), false);
assert(attention({ availableMinutes: 15 }).suggestions.some(s => s.kind === 'decision' && s.detail.includes('Need a reproducible fixture') && s.sourceIds.length >= 2));

// A waiting maintenance item appears once with an honest reason; actual payments/completed tasks do not reappear.
const waiting = await api.items.create(input('Renewal approval', { tags: ['waiting', 'renewal'], dueDate: today }));
const paid = await api.items.create(input('Paid subscription', { type: 'Expense', status: null, financialState: 'Spent', amount: 100, tags: ['renewal'], dueDate: today }));
const done = await api.items.create(input('Finished backup', { status: 'Done', tags: ['maintenance'], dueDate: today }));
const summary = attention({ availableMinutes: 15 });
assert(summary.suggestions.length <= 3);
assert.equal(summary.suggestions.filter(s => s.itemId === waiting).length, 1);
assert.equal(summary.suggestions.some(s => s.itemId === paid || s.itemId === done), false);
assert.equal(new Set(summary.suggestions.filter(s => s.itemId).map(s => s.itemId)).size, summary.suggestions.filter(s => s.itemId).length);

// Dismiss/snooze/correction are persisted and scoped; fresh evidence can resurface after a dismissal.
const waitingSuggestion = summary.suggestions.find(s => s.itemId === waiting);
await api.attention.feedback({ workspaceId, suggestionId: waitingSuggestion._id, action: 'dismiss', note: 'Approval already requested; handle next month' });
assert.equal(attention({ availableMinutes: 15 }).suggestions.some(s => s._id === waitingSuggestion._id), false);
assert.equal(data.attentionFeedback.find(f => f.suggestionId === waitingSuggestion._id).note, 'Approval already requested; handle next month');
await api.attention.feedback({ workspaceId, suggestionId: waitingSuggestion._id, action: 'reset' });
assert(attention({ availableMinutes: 15 }).suggestions.some(s => s._id === waitingSuggestion._id));
await api.attention.feedback({ workspaceId, suggestionId: waitingSuggestion._id, action: 'snooze', untilDate: addDays(today, 2) });
assert.equal(attention({ availableMinutes: 15 }).suggestions.some(s => s._id === waitingSuggestion._id), false);
assert(attention({ availableMinutes: 15, date: addDays(today, 2) }).suggestions.some(s => s._id === waitingSuggestion._id));
await assert.rejects(api.attention.feedback({ workspaceId, suggestionId: waitingSuggestion._id, action: 'snooze', untilDate: today }), /future/);
await api.attention.feedback({ workspaceId, suggestionId: waitingSuggestion._id, action: 'reset' });

// Invoice evidence outranks lower-risk tasks, and a waiting follow-up shares its identity with the invoice alert.
const engagementId = await api.obligations.create({ workspaceId, client: 'Example Client', name: 'Site delivery' });
const invoiceId = await api.obligations.addInvoice({ workspaceId, engagementId, reference: 'INV-001', amount: '1000.00', currency: 'INR', dueDate: addDays(today, -2) });
const followupId = await api.obligations.createFollowup({ workspaceId, engagementId, exceptionKey: `overdue:${invoiceId}`, dueDate: today });
let paymentSuggestion = attention({ availableMinutes: 15 }).suggestions.find(s => s.kind === 'payment');
assert(paymentSuggestion); assert.match(paymentSuggestion.reason, /INV-001/); assert.equal(paymentSuggestion.itemId, followupId); assert(paymentSuggestion.sourceIds.includes(invoiceId));
assert.equal(attention({ availableMinutes: 15 }).suggestions.filter(s => s.itemId === followupId).length, 1);
await api.attention.feedback({ workspaceId, suggestionId: paymentSuggestion._id, action: 'dismiss' });
assert.equal(attention({ availableMinutes: 15 }).suggestions.some(s => s._id === paymentSuggestion._id), false);
await api.obligations.recordPayment({ workspaceId, engagementId, reference: 'BANK-001', amount: '500.00', currency: 'INR', date: today, invoiceId });
const revisedPayment = attention({ availableMinutes: 15 }).suggestions.find(s => s.kind === 'payment' && s.sourceIds.includes(invoiceId));
assert(revisedPayment); assert.notEqual(revisedPayment._id, paymentSuggestion._id, 'new balance evidence can resurface after dismissal');
await api.obligations.recordPayment({ workspaceId, engagementId, reference: 'BANK-002', amount: '500.00', currency: 'INR', date: today, invoiceId });
assert.equal(attention({ availableMinutes: 15 }).suggestions.some(s => s.sourceIds.includes(invoiceId)), false, 'fully allocated payment removes invoice exception');

// Cross-workspace records never leak; estimates and feedback survive reopening the same database.
const otherWorkspace = await api.workspaces.create({ name: 'Other private workspace' });
assert.deepEqual(buildAttention({ workspaceId: otherWorkspace, date: today }).suggestions, []);
await assert.rejects(api.attention.estimate({ workspaceId: otherWorkspace, itemId: shipping, minutes: 5 }), /Workspace/);
await api.attention.feedback({ workspaceId: otherWorkspace, suggestionId: waitingSuggestion._id, action: 'dismiss' });
assert(attention({ availableMinutes: 15 }).suggestions.some(s => s._id === waitingSuggestion._id));
await api.attention.estimate({ workspaceId, itemId: shipping, minutes: null });
assert.equal(data.itemEstimates.some(e => e.itemId === shipping), false);
await reload();
const feedbackCount = data.attentionFeedback.length, estimateCount = data.itemEstimates.length;
storage.db.close();
const reopened = openStorage(path, readMigrations());
assert.equal(reopened.db.prepare('SELECT COUNT(*) AS count FROM attentionFeedback').get().count, feedbackCount);
assert.equal(reopened.db.prepare('SELECT COUNT(*) AS count FROM itemEstimates').get().count, estimateCount);
reopened.db.close();
console.log('Attention: source evidence, honest capacity/estimates, blocked/paused exclusion, max-three dedup, completion/payment reconciliation, feedback/snooze/corrections, workspace isolation and persistence passed');
