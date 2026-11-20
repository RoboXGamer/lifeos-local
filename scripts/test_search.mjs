import { strict as assert } from 'node:assert';
import { searchItems } from '../src/local/search.ts';

const areas = [
  { _id: 'a', workspaceId: 'w', name: 'Health', archived: false },
  { _id: 'old', workspaceId: 'w', name: 'Hidden', archived: true },
];
const item = { workspaceId: 'w', title: 'Dentist', description: 'Annual visit', type: 'Task', tags: ['Urgent'], areaId: 'a', archived: false };
const items = [item, { ...item, workspaceId: 'other' }, { ...item, archived: true }, { ...item, areaId: 'old' }];
for (const term of ['DENTIST', 'annual', 'TASK', 'urgent', 'health']) {
  assert.deepEqual(searchItems(items, areas, 'w', term, 60), [item], term);
}
assert.deepEqual(searchItems(items, areas, 'w', '  ', 60), []);
assert.deepEqual(searchItems(items, areas, 'w', 'dentist', 60, 'Note'), []);
assert.deepEqual(searchItems([{ ...item, areaId: null, description: undefined, type: undefined, tags: [] }], areas, 'w', 'inbox', 60).length, 1);
assert.equal(searchItems([item, item], areas, 'w', 'dentist', 1).length, 1);
console.log('Search fields, visibility, workspace, type and limits passed');
